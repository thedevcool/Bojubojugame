"""Life-sim API: phones, renting a house, friends and direct messages.

All money moves through the append-only ledger (idempotent keys); positions
for "you must be at the shop" come from the authoritative server session.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.accounts import Me
from app.content import HUB_MAP_ID, GameConfig
from app.db import Database, DirectMessage, Friendship, Player, RoundStat
from app.economy import InsufficientFunds
from app.engine.geometry import in_rect
from app.realtime.world import World
from app.safety import KeyedLimiter, TextRejected, clean_chat


class BuyPhoneIn(BaseModel):
    phone_id: str = Field(max_length=20)
    key: str = Field(min_length=8, max_length=64)


class RentIn(BaseModel):
    home_id: str = Field(max_length=40)
    key: str = Field(min_length=8, max_length=64)


class FriendIn(BaseModel):
    username: str = Field(min_length=3, max_length=16)


class RespondIn(BaseModel):
    player_id: str = Field(max_length=32)
    accept: bool


class PlayerRef(BaseModel):
    player_id: str = Field(max_length=32)


class DmIn(BaseModel):
    text: str = Field(min_length=1, max_length=600)


def _pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=UTC)


def make_router(db: Database, world: World, cfg: GameConfig) -> APIRouter:
    r = APIRouter(prefix="/api")
    hub = world.maps[HUB_MAP_ID]
    dm_limit = KeyedLimiter(rate=1.0, burst=6)

    def rent_price(home: dict[str, Any]) -> int:
        style = next(
            (
                p.get("style", "bungalow")
                for p in hub.raw["props"]
                if p.get("kind") == "roof" and p.get("label") == home["id"]
            ),
            "bungalow",
        )
        return cfg.rent.prices.get(style, cfg.rent.prices["bungalow"])

    async def push_wallet(pid: str) -> None:
        if (s := world.sessions.get(pid)) is not None:
            await world.push_wallet(s)

    # ------------------------------------------------------------ phone
    @r.post("/shop/phone")
    async def buy_phone(body: BuyPhoneIn, pid: Me) -> dict[str, Any]:
        phone = next((p for p in cfg.phones if p.id == body.phone_id), None)
        if phone is None:
            raise HTTPException(404, "Unknown phone")
        s = world.sessions.get(pid)
        zone = hub.zones.get("phone_shop")
        if (
            s is None
            or s.room is None
            or s.room.map.id != HUB_MAP_ID
            or zone is None
            or not in_rect(zone["rect"], s.x, s.z)
        ):
            raise HTTPException(409, "Walk into the phone shop to buy a phone")
        try:
            await world.economy.post(pid, -phone.price, "phone", f"phone:{pid}:{body.key}", ref=phone.id)
        except InsufficientFunds:
            raise HTTPException(402, "Omo, your money no reach for this phone") from None
        async with db.sessions() as ses, ses.begin():
            p = await ses.get(Player, pid, with_for_update=True)
            assert p is not None
            p.phone_id = phone.id
        await push_wallet(pid)
        return {"ok": True, "phone_id": phone.id}

    # ------------------------------------------------------------ houses
    @r.get("/homes")
    async def homes(pid: Me) -> dict[str, Any]:
        now = datetime.now(UTC)
        async with db.sessions() as ses:
            tenants = {
                home: (tid, name, _aware(until))
                for tid, name, home, until in (
                    await ses.execute(
                        select(Player.id, Player.username, Player.home_id, Player.rent_until).where(
                            Player.home_id.is_not(None)
                        )
                    )
                ).all()
            }
            me = await ses.get(Player, pid)
        out = []
        for h in hub.homes:
            t = tenants.get(h["id"])
            # an expired tenant keeps the keys until someone else rents the house
            taken = t is not None and t[0] != pid and t[2] is not None and t[2] > now
            out.append(
                {
                    "id": h["id"],
                    "name": h["name"],
                    "rent": rent_price(h),
                    "duplex": rent_price(h) > cfg.rent.prices["bungalow"],
                    "door": h["door"],
                    "owner": t[1] if t is not None and t[0] != pid else None,
                    "owner_id": t[0] if t is not None and t[0] != pid else None,
                    "taken": taken,
                }
            )
        return {
            "days": cfg.rent.days,
            "mine": me.home_id if me else None,
            "rent_until": _aware(me.rent_until).isoformat() if me and me.rent_until else None,  # type: ignore[union-attr]
            "free": sum(1 for h in out if not h["taken"] and h["id"] != (me.home_id if me else None)),
            "homes": out,
        }

    @r.post("/home/rent")
    async def rent(body: RentIn, pid: Me) -> dict[str, Any]:
        """One tenant per house. Claim the house first (unique index), then pay; undo the claim if payment fails."""
        home = hub.home_by_id(body.home_id)
        if home is None:
            raise HTTPException(404, "Unknown house")
        now = datetime.now(UTC)
        evicted: str | None = None
        try:
            async with db.sessions() as ses, ses.begin():
                p = await ses.get(Player, pid, with_for_update=True)
                if p is None:
                    raise HTTPException(404, "Unknown player")
                if not p.phone_id:
                    raise HTTPException(409, "Buy a phone first — you rent houses with the Houses app")
                prev_home, prev_until = p.home_id, _aware(p.rent_until)
                if p.home_id != home["id"]:
                    holder = await ses.scalar(
                        select(Player).where(Player.home_id == home["id"], Player.id != pid).with_for_update()
                    )
                    if holder is not None:
                        until = _aware(holder.rent_until)
                        if until is not None and until > now:
                            raise HTTPException(409, f"@{holder.username} already lives here — pick another house")
                        holder.home_id, holder.rent_until = None, None  # their rent ran out
                        evicted = holder.id
                        await ses.flush()
                    p.home_id = home["id"]
        except IntegrityError:
            raise HTTPException(409, "Someone just rented this house — pick another one") from None
        price = rent_price(home)
        try:
            await world.economy.post(pid, -price, "rent", f"rent:{pid}:{body.key}", ref=home["id"])
        except InsufficientFunds:
            async with db.sessions() as ses, ses.begin():
                p = await ses.get(Player, pid, with_for_update=True)
                if p is not None:
                    p.home_id, p.rent_until = prev_home, prev_until
            raise HTTPException(402, "Omo, your money no reach for this rent") from None
        async with db.sessions() as ses, ses.begin():
            p = await ses.get(Player, pid, with_for_update=True)
            assert p is not None
            renew = prev_home == home["id"] and prev_until is not None and prev_until > now
            start = prev_until if renew and prev_until is not None else now
            p.rent_until = start + timedelta(days=cfg.rent.days)
            until = p.rent_until
        if evicted:
            world.set_home(evicted, None)
            if (s := world.sessions.get(evicted)) is not None:
                s.send({"t": "toast", "msg": "Your rent ran out and someone new moved into your house 🏠"})
        world.set_home(pid, home["id"])
        await push_wallet(pid)
        return {"ok": True, "home": home, "rent_until": until.isoformat()}

    # ------------------------------------------------------------ friends
    async def friend_rows(ses: Any, pid: str) -> list[Friendship]:
        return list(
            (await ses.scalars(select(Friendship).where(or_(Friendship.a_id == pid, Friendship.b_id == pid)))).all()
        )

    @r.get("/friends")
    async def friends(pid: Me) -> dict[str, Any]:
        async with db.sessions() as ses:
            rows = await friend_rows(ses, pid)
            other_ids = [f.b_id if f.a_id == pid else f.a_id for f in rows]
            names = (
                dict((await ses.execute(select(Player.id, Player.username).where(Player.id.in_(other_ids)))).all())
                if other_ids
                else {}
            )
            unread = dict(
                (
                    await ses.execute(
                        select(DirectMessage.sender_id, func.count())
                        .where(DirectMessage.recipient_id == pid, DirectMessage.read.is_(False))
                        .group_by(DirectMessage.sender_id)
                    )
                ).all()
            )
        out: dict[str, list[dict[str, Any]]] = {"friends": [], "incoming": [], "outgoing": []}
        for f in rows:
            other = f.b_id if f.a_id == pid else f.a_id
            s = world.sessions.get(other)
            item = {
                "id": other,
                "username": names.get(other, "?"),
                "online": bool(s and s.connected and not s.bot),
                "unread": int(unread.get(other, 0)),
            }
            if f.status == "accepted":
                out["friends"].append(item)
            elif f.requested_by == pid:
                out["outgoing"].append(item)
            else:
                out["incoming"].append(item)
        out["friends"].sort(key=lambda x: (not x["online"], -x["unread"], x["username"].lower()))
        return out

    @r.post("/friends/request")
    async def request(body: FriendIn, pid: Me) -> dict[str, Any]:
        async with db.sessions() as ses, ses.begin():
            other = await ses.scalar(select(Player).where(func.lower(Player.username) == body.username.strip().lower()))
            if other is None or other.id == pid:
                raise HTTPException(404, "No player with that username")
            a, b = _pair(pid, other.id)
            row = await ses.scalar(select(Friendship).where(Friendship.a_id == a, Friendship.b_id == b))
            if row is None:
                ses.add(Friendship(a_id=a, b_id=b, requested_by=pid))
                status = "pending"
            elif row.status == "pending" and row.requested_by != pid:
                row.status = "accepted"  # they already asked you: that's a yes
                status = "accepted"
            else:
                status = row.status
            other_id, me_name = other.id, (await ses.get(Player, pid)).username  # type: ignore[union-attr]
        if (s := world.sessions.get(other_id)) is not None:
            s.send({"t": "friend", "event": status, "from": pid, "username": me_name})
        return {"ok": True, "status": status}

    @r.post("/friends/respond")
    async def respond(body: RespondIn, pid: Me) -> dict[str, Any]:
        a, b = _pair(pid, body.player_id)
        async with db.sessions() as ses, ses.begin():
            row = await ses.scalar(
                select(Friendship).where(Friendship.a_id == a, Friendship.b_id == b).with_for_update()
            )
            if row is None or row.status != "pending" or row.requested_by == pid:
                raise HTTPException(404, "No friend request from that player")
            if body.accept:
                row.status = "accepted"
            else:
                await ses.delete(row)
        if body.accept and (s := world.sessions.get(body.player_id)) is not None:
            s.send({"t": "friend", "event": "accepted", "from": pid})
        return {"ok": True}

    @r.post("/friends/remove")
    async def remove(body: PlayerRef, pid: Me) -> dict[str, Any]:
        a, b = _pair(pid, body.player_id)
        async with db.sessions() as ses, ses.begin():
            row = await ses.scalar(select(Friendship).where(Friendship.a_id == a, Friendship.b_id == b))
            if row is not None:
                await ses.delete(row)
        return {"ok": True}

    # ------------------------------------------------------------ player card (tap a player in the world)
    @r.get("/players/{other_id}/card")
    async def card(other_id: str, pid: Me) -> dict[str, Any]:
        if len(other_id) > 32:
            raise HTTPException(404, "Unknown player")
        async with db.sessions() as ses:
            p = await ses.get(Player, other_id)
            if p is None:
                raise HTTPException(404, "Unknown player")
            finds, escapes, rounds, games = (
                await ses.execute(
                    select(
                        func.coalesce(func.sum(RoundStat.finds), 0),
                        func.coalesce(func.sum(case((RoundStat.not_found, 1), else_=0)), 0),
                        func.count(RoundStat.id),
                        func.count(func.distinct(RoundStat.game_id)),
                    ).where(RoundStat.player_id == other_id)
                )
            ).one()
            a, b = _pair(pid, other_id)
            fr = await ses.scalar(select(Friendship).where(Friendship.a_id == a, Friendship.b_id == b))
        if other_id == pid:
            rel = "self"
        elif fr is None:
            rel = "none"
        elif fr.status == "accepted":
            rel = "friends"
        else:
            rel = "requested" if fr.requested_by == pid else "incoming"
        s = world.sessions.get(other_id)
        return {
            "id": p.id,
            "username": p.username or p.nickname,
            "home_area": p.home_area,
            "avatar": p.avatar,
            # Boju points: 10 per hider found as Boju, 10 per round survived unseen
            "points": int(finds) * 10 + int(escapes) * 10,
            "finds": int(finds),
            "escapes": int(escapes),
            "rounds": int(rounds),
            "games": int(games),
            "online": bool(s and s.connected),
            "relation": rel,
        }

    # ------------------------------------------------------------ direct messages (friends only)
    async def ensure_friends(ses: Any, pid: str, other: str) -> None:
        a, b = _pair(pid, other)
        ok = await ses.scalar(
            select(Friendship.id).where(Friendship.a_id == a, Friendship.b_id == b, Friendship.status == "accepted")
        )
        if ok is None:
            raise HTTPException(403, "You can only message friends")

    @r.get("/dm/{other_id}")
    async def dm_history(other_id: str, pid: Me) -> dict[str, Any]:
        if len(other_id) > 32:
            raise HTTPException(404, "Unknown player")
        async with db.sessions() as ses, ses.begin():
            await ensure_friends(ses, pid, other_id)
            rows = (
                await ses.scalars(
                    select(DirectMessage)
                    .where(
                        or_(
                            and_(DirectMessage.sender_id == pid, DirectMessage.recipient_id == other_id),
                            and_(DirectMessage.sender_id == other_id, DirectMessage.recipient_id == pid),
                        )
                    )
                    .order_by(DirectMessage.id.desc())
                    .limit(60)
                )
            ).all()
            await ses.execute(
                update(DirectMessage)
                .where(
                    DirectMessage.sender_id == other_id,
                    DirectMessage.recipient_id == pid,
                    DirectMessage.read.is_(False),
                )
                .values(read=True)
            )
        return {
            "messages": [
                {
                    "id": m.id,
                    "mine": m.sender_id == pid,
                    "text": m.body,
                    "ts": int(_aware(m.created_at).timestamp() * 1000),
                }  # type: ignore[union-attr]
                for m in reversed(rows)
            ]
        }

    @r.post("/dm/{other_id}")
    async def dm_send(other_id: str, body: DmIn, pid: Me) -> dict[str, Any]:
        if not dm_limit.allow(pid):
            raise HTTPException(429, "Slow down small")
        try:
            text = clean_chat(body.text, cfg.chat.max_len)
        except TextRejected as e:
            raise HTTPException(422, str(e)) from None
        async with db.sessions() as ses, ses.begin():
            await ensure_friends(ses, pid, other_id)
            m = DirectMessage(sender_id=pid, recipient_id=other_id, body=text)
            ses.add(m)
            await ses.flush()
            sender = await ses.get(Player, pid)
            out = {"id": m.id, "mine": True, "text": text, "ts": int(datetime.now(UTC).timestamp() * 1000)}
        if (s := world.sessions.get(other_id)) is not None:
            s.send(
                {
                    "t": "dm",
                    "from": pid,
                    "username": sender.username if sender else "?",
                    "text": text,
                    "id": out["id"],
                    "ts": out["ts"],
                }
            )
        return out

    return r
