"""The realtime world: sessions, hub shards, groups, message dispatch and the server tick."""

from __future__ import annotations

import asyncio
import itertools
import logging
import random
import secrets
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.content import HUB_MAP_ID, GameConfig, MapData
from app.db import ChatMessage, Game, RoundStat
from app.economy import Economy, InsufficientFunds
from app.engine import rules
from app.engine.geometry import distance, in_rect, validate_move
from app.realtime import protocol as P
from app.realtime.group import LIVE_PHASES, GroupError, GroupRoom
from app.realtime.rooms import HubShard, Room, Sender, Session
from app.safety import TextRejected, clean_chat

log = logging.getLogger("boju.world")

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
# (rate per second, burst) per inbound message type
LIMITS: dict[str, tuple[float, float]] = {
    "mv": (20, 30),
    "chat": (1, 5),
    "emote": (1, 3),
    "g_tag": (2, 3),
    "buy": (2, 4),
    "default": (4, 10),
}


class World:
    def __init__(
        self,
        cfg: GameConfig,
        maps: dict[str, MapData],
        sessions_factory: async_sessionmaker[AsyncSession],
        *,
        clock: Callable[[], float] = time.time,
        rng: random.Random | None = None,
    ) -> None:
        self.cfg = cfg
        self.maps = maps
        self.db = sessions_factory
        self.economy = Economy(sessions_factory, cfg)
        self.now = clock
        self.rng = rng or secrets.SystemRandom()
        self.sessions: dict[str, Session] = {}
        self.shards: list[HubShard] = []
        self.groups: dict[str, GroupRoom] = {}  # by code
        self._net_ids = itertools.count(1)
        self._shard_ids = itertools.count(1)

    # ------------------------------------------------------------ connection lifecycle
    async def connect(self, pid: str, nick: str, sender: Sender) -> Session:
        now = self.now()
        s = self.sessions.get(pid)
        if s is not None:
            if s.sender is not None:
                s.send({"t": "kicked", "msg": "Opened in another tab"})
            s.sender = sender
            s.disconnected_at = None
        else:
            s = Session(pid=pid, nick=nick, net_id=next(self._net_ids), sender=sender, last_move_at=now)
            s.stamina = self.cfg.movement.stamina_max_s
            self.sessions[pid] = s
        s.send(
            {
                "t": "hello",
                "me": {"id": pid, "nick": s.nick, "n": s.net_id},
                "server_time": int(now * 1000),
            }
        )
        if s.room is None:
            self.join_hub(s)
        else:  # reconnect: resend where you are
            s.room.add(s, s.x, s.z, now)
        if s.group is not None:
            s.send(s.group.state_msg("reconnected"))
            await self.send_chat_history(s, s.group)
        await self.push_wallet(s)
        return s

    def disconnect(self, s: Session, sender: Sender) -> None:
        if s.sender is not sender:
            return  # an older socket closing after a reconnect
        s.sender = None
        s.disconnected_at = self.now()
        if s.room is not None:
            s.room.broadcast_roster()
        if s.group is not None:
            s.group.broadcast_state("player_offline")

    # ------------------------------------------------------------ hub
    def join_hub(self, s: Session, prefer: HubShard | None = None) -> None:
        shard = prefer if prefer is not None and not prefer.full else None
        if shard is None and s.group is not None:
            for m in s.group.members:
                o = self.sessions.get(m)
                if o and isinstance(o.room, HubShard) and not o.room.full:
                    shard = o.room
                    break
        if shard is None:
            shard = next((h for h in self.shards if not h.full), None)
        if shard is None:
            shard = HubShard(
                f"hub:{next(self._shard_ids)}",
                self.maps[HUB_MAP_ID],
                self.cfg.network.hub_interest_radius_m,
                self.cfg.network.hub_shard_max,
            )
            self.shards.append(shard)
        x, z = shard.spawn_point(len(shard.sessions))
        if isinstance(s.room, HubShard) and s.room is not shard:
            x, z = s.x, s.z  # moving shards keeps your spot
        shard.add(s, x, z, self.now())
        s.frozen = False
        s.spectator = False

    # ------------------------------------------------------------ dispatch
    async def handle(self, s: Session, raw: bytes) -> None:
        if len(raw) > self.cfg.network.max_frame_bytes:
            raise P.BadMessage("frame too large")
        msg = P.decode(raw)
        rate, burst = LIMITS.get(msg.t, LIMITS["default"])
        if not s.allow(msg.t if msg.t in LIMITS else "default", rate, burst):
            if msg.t != "mv":
                s.send({"t": "err", "msg": "Slow down small"})
            return
        try:
            if isinstance(msg, P.Move):
                self.on_move(s, msg)
            elif msg.t == "ping":
                s.send({"t": "pong", "server_time": int(self.now() * 1000)})
            elif isinstance(msg, P.Chat):
                await self.on_chat(s, msg)
            elif isinstance(msg, P.Emote):
                self.on_emote(s, msg)
            elif isinstance(msg, P.Buy):
                await self.on_buy(s, msg)
            else:
                await self.on_group(s, msg)
        except GroupError as e:
            s.send({"t": "err", "msg": str(e)})

    def on_move(self, s: Session, m: P.Move) -> None:
        now = self.now()
        room = s.room
        if room is None:
            return
        if s.frozen:
            self._correct(s, m.s, now)
            return
        mv = self.cfg.movement
        dt = now - s.last_move_at
        if m.c:
            cap = mv.crouch_speed
        elif m.r and s.stamina > -1.0:
            cap = mv.run_speed
        else:
            cap = mv.walk_speed
        check = validate_move(
            from_x=s.x,
            from_z=s.z,
            to_x=m.x,
            to_z=m.z,
            dt=min(dt, 1.0),
            max_speed=cap,
            tolerance=mv.speed_tolerance,
            radius=mv.player_radius,
            bounds=room.map.bounds,
            boxes=room.map.boxes,
        )
        if not check.ok:
            self._correct(s, m.s, now)
            return
        step = distance(s.x, s.z, m.x, m.z)
        span = max(dt, 0.05)
        if step / span > mv.walk_speed * 1.1:
            s.stamina -= span
        else:
            s.stamina = min(mv.stamina_max_s, s.stamina + mv.stamina_regen_per_s * span)
        s.x, s.z, s.ry, s.crouch, s.run = m.x, m.z, m.ry, m.c, m.r
        s.last_move_at = now

    def _correct(self, s: Session, seq: int, now: float) -> None:
        if now - s.last_corr_at > 0.2:
            s.last_corr_at = now
            s.send({"t": "corr", "x": round(s.x, 2), "z": round(s.z, 2), "s": seq})

    async def on_group(self, s: Session, msg: Any) -> None:
        if isinstance(msg, P.GroupCreate):
            if s.group is not None and s.group.phase != "over":
                raise GroupError("Leave your current group first")
            await self.create_group(s, msg)
            return
        if isinstance(msg, P.GroupJoin):
            if s.group is not None and s.group.phase != "over":
                raise GroupError("Leave your current group first")
            g = self.groups.get(msg.code.strip().upper())
            if g is None:
                raise GroupError("No group with that code")
            if s.group is not None:
                self.leave_group(s)
            async with g.lock:
                g.add_member(s)
            if isinstance(s.room, HubShard) and (c := self.sessions.get(g.creator)) and isinstance(c.room, HubShard):
                if c.room is not s.room and not c.room.full:
                    self.join_hub(s, prefer=c.room)
            await self.send_chat_history(s, g)
            return
        g = s.group
        if g is None:
            raise GroupError("You are not in a group")
        async with g.lock:
            if isinstance(msg, P.GroupSettings):
                g.update_settings(s, msg.model_dump(exclude={"t"}))
            elif isinstance(msg, P.Board):
                await g.board(s, msg.fare)
            elif isinstance(msg, P.Pick):
                g.pick(s, msg.n)
            elif msg.t == "g_start":
                await g.start(s)
            elif msg.t == "g_tag":
                res = g.tag(s)
                if res:
                    s.send(res)
            elif msg.t == "g_leave":
                self.leave_group(s)

    def validate_settings(self, raw: dict[str, Any]) -> dict[str, Any]:
        arena = self.maps.get(str(raw.get("arena")))
        if arena is None or arena.kind != "arena":
            raise GroupError("Unknown arena")
        if raw.get("hide") not in self.cfg.game.hide_time_options:
            raise GroupError("Invalid hide time")
        if raw.get("search") not in self.cfg.game.search_time_options:
            raise GroupError("Invalid search time")
        safe = raw.get("safe")
        if safe not in arena.safe_houses:
            safe = next(iter(arena.safe_houses))
        return {"arena": arena.id, "hide": raw["hide"], "search": raw["search"], "safe": safe}

    async def create_group(self, s: Session, msg: P.GroupCreate) -> GroupRoom:
        settings = self.validate_settings(msg.model_dump(exclude={"t"}))
        if s.group is not None:
            self.leave_group(s)
        code = "".join(self.rng.choice(CODE_ALPHABET) for _ in range(6))
        while code in self.groups:
            code = "".join(self.rng.choice(CODE_ALPHABET) for _ in range(6))
        async with self.db() as db, db.begin():
            game = Game(code=code, creator_id=s.pid, arena_id=settings["arena"], settings=settings)
            db.add(game)
            await db.flush()
            game_id = game.id
        g = GroupRoom(self, game_id, code, s, settings)
        self.groups[code] = g
        g.add_member(s)
        await self.send_chat_history(s, g)
        log.info("group_created game=%s code=%s by=%s", game_id, code, s.pid)
        return g

    def leave_group(self, s: Session) -> None:
        g = s.group
        if g is None:
            return
        g.leave(s)
        if not isinstance(s.room, HubShard):
            self.join_hub(s)
        s.send({"t": "g_left"})

    # ------------------------------------------------------------ chat & emotes
    def chat_locked(self, s: Session) -> bool:
        g = s.group
        return g is not None and g.phase in LIVE_PHASES and s.pid in g.members and s.pid not in g.left

    async def on_chat(self, s: Session, m: P.Chat) -> None:
        try:
            text = clean_chat(m.text, self.cfg.chat.max_len)
        except TextRejected as e:
            s.send({"t": "err", "msg": str(e)})
            return
        now = self.now()
        if m.ch == "group" and s.group is not None:
            if self.chat_locked(s):
                s.send({"t": "err", "msg": "Chat is locked during the round — use taunts!"})
                return
            g = s.group
            out = {"t": "chat", "ch": "group", "from": s.pid, "nick": s.nick, "text": text, "ts": int(now * 1000)}
            g.broadcast(out)
            async with self.db() as db, db.begin():
                db.add(ChatMessage(channel=f"group:{g.id}", player_id=s.pid, nickname=s.nick, body=text))
            return
        if isinstance(s.room, HubShard):
            out = {"t": "chat", "ch": "near", "from": s.pid, "nick": s.nick, "text": text, "ts": int(now * 1000)}
            for o in s.room.sessions.values():
                if distance(s.x, s.z, o.x, o.z) <= self.cfg.chat.nearby_radius_m:
                    o.send(out)
        else:
            s.send({"t": "err", "msg": "Nobody nearby to hear you"})

    def on_emote(self, s: Session, m: P.Emote) -> None:
        emote = next((e for e in self.cfg.emotes if e.id == m.id), None)
        if emote is None:
            return
        out = {"t": "emote", "from": s.pid, "n": s.net_id, "nick": s.nick, "id": emote.id, "text": emote.text}
        g = s.group
        if g is not None and s.room is g.arena:
            r = g.round
            if g.phase in LIVE_PHASES and r is not None and s.pid == r.seeker:
                return  # Boju doesn't taunt
            g.broadcast(out)
        elif s.room is not None:
            for o in s.room.sessions.values():
                if distance(s.x, s.z, o.x, o.z) <= self.cfg.chat.nearby_radius_m:
                    o.send(out)

    async def send_chat_history(self, s: Session, g: GroupRoom) -> None:
        async with self.db() as db:
            rows = (
                await db.scalars(
                    select(ChatMessage)
                    .where(ChatMessage.channel == f"group:{g.id}")
                    .order_by(ChatMessage.id.desc())
                    .limit(self.cfg.chat.history)
                )
            ).all()
        s.send(
            {
                "t": "chat_hist",
                "msgs": [
                    {
                        "ch": "group",
                        "from": r.player_id,
                        "nick": r.nickname,
                        "text": r.body,
                        "ts": int(r.created_at.replace(tzinfo=r.created_at.tzinfo or UTC).timestamp() * 1000),
                    }
                    for r in reversed(rows)
                ],
            }
        )

    async def purge_old_chat(self) -> None:
        cutoff = datetime.now(UTC) - timedelta(days=self.cfg.chat.retention_days)
        async with self.db() as db, db.begin():
            await db.execute(delete(ChatMessage).where(ChatMessage.created_at < cutoff))

    # ------------------------------------------------------------ economy hooks
    async def on_buy(self, s: Session, m: P.Buy) -> None:
        item = self.cfg.item(m.item)
        if item is None or item.category != "food":
            s.send({"t": "err", "msg": "Unknown item"})
            return
        zone = s.room.map.zones.get(item.spot or "") if s.room else None
        if zone is None or not in_rect(zone["rect"], s.x, s.z):
            s.send({"t": "err", "msg": f"Walk to the {item.spot or 'shop'} to buy {item.name}"})
            return
        try:
            await self.economy.buy_food(s.pid, item.id, f"buy:{s.pid}:{m.key}")
        except InsufficientFunds:
            s.send({"t": "err", "msg": "Omo, your money no reach"})
            return
        s.send({"t": "toast", "msg": f"You chopped {item.name}! Belle full."})
        await self.push_wallet(s)

    async def push_wallet(self, s: Session) -> None:
        bal = await self.economy.balance(s.pid)
        hunger = await self.economy.get_hunger(s.pid)
        s.send({"t": "wallet", "balance": bal, "hunger": round(hunger, 1)})

    async def apply_round(
        self, game_id: str, round_no: int, deltas: dict[str, int], outcome: rules.RoundOutcome, participants: list[str]
    ) -> dict[str, int]:
        applied: dict[str, int] = {}
        for pid, amount in deltas.items():
            if amount == 0:
                applied[pid] = 0
                continue
            got, _ = await self.economy.post(
                pid, amount, "round", f"round:{game_id}:{round_no}:{pid}", ref=game_id, clamp=True
            )
            applied[pid] = got
        if not outcome.skipped:
            for pid in participants:
                if pid not in outcome.idle:
                    await self.economy.change_hunger(pid, -self.cfg.game.hunger_per_round)
            async with self.db() as db, db.begin():
                db.add(
                    RoundStat(
                        game_id=game_id,
                        round_no=round_no,
                        player_id=outcome.seeker,
                        role="seeker",
                        finds=len(outcome.found_order),
                        earned=applied.get(outcome.seeker, 0),
                    )
                )
                for h in outcome.hiders:
                    if h in outcome.idle:
                        continue
                    db.add(
                        RoundStat(
                            game_id=game_id,
                            round_no=round_no,
                            player_id=h,
                            role="hider",
                            not_found=h not in outcome.found_order,
                            earned=applied.get(h, 0),
                        )
                    )
        for pid in participants:
            if (s := self.sessions.get(pid)) is not None:
                await self.push_wallet(s)
        return applied

    async def save_game_results(self, game_id: str, results: list[dict[str, Any]]) -> None:
        async with self.db() as db, db.begin():
            game = await db.get(Game, game_id)
            if game is not None:
                game.results = {"standings": results}
                game.ended_at = datetime.now(UTC)

    # ------------------------------------------------------------ tick
    async def tick(self) -> None:
        now = self.now()
        for code, g in list(self.groups.items()):
            try:
                async with g.lock:
                    await g.update(now)
            except Exception:
                log.exception("group update failed game=%s", g.id)
            if self._group_expired(g, now):
                self._drop_group(code, g)
        now_ms = int(now * 1000)
        rooms: list[Room] = [*self.shards, *(g.arena for g in self.groups.values())]
        for room in rooms:
            room.snapshot(now_ms)
        # forget players who left without a group after a grace period
        for pid, s in list(self.sessions.items()):
            if s.sender is None and s.group is None and s.disconnected_at and now - s.disconnected_at > 60:
                if s.room is not None:
                    s.room.remove(s)
                del self.sessions[pid]
        self.shards = [h for h in self.shards if h.sessions] or self.shards[:1]

    def _group_expired(self, g: GroupRoom, now: float) -> bool:
        online = [p for p in g.members if p not in g.left and (s := self.sessions.get(p)) and s.connected]
        if g.phase == "over":
            return not online or now - g.phase_end > 600
        if g.phase == "lobby":
            return not g.members or (not online and now - g.last_activity > self.cfg.game.lobby_idle_expiry_s)
        return (
            not online
            and now - g.last_tick > 0
            and all(
                (s := self.sessions.get(p)) is None or (s.disconnected_at and now - s.disconnected_at > 300)
                for p in g.members
            )
        )

    def _drop_group(self, code: str, g: GroupRoom) -> None:
        self.groups.pop(code, None)
        for p in g.members:
            s = self.sessions.get(p)
            if s is not None and s.group is g:
                s.group = None
                if s.room is g.arena:
                    self.join_hub(s)
        log.info("group_closed game=%s", g.id)

    async def run(self) -> None:
        period = 1.0 / self.cfg.network.snapshot_hz
        last_purge = 0.0
        while True:
            started = time.monotonic()
            try:
                await self.tick()
                if started - last_purge > 3600:
                    last_purge = started
                    await self.purge_old_chat()
            except Exception:
                log.exception("tick failed")
            await asyncio.sleep(max(0.0, period - (time.monotonic() - started)))
