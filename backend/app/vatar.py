"""LagosLife mini version: the Vatar Games SDK v1 (https://lagoslife.app/developers/docs).

Inside LagosLife the game runs in their frame at ``/lagoslife``. LagosLife owns the
player's identity, money and home, so here:

- **Sign-in**: the game sends a LagosLife session token; we check it with their API and
  find (or make) a "mini" Boju account for that LagosLife player. Mini accounts get a
  random password nobody knows, so they can't sign in on our own site, and they never
  give us an email.
- **Ads**: a LagosLife player sends a poster for approval for free; once an admin
  approves it they pay in LagosLife (product ``ad_<size>``) and we verify the purchase
  with LagosLife's API before the poster goes live. No refunds are ever needed.
- **Matches**: a LagosLife match (stakes held by LagosLife, in their game money) is
  played as one of our private games; when it ends our server posts the winner,
  signed with the results secret.

Rule from their Developer Agreement: no outside payments or payment links inside the
mini version, so the Paystack ad flow is never offered there.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app import auth
from app.accounts import Me
from app.content import GameConfig
from app.db import Ad, Database, Player, VatarMatch
from app.realtime.world import World
from app.safety import contains_profanity
from app.settings import get_settings

log = logging.getLogger("boju.vatar")

_tasks: set[asyncio.Task[None]] = set()


async def call(method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
    """One call to the LagosLife games API with our secret (tests replace this function)."""
    st = get_settings()
    if not st.vatar_secret:
        raise HTTPException(503, "LagosLife isn't connected yet")
    try:
        async with httpx.AsyncClient(timeout=12, headers={"Authorization": f"Bearer {st.vatar_secret}"}) as client:
            res = await client.request(method, st.vatar_api.rstrip("/") + path, json=body)
        data: dict[str, Any] = res.json() if res.content else {}
    except (httpx.HTTPError, ValueError):
        log.warning("vatar %s %s unreachable", method, path)
        raise HTTPException(502, "LagosLife didn't answer — try again") from None
    if res.status_code >= 400:
        log.info("vatar %s %s -> %s %s", method, path, res.status_code, data.get("error"))
    return res.status_code, data


async def verify_session(session: str) -> dict[str, Any]:
    code, data = await call("POST", "/session/verify", {"session": session})
    if code != 200 or not str(data.get("playerId", "")).startswith(("p_", "t_")):
        raise HTTPException(401, "LagosLife sign-in expired — reopen the game")
    return data


async def post_signed(url: str, body: bytes, ts: str, sig: str) -> tuple[int, str]:
    """POST a match result with our secret and the results signature (tests replace this function)."""
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            res = await client.post(
                url,
                content=body,
                headers={
                    "Authorization": f"Bearer {get_settings().vatar_secret}", "Content-Type": "application/json",
                    "X-Vatar-Timestamp": ts, "X-Vatar-Signature": sig,
                },
            )  # fmt: skip
    except httpx.HTTPError:
        log.warning("vatar result not sent: %s", url)
        return 0, ""
    return res.status_code, res.text


def results_signature(secret: str, path: str, ts: str, nonce: str, body: bytes) -> str:
    sha = hashlib.sha256(body).hexdigest()
    msg = "\n".join(["POST", path, ts, nonce, sha]).encode()
    return "v1=" + hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


class SessionIn(BaseModel):
    session: str = Field(min_length=10, max_length=4096)


class ClaimIn(SessionIn):
    purchase_id: str = Field(min_length=1, max_length=64)
    ad_id: str | None = Field(default=None, max_length=32)


class MatchIn(SessionIn):
    match_id: str = Field(min_length=1, max_length=64)
    group_code: str | None = Field(default=None, max_length=8)


def _clean_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", str(raw or "")).strip()[:24]
    return name if len(name) >= 2 and not contains_profanity(name) else "Player"


def make_router(db: Database, world: World, cfg: GameConfig) -> APIRouter:
    r = APIRouter(prefix="/api/vatar")
    sizes = {s.id: s for s in cfg.ads.sizes}

    # ------------------------------------------------------------ sign in
    @r.get("/config")
    async def config() -> dict[str, Any]:
        return {"enabled": bool(get_settings().vatar_secret), "products": {s: f"ad_{s}" for s in sizes}}

    @r.post("/session")
    async def session(body: SessionIn) -> dict[str, Any]:
        v = await verify_session(body.session)
        vid, name = str(v["playerId"])[:64], _clean_name(v.get("name", ""))
        raw, hashed = auth.new_device_secret()
        created = False
        async with db.sessions() as s, s.begin():
            p = await s.scalar(select(Player).where(Player.vatar_id == vid).with_for_update())
            if p is None:
                slug = re.sub(r"[^a-z0-9]", "", name.lower())[:9] or "player"
                username = f"ll_{slug}_{secrets.token_hex(2)[:3]}"
                while await s.scalar(select(Player.id).where(Player.username == username)):
                    username = f"ll_{slug}_{secrets.token_hex(2)[:3]}"
                h = int(hashlib.sha256(vid.encode()).hexdigest(), 16)
                p = Player(
                    username=username,
                    nickname=name,
                    # a password nobody knows: mini accounts only ever sign in through LagosLife
                    password_hash=auth.hash_password(secrets.token_urlsafe(32)),
                    must_change_password=False,
                    email=None,
                    vatar_id=vid,
                    avatar=[h % 8, (h >> 3) % 8, (h >> 6) % 8],
                    home_area=cfg.home_areas[0],
                    device_secret_hash=hashed,
                    hunger=float(cfg.economy.max_hunger),
                )
                s.add(p)
                await s.flush()
                created = True
            else:
                p.nickname = name
                p.device_secret_hash = hashed
            out = {
                "token": auth.issue_token(p.id),
                "player_id": p.id,
                "device_secret": raw,
                "username": p.username,
                "nickname": p.nickname,
                "mode": v.get("mode", "live"),
            }
        if created:
            await world.economy.post(p.id, cfg.economy.starting_balance, "starting_balance", f"start:{p.id}")
            log.info("vatar_player_created player=%s mode=%s", p.id, out["mode"])
        world.mini.add(p.id)
        return out

    async def me_for(session: str, pid: str) -> dict[str, Any]:
        v = await verify_session(session)
        async with db.sessions() as s:
            p = await s.get(Player, pid)
        if p is None or p.vatar_id != v["playerId"]:
            raise HTTPException(403, "That LagosLife player isn't you")
        return v

    # ------------------------------------------------------------ ads paid in LagosLife
    async def settle(pid: str, purchase: dict[str, Any], ad_id: str | None) -> Ad | None:
        """A verified LagosLife purchase of ``ad_<size>`` puts one approved poster live (once)."""
        product = str(purchase.get("productId", ""))
        size = sizes.get(product[3:]) if product.startswith("ad_") else None
        if size is None:
            return None
        if purchase.get("currency") != "NGN" or int(purchase.get("amount", 0)) < size.price:
            log.warning("vatar purchase %s too small for %s", purchase.get("id"), product)
            return None
        purchase_id = str(purchase["id"])
        now = datetime.now(UTC)
        async with db.sessions() as s, s.begin():
            done = await s.scalar(select(Ad).where(Ad.purchase_id == purchase_id))
            if done is not None:
                return done if done.player_id == pid else None
            if purchase.get("status") != "paid":
                return None  # refunded, or delivered somewhere we don't know about
            q = select(Ad).where(
                Ad.player_id == pid, Ad.provider == "vatar", Ad.status == "approved", Ad.size == size.id
            )
            if ad_id:
                q = q.where(Ad.id == ad_id)
            a = await s.scalar(q.order_by(Ad.created_at).limit(1).with_for_update())
            if a is None:
                return None
            a.status, a.paid_at, a.purchase_id = "live", now, purchase_id
            a.live_until = now + timedelta(days=cfg.ads.days)
            log.info("ad_live_vatar ad=%s purchase=%s", a.id, purchase_id)
        await call("POST", f"/purchases/{quote(purchase_id, safe='')}/deliver", {})
        return a

    @r.post("/ads/claim")
    async def claim(body: ClaimIn, pid: Me) -> dict[str, Any]:
        v = await me_for(body.session, pid)
        code, p = await call("GET", f"/purchases/{quote(body.purchase_id, safe='')}")
        if code != 200 or p.get("playerId") != v["playerId"]:
            raise HTTPException(404, "We couldn't find that payment in LagosLife")
        if p.get("status") == "refunded":
            raise HTTPException(409, "That payment was refunded")
        a = await settle(pid, p, body.ad_id)
        if a is None:
            raise HTTPException(409, "No approved ad is waiting for this payment")
        return {"ok": True, "ad": a.id, "status": a.status}

    @r.post("/webhook")
    async def webhook(request: Request) -> dict[str, Any]:
        """purchase.paid is a nudge: the purchase is checked with LagosLife before anything goes live."""
        key = get_settings().vatar_webhook_secret
        raw = await request.body()
        want = "sha256=" + hmac.new(key.encode(), raw, hashlib.sha256).hexdigest() if key else ""
        if not key or not hmac.compare_digest(want, request.headers.get("x-vatar-signature", "")):
            raise HTTPException(401, "Bad signature")
        evt = json.loads(raw or b"{}")
        if evt.get("type") == "purchase.paid":
            ref = str((evt.get("data") or {}).get("purchaseId", ""))[:64]
            code, p = await call("GET", f"/purchases/{quote(ref, safe='')}") if ref else (404, {})
            if code == 200:
                async with db.sessions() as s:
                    pid = await s.scalar(select(Player.id).where(Player.vatar_id == p.get("playerId")))
                if pid:
                    await settle(pid, p, None)
        return {"ok": True}

    # ------------------------------------------------------------ matches (LagosLife stakes)
    @r.post("/match")
    async def link_match(body: MatchIn, pid: Me) -> dict[str, Any]:
        """Turns a LagosLife match into one private game. The first player to ask creates it."""
        v = await me_for(body.session, pid)
        code, m = await call("GET", f"/matches/{quote(body.match_id, safe='')}")
        if code != 200 or v["playerId"] not in {x.get("playerId") for x in m.get("players", [])}:
            raise HTTPException(404, "You're not in that match")
        async with db.sessions() as s, s.begin():
            row = await s.get(VatarMatch, body.match_id, with_for_update=True)
            if row is None:
                nonce = str(m.get("nonce") or "")
                row = VatarMatch(match_id=body.match_id, mode=str(m.get("mode", "live")), nonce=nonce, claimed_by=pid)
                s.add(row)
            if body.group_code and row.claimed_by == pid and row.group_code is None:
                g = world.groups.get(body.group_code)
                if g is None or g.creator != pid:
                    raise HTTPException(409, "Create the game first")
                g.public = False  # only the match's players get the code
                row.group_code, row.game_id = g.code, g.id
                log.info("vatar_match_linked match=%s game=%s", row.match_id, g.id)
            return {"group_code": row.group_code, "create": row.claimed_by == pid and row.group_code is None}

    async def post_result(game_id: str, results: list[dict[str, Any]]) -> None:
        async with db.sessions() as s:
            row = await s.scalar(select(VatarMatch).where(VatarMatch.game_id == game_id, VatarMatch.settled.is_(False)))
            if row is None:
                return
            ids = [x["id"] for x in results]
            vids = dict((await s.execute(select(Player.id, Player.vatar_id).where(Player.id.in_(ids)))).all())
        code, m = await call("GET", f"/matches/{quote(row.match_id, safe='')}")
        if code != 200:
            return
        if m.get("status") != "playing":
            settled = m.get("status") in ("done", "cancelled", "void")
        else:
            seats = {x.get("playerId") for x in m.get("players", [])}
            ranked = [x for x in results if vids.get(x["id"]) in seats]

            def key(x: dict[str, Any]) -> tuple[int, int, int]:
                return (x.get("earned", 0), x.get("finds", 0), x.get("survived", 0))

            draw = not ranked or (len(ranked) > 1 and key(ranked[0]) == key(ranked[1]))
            body = json.dumps({"winner": "draw" if draw else vids[ranked[0]["id"]]}, separators=(",", ":")).encode()
            api = get_settings().vatar_api.rstrip("/")
            tail = f"/matches/{quote(row.match_id, safe='')}/result"
            ts = str(int(time.time()))
            nonce = str(m.get("nonce") or row.nonce)
            sig = results_signature(get_settings().vatar_results_secret, urlparse(api).path + tail, ts, nonce, body)
            res_code, res_text = await post_signed(api + tail, body, ts, sig)
            if res_code == 0:
                return
            settled = res_code == 200 or (res_code == 409 and "already_settled" in res_text)
            log.info("vatar_result match=%s status=%s", row.match_id, res_code)
        if settled:
            async with db.sessions() as s, s.begin():
                if (x := await s.get(VatarMatch, row.match_id)) is not None:
                    x.settled = True

    async def on_game_over(game_id: str, results: list[dict[str, Any]]) -> None:
        if not get_settings().vatar_secret:
            return
        t = asyncio.create_task(post_result(game_id, results))  # never hold up the game for LagosLife
        _tasks.add(t)
        t.add_done_callback(_tasks.discard)

    on_game_over.post_result = post_result  # type: ignore[attr-defined]  # tests await it directly
    world.game_over_hooks.append(on_game_over)
    return r
