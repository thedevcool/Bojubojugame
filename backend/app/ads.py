"""In-game wall ads, paid with REAL naira through Paystack.

This is the only real money in Boju Boju, and it is kept apart from the game
economy: advertisers buy a poster on a wall (a kiosk, shop, billboard, or an
arena wall people hide behind), the poster goes up after an admin approves the
creative, and it comes down after ``cfg.ads.days``. Game naira can't buy ads,
and ad money never enters a game wallet. Player houses can't carry ads.

Payment flow: create ad (awaiting_payment, slot reserved) -> Paystack checkout
-> verify (redirect) or webhook -> review -> admin approves (live) or rejects
(refund).
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.accounts import Me, clean_email
from app.content import GameConfig, MapData
from app.db import Ad, Database, Player
from app.safety import TextRejected, clean_chat
from app.settings import get_settings

log = logging.getLogger("boju.ads")

PAYSTACK = "https://api.paystack.co"
# props whose outside walls can carry a poster (never a player's house: those walls are flagged win/inner)
AD_KINDS = {
    "wall",
    "fence",
    "kiosk",
    "shop",
    "stall",
    "billboard",
    "venue",
    "flat",
    "tower",
    "container",
    "house",
    "duplex",
}
HOLD_MINUTES = 30  # an unpaid ad keeps its spot this long
HOLD_UNPAID_DAYS = 4  # a LagosLife ad (reviewed first, paid after approval) keeps its spot this long unpaid
MAX_PENDING = 3
MAX_IMAGE = 400_000
ACTIVE = ("awaiting_payment", "review", "approved", "live")


class AdIn(BaseModel):
    map_id: str = Field(max_length=40)
    x: float = Field(ge=-500, le=500)
    y: float = Field(ge=0, le=20)
    z: float = Field(ge=-500, le=500)
    nx: int = Field(ge=-1, le=1)
    nz: int = Field(ge=-1, le=1)
    size: str = Field(max_length=8)
    title: str = Field(min_length=2, max_length=40)
    email: str = Field(default="", max_length=254)  # LagosLife players don't give us an email
    image: str = Field(max_length=MAX_IMAGE * 4 // 3 + 64)  # base64 (data URL prefix allowed)


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=UTC)


def find_face(m: MapData, x: float, y: float, z: float, nx: int, nz: int, w: float, h: float) -> str | None:
    """Checks the poster sits flat on one face of an allowed prop. Returns a problem, or None."""
    if abs(nx) + abs(nz) != 1:
        return "Pick a wall"
    problem = None
    for p in m.raw["props"]:
        c = p.get("collider")
        if not c or p["kind"] not in AD_KINDS or p.get("win") or p.get("inner") or p.get("label"):
            continue
        plane, along, lo, hi = (
            (c[2] if nx > 0 else c[0], z, c[1], c[3]) if nx else (c[3] if nz > 0 else c[1], x, c[0], c[2])
        )
        if abs((x if nx else z) - plane) > 0.12 or not (lo - 0.01 <= along <= hi + 0.01):
            continue
        if along - w / 2 < lo + 0.02 or along + w / 2 > hi - 0.02:
            problem = "That poster is wider than this wall — pick a smaller size"
        elif y - h / 2 < 0.2 or y + h / 2 > c[4] - 0.02:
            problem = "That poster is taller than this wall — pick a smaller size"
        else:
            return None  # fits on this face (walls that touch are checked one by one)
    return problem or "Ads go on kiosks, shops, billboards and walls — not on people's houses"


def overlaps(a: Ad, x: float, y: float, z: float, nx: int, nz: int, w: float, h: float) -> bool:
    if (a.nx, a.nz) != (nx, nz):
        return False
    if abs((a.x - x) if nx else (a.z - z)) > 0.15:  # different wall plane
        return False
    au, u = (a.z, z) if nx else (a.x, x)
    return abs(au - u) < (a.w + w) / 2 + 0.05 and abs(a.y - y) < (a.h + h) / 2 + 0.05


def holds_spot(a: Ad, now: datetime) -> bool:
    """Does this ad still reserve its spot on the wall?"""
    created = _aware(a.created_at) or now
    if a.status == "awaiting_payment":
        return created > now - timedelta(minutes=HOLD_MINUTES)
    if a.status in ("review", "approved"):
        unpaid_vatar = a.provider == "vatar" and a.paid_at is None
        return not unpaid_vatar or created > now - timedelta(days=HOLD_UNPAID_DAYS)
    if a.status == "live":
        until = _aware(a.live_until)
        return until is not None and until > now
    return False


def decode_image(raw: str) -> tuple[bytes, str]:
    data = raw.split(",", 1)[1] if raw.startswith("data:") else raw
    try:
        blob = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "That image didn't upload properly — try again") from None
    if len(blob) > MAX_IMAGE:
        raise HTTPException(413, "Image is too big (max 400 KB)")
    if blob[:3] == b"\xff\xd8\xff":
        return blob, "image/jpeg"
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        return blob, "image/png"
    raise HTTPException(422, "Use a JPG or PNG image")


def make_router(db: Database, cfg: GameConfig, maps: dict[str, MapData]) -> APIRouter:
    r = APIRouter(prefix="/api")
    sizes = {s.id: s for s in cfg.ads.sizes}

    async def paystack(method: str, path: str, **kw: Any) -> dict[str, Any]:
        key = get_settings().paystack_secret_key
        if not key:
            raise HTTPException(503, "Ad payments aren't switched on yet — check back soon")
        async with httpx.AsyncClient(timeout=15, headers={"Authorization": f"Bearer {key}"}) as client:
            res = await client.request(method, PAYSTACK + path, **kw)
        body: dict[str, Any] = res.json()
        if res.status_code >= 400 or not body.get("status"):
            log.warning("paystack %s %s failed: %s", method, path, body.get("message"))
            raise HTTPException(502, "Payment service had a problem — please try again")
        return body

    def public(a: Ad) -> dict[str, Any]:
        return {
            "id": a.id, "x": a.x, "y": a.y, "z": a.z, "nx": a.nx, "nz": a.nz, "w": a.w, "h": a.h, "title": a.title,
            "image": f"/api/ads/{a.id}/image",
        }  # fmt: skip

    async def mark_paid(ref: str, amount_kobo: int, currency: str) -> Ad | None:
        async with db.sessions() as ses, ses.begin():
            a = await ses.scalar(select(Ad).where(Ad.reference == ref).with_for_update())
            if a is None:
                return None
            if a.status == "awaiting_payment":
                if currency != "NGN" or amount_kobo < a.price * 100:
                    log.warning("ad %s paid wrong amount %s %s", a.id, amount_kobo, currency)
                    return a
                a.status, a.paid_at = "review", _now()
                log.info("ad_paid ad=%s price=%s", a.id, a.price)
            return a

    @r.get("/ads/config")
    async def ads_config() -> dict[str, Any]:
        return {
            **cfg.ads.model_dump(),
            "enabled": bool(get_settings().paystack_secret_key or get_settings().ads_fake_payments),
        }

    @r.get("/ads/map/{map_id}")
    async def ads_on_map(map_id: str) -> dict[str, Any]:
        """Live posters to draw, plus every reserved spot (so new ads never cover another)."""
        now = _now()
        async with db.sessions() as ses:
            rows = (await ses.scalars(select(Ad).where(Ad.map_id == map_id, Ad.status.in_(ACTIVE)))).all()
        live, taken = [], []
        for a in rows:
            until = _aware(a.live_until)
            if a.status == "live" and until and until > now:
                live.append(public(a))
            if holds_spot(a, now):
                taken.append({k: getattr(a, k) for k in ("x", "y", "z", "nx", "nz", "w", "h")})
        return {"live": live, "taken": taken}

    @r.post("/ads")
    async def create_ad(body: AdIn, pid: Me) -> dict[str, Any]:
        st = get_settings()
        m = maps.get(body.map_id)
        size = sizes.get(body.size)
        if m is None or size is None:
            raise HTTPException(404, "Unknown place or size")
        async with db.sessions() as ses:
            player = await ses.get(Player, pid)
        vatar = bool(player and player.vatar_id)  # LagosLife player: approval first, then pay in LagosLife
        if vatar:
            if not st.vatar_secret:
                raise HTTPException(503, "Ads aren't switched on in LagosLife yet")
            email = ""  # LagosLife's rules: we never ask their players for personal data
        else:
            if not (st.paystack_secret_key or st.ads_fake_payments):
                raise HTTPException(503, "Ad payments aren't switched on yet — check back soon")
            email = clean_email(body.email) or ""
            if not email:
                raise HTTPException(422, "Add an email for your payment receipt")
        try:
            title = clean_chat(body.title, 40)
        except TextRejected as e:
            raise HTTPException(422, str(e)) from None
        if problem := find_face(m, body.x, body.y, body.z, body.nx, body.nz, size.w, size.h):
            raise HTTPException(422, problem)
        image, image_type = decode_image(body.image)
        now = _now()
        async with db.sessions() as ses, ses.begin():
            mine = await ses.scalars(
                select(Ad).where(Ad.player_id == pid, Ad.status.in_(("awaiting_payment", "review", "approved")))
            )
            if sum(1 for a in mine if a.paid_at is None and holds_spot(a, now)) >= MAX_PENDING:
                raise HTTPException(429, "Finish your other ads first")
            for a in (await ses.scalars(select(Ad).where(Ad.map_id == body.map_id, Ad.status.in_(ACTIVE)))).all():
                if holds_spot(a, now) and overlaps(a, body.x, body.y, body.z, body.nx, body.nz, size.w, size.h):
                    raise HTTPException(409, "Another ad is already there — move yours a bit")
            ad = Ad(
                player_id=pid, map_id=body.map_id, x=body.x, y=body.y, z=body.z, nx=body.nx, nz=body.nz,
                w=size.w, h=size.h, size=size.id, price=size.price, title=title, email=email,
                reference="", image=image, image_type=image_type,
                provider="vatar" if vatar else "paystack", status="review" if vatar else "awaiting_payment",
            )  # fmt: skip
            ses.add(ad)
            await ses.flush()
            ad.reference = f"bojuad_{ad.id}"
            ad_id, ref = ad.id, ad.reference
        if vatar:
            log.info("ad_submitted_vatar ad=%s", ad_id)
            return {"id": ad_id, "status": "review", "price": size.price, "product": f"ad_{size.id}"}
        site = st.public_frontend_url if "localhost" not in st.public_frontend_url else st.frontend_origin.split(",")[0]
        callback = site.strip().rstrip("/") + "/ads/return"
        if st.ads_fake_payments:
            return {"id": ad_id, "reference": ref, "pay_url": f"{callback}?reference={ref}", "price": size.price}
        res = await paystack(
            "POST",
            "/transaction/initialize",
            json={
                "email": email, "amount": size.price * 100, "currency": "NGN", "reference": ref,
                "callback_url": callback, "metadata": {"ad_id": ad_id, "player_id": pid, "kind": "boju_ad"},
            },
        )  # fmt: skip
        return {"id": ad_id, "reference": ref, "pay_url": res["data"]["authorization_url"], "price": size.price}

    @r.get("/ads/verify")
    async def verify(reference: Annotated[str, Query(max_length=64)], pid: Me) -> dict[str, Any]:
        if not re.fullmatch(r"bojuad_[0-9a-f]{32}", reference):
            raise HTTPException(404, "Unknown payment")
        if get_settings().ads_fake_payments:
            async with db.sessions() as ses:
                a = await ses.scalar(select(Ad).where(Ad.reference == reference))
            ad = await mark_paid(reference, (a.price * 100) if a else 0, "NGN")
        else:
            data = (await paystack("GET", f"/transaction/verify/{reference}"))["data"]
            ad = (
                await mark_paid(reference, int(data.get("amount", 0)), str(data.get("currency", "")))
                if data.get("status") == "success"
                else None
            )
            if ad is None:
                async with db.sessions() as ses:
                    ad = await ses.scalar(select(Ad).where(Ad.reference == reference))
        if ad is None or ad.player_id != pid:
            raise HTTPException(404, "Unknown payment")
        return {"status": ad.status, "title": ad.title, "price": ad.price, "map_id": ad.map_id}

    @r.post("/paystack/webhook")
    async def webhook(request: Request, x_paystack_signature: Annotated[str, Header()] = "") -> dict[str, Any]:
        """Paystack calls this after a payment, even if the player closed the page before coming back."""
        key = get_settings().paystack_secret_key
        raw = await request.body()
        expected = hmac.new(key.encode(), raw, hashlib.sha512).hexdigest() if key else ""
        if not key or not hmac.compare_digest(expected, x_paystack_signature):
            raise HTTPException(401, "Bad signature")
        event = await request.json()
        if event.get("event") == "charge.success":
            data = event.get("data") or {}
            ref = str(data.get("reference", ""))
            if ref.startswith("bojuad_"):
                await mark_paid(ref, int(data.get("amount", 0)), str(data.get("currency", "")))
        return {"ok": True}

    @r.get("/ads/mine")
    async def my_ads(pid: Me) -> dict[str, Any]:
        async with db.sessions() as ses:
            rows = (
                await ses.scalars(select(Ad).where(Ad.player_id == pid).order_by(Ad.created_at.desc()).limit(30))
            ).all()
        return {
            "ads": [
                {"id": a.id, "title": a.title, "status": a.status, "price": a.price, "map_id": a.map_id, "size": a.size,
                 "provider": a.provider, "product": f"ad_{a.size}",
                 "live_until": _aware(a.live_until).isoformat() if a.live_until else None}  # type: ignore[union-attr]
                for a in rows
                if a.status != "awaiting_payment"
            ]
        }  # fmt: skip

    @r.get("/ads/{ad_id}/image")
    async def ad_image(ad_id: str, x_admin_token: Annotated[str, Header()] = "") -> Response:
        want = get_settings().admin_token
        admin = bool(want) and hmac.compare_digest(x_admin_token, want)
        async with db.sessions() as ses:
            a = await ses.get(Ad, ad_id[:32])
        if a is None or (a.status != "live" and not admin):
            raise HTTPException(404, "No such ad")
        return Response(a.image, media_type=a.image_type, headers={"Cache-Control": "public, max-age=3600"})

    # ------------------------------------------------------------ admin: approve / reject (with refund)
    def require_admin(token: str) -> None:
        want = get_settings().admin_token
        if not want or not hmac.compare_digest(token, want):
            raise HTTPException(401, "Admin only")

    @r.get("/admin/ads")
    async def admin_list(x_admin_token: Annotated[str, Header()] = "") -> dict[str, Any]:
        require_admin(x_admin_token)
        async with db.sessions() as ses:
            q = select(Ad).where(Ad.status.in_(("review", "approved", "live"))).order_by(Ad.created_at)
            rows = (await ses.scalars(q)).all()
            names = dict((await ses.execute(select(Player.id, Player.username))).all())
        return {
            "ads": [
                {"id": a.id, "title": a.title, "status": a.status, "price": a.price, "map_id": a.map_id, "size": a.size,
                 "by": names.get(a.player_id, "?"), "email": a.email,
                 "provider": a.provider, "paid": a.paid_at is not None,
                 "live_until": _aware(a.live_until).isoformat() if a.live_until else None}  # type: ignore[union-attr]
                for a in rows
            ]
        }  # fmt: skip

    @r.post("/admin/ads/{ad_id}/{action}")
    async def admin_act(ad_id: str, action: str, x_admin_token: Annotated[str, Header()] = "") -> dict[str, Any]:
        require_admin(x_admin_token)
        if action not in ("approve", "reject", "remove"):
            raise HTTPException(404, "Unknown action")
        async with db.sessions() as ses, ses.begin():
            a = await ses.get(Ad, ad_id[:32], with_for_update=True)
            if a is None:
                raise HTTPException(404, "No such ad")
            if action == "approve":
                if a.status != "review":
                    raise HTTPException(409, "Only ads waiting for review can be approved")
                if a.provider == "vatar" and a.paid_at is None:
                    a.status = "approved"  # the advertiser now pays in LagosLife, then it goes live
                else:
                    a.status, a.live_until = "live", _now() + timedelta(days=cfg.ads.days)
            elif action == "remove":
                a.status = "rejected"  # e.g. a report after it went live (no automatic refund)
            else:
                if a.status not in ("review", "approved"):
                    raise HTTPException(409, "Only ads waiting for review can be rejected")
                a.status = "rejected"
                # LagosLife ads are only paid after approval, so there's nothing to refund
                ref, refund = a.reference, a.provider == "paystack" and a.paid_at is not None
            status = a.status
        if action == "reject" and refund and not get_settings().ads_fake_payments:
            await paystack("POST", "/refund", json={"transaction": ref})
            async with db.sessions() as ses, ses.begin():
                if (b := await ses.get(Ad, ad_id[:32])) is not None:
                    b.status = status = "refunded"
        log.info("ad_%s ad=%s", action, ad_id)
        return {"ok": True, "status": status}

    return r
