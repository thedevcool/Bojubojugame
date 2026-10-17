"""The realtime world: sessions, hub shards, groups, message dispatch and the server tick."""

from __future__ import annotations

import asyncio
import itertools
import logging
import math
import random
import secrets
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import houses
from app.avatar import FEMALE, MALE
from app.content import HUB_MAP_ID, GameConfig, MapData
from app.db import ChatMessage, FurnitureItem, Game, Player, RoundStat
from app.economy import Economy, InsufficientFunds
from app.engine import rules
from app.engine.geometry import Box, MoveCheck, collides, distance, in_bounds, in_rect, validate_move
from app.realtime import protocol as P
from app.realtime.bots import FEMALE_NAMES
from app.realtime.group import LIVE_PHASES, GroupError, GroupRoom
from app.realtime.rooms import ExploreRoom, HubShard, Room, Sender, Session
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
    "g_invite": (0.5, 4),
    "knock": (0.3, 3),
    "trip": (0.5, 3),
    "watch": (2, 6),
    "knock_answer": (2, 6),
    "default": (4, 10),
}


def furniture_row(it: FurnitureItem) -> dict[str, Any]:
    return {"id": it.id, "item": it.item, "lx": round(it.lx, 2), "lz": round(it.lz, 2), "rot": it.rot % 4}


REMATCH_WAIT_S = 30


@dataclass
class RematchAsk:
    old: GroupRoom
    by: str
    nick: str
    invited: set[str]
    until: float
    yes: set[str] = field(default_factory=set)
    no: set[str] = field(default_factory=set)
    code: str | None = None  # the rematch game, once someone said yes


IBADAN_HOME = "arena_akobo"  # Ibadan players live (and always spawn) in Akobo
MATCH_SIZE = 4  # "Match me" fills a game to this many real players…
MATCH_WAIT_S = 12.0  # …or starts this long after a second player joins
MATCH_ALONE_S = 40.0  # nobody else came: NPCs fill in and it starts
STANDIN_KEEP_S = 30 * 60.0  # someone who closed the app keeps standing in the world this long, then goes offline


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
        # house id -> tenant id (one per house); house id -> visitors the tenant let in
        self.home_owners: dict[str, str] = {}
        self.guests: dict[str, set[str]] = {}
        # house id -> placed furniture (local coords) and the solid boxes it adds to the hub
        self._watch_tick = 0
        self.explore: dict[str, ExploreRoom] = {}  # arena id -> open venue room for travellers
        self.furniture: dict[str, list[dict[str, Any]]] = {}
        self.furniture_boxes: dict[str, list[Box]] = {}
        # LagosLife (mini version) players: their money lives in LagosLife, so rides are free
        # and hunger doesn't stop them playing
        self.mini: set[str] = set()
        # called with (game_id, final_results) when a game ends (LagosLife match results)
        self.game_over_hooks: list[Callable[[str, list[dict[str, Any]]], Awaitable[None]]] = []
        self.rematches: dict[str, RematchAsk] = {}  # finished game id -> open "play again" request
        self.last_spots: dict[str, tuple[float, float, float]] = {}  # pid -> where they were in Lagos (x, z, when)
        self.timed_out: dict[str, str] = {}  # pid -> code of the game they were taken out of for being away too long
        self._net_ids = itertools.count(1)
        self._shard_ids = itertools.count(1)

    # ------------------------------------------------------------ connection lifecycle
    async def connect(
        self,
        pid: str,
        nick: str,
        sender: Sender,
        avatar: list[int] | None = None,
        home_id: str | None = None,
        car: str | None = None,
        city: str | None = None,
    ) -> Session:
        now = self.now()
        s = self.sessions.get(pid)
        if s is not None:
            if s.sender is not None:
                s.send({"t": "kicked", "msg": "Opened in another tab"})
            s.sender = sender
            s.disconnected_at = None
        else:
            s = Session(
                home_id=home_id,
                pid=pid,
                nick=nick,
                net_id=next(self._net_ids),
                sender=sender,
                last_move_at=now,
                avatar=avatar or [0, 0, 0],
            )
            s.stamina = self.cfg.movement.stamina_max_s
            self.sessions[pid] = s
        s.car = car
        if city in ("lagos", "ibadan"):
            s.city = city
        s.send(
            {
                "t": "hello",
                "me": {"id": pid, "nick": s.nick, "n": s.net_id},
                "home": self.maps[HUB_MAP_ID].home_by_id(s.home_id),
                "server_time": int(now * 1000),
                "in_group": s.group is not None,
            }
        )
        s.send(self.doors_msg())
        s.send({"t": "furn_all", "homes": self.furniture})
        if s.room is None:
            spot = self.last_spots.pop(pid, None)
            if spot and s.city == "lagos":
                self.join_hub(s, at=self.free_spot((spot[0], spot[1]), exclude=pid))
            else:
                self.send_home(s, arriving=True)
        else:  # reconnect: resend where you are
            s.room.add(s, s.x, s.z, now)
        if (code := self.timed_out.pop(pid, None)) is not None:
            s.send({"t": "toast", "msg": f"You were away for over 30 minutes, so you were taken out of game {code}."})
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
        # the owner must be online for visitors; a leaving visitor loses their invite
        for h, owner in self.home_owners.items():
            if owner == s.pid:
                self.close_doors(h)
        for guests in self.guests.values():
            guests.discard(s.pid)
        if s.room is not None:
            s.room.broadcast_roster()
        if s.group is not None:
            s.group.broadcast_state("player_offline")

    # ------------------------------------------------------------ hub
    def home_spawn(self, s: Session) -> tuple[float, float]:
        """Inside your rented home; brand-new players start beside the phone shop."""
        hub = self.maps[HUB_MAP_ID]
        home = hub.home_by_id(s.home_id)
        base = (home["spawn"][0], home["spawn"][1]) if home else hub.newcomer
        return self.free_spot(base, exclude=s.pid)

    def free_spot(self, base: tuple[float, float], exclude: str | None = None) -> tuple[float, float]:
        """Nearest standable point to ``base`` that isn't inside a prop or another player.

        Everyone without a house shares the newcomer spawn (and housemates share a
        bed-side spawn), so without this players appeared inside each other.
        """
        hub = self.maps[HUB_MAP_ID]
        r = self.cfg.movement.player_radius
        others = [
            (o.x, o.z)
            for o in self.sessions.values()
            if o.pid != exclude and o.room is not None and o.room.map.id == HUB_MAP_ID
        ]
        for i in range(48):
            ang, rad = i * 2.399963, 0.0 if i == 0 else 0.7 + 0.45 * math.sqrt(i)
            x, z = base[0] + math.cos(ang) * rad, base[1] + math.sin(ang) * rad
            near = hub.near(x, z, x, z) + self.furniture_near(x, z, x, z)
            if not in_bounds(hub.bounds, x, z, r) or collides(x, z, r + 0.05, near):
                continue
            if all(math.hypot(x - ox, z - oz) > 0.9 for ox, oz in others):
                return round(x, 2), round(z, 2)
        return base

    def set_home(self, pid: str, home_id: str | None) -> None:
        for h, owner in list(self.home_owners.items()):
            if owner == pid and h != home_id:
                del self.home_owners[h]
                self.close_doors(h)
        if home_id is not None:
            if self.home_owners.get(home_id) not in (None, pid):
                self.close_doors(home_id)
            self.home_owners[home_id] = pid
        self.broadcast_doors()
        s = self.sessions.get(pid)
        if s is None:
            return
        s.home_id = home_id
        s.send({"t": "home", "home": self.maps[HUB_MAP_ID].home_by_id(home_id)})

    # ------------------------------------------------------------ house visits (knock, owner answers)
    async def load_home_owners(self) -> None:
        async with self.db() as ses:
            rows = (await ses.execute(select(Player.id, Player.home_id).where(Player.home_id.is_not(None)))).all()
            self.home_owners = {home: pid for pid, home in rows}
            items = (
                await ses.scalars(
                    select(FurnitureItem).where(
                        FurnitureItem.placed.is_(True), FurnitureItem.player_id.in_(list(self.home_owners.values()))
                    )
                )
            ).all()
        owner_home = {pid: home for home, pid in self.home_owners.items()}
        grouped: dict[str, list[dict[str, Any]]] = {}
        for it in items:
            if (h := owner_home.get(it.player_id)) is not None:
                grouped.setdefault(h, []).append(furniture_row(it))
        for h, rows_ in grouped.items():
            self.set_furniture(h, rows_, broadcast=False)

    # ------------------------------------------------------------ furniture inside houses
    def set_furniture(self, home_id: str, items: list[dict[str, Any]], broadcast: bool = True) -> None:
        home = self.maps[HUB_MAP_ID].home_by_id(home_id)
        if home is None:
            return
        catalog = self.cfg.furniture_by_id()
        boxes: list[Box] = []
        for it in items:
            spec = catalog.get(it["item"])
            if spec is None or not spec.solid:
                continue
            fw, fd = houses.footprint(spec.w, spec.d, it["rot"])
            if home["dir"] in ("e", "w"):
                fw, fd = fd, fw
            x, z = houses.to_world(home["dir"], home["center"][0], home["center"][1], it["lx"], it["lz"])
            boxes.append(Box(x - fw / 2, z - fd / 2, x + fw / 2, z + fd / 2, spec.h))
        self.furniture[home_id] = items
        self.furniture_boxes[home_id] = boxes
        if broadcast:
            msg = {"t": "furn", "home": home_id, "items": items}
            for sh in self.shards:
                sh.broadcast(msg)

    def furniture_near(self, x0: float, z0: float, x1: float, z1: float) -> list[Box]:
        lo_x, hi_x, lo_z, hi_z = min(x0, x1) - 1, max(x0, x1) + 1, min(z0, z1) - 1, max(z0, z1) + 1
        out: list[Box] = []
        for boxes in self.furniture_boxes.values():
            out += [b for b in boxes if b.min_x <= hi_x and b.max_x >= lo_x and b.min_z <= hi_z and b.max_z >= lo_z]
        return out

    def doors_msg(self) -> dict[str, Any]:
        return {"t": "doors", "owners": dict(self.home_owners)}

    def broadcast_doors(self) -> None:
        msg = self.doors_msg()
        for sh in self.shards:
            sh.broadcast(msg)

    def home_at(self, x: float, z: float) -> dict[str, Any] | None:
        return next((h for h in self.maps[HUB_MAP_ID].homes if in_rect(h["rect"], x, z)), None)

    def may_enter(self, s: Session, home_id: str) -> bool:
        owner = self.home_owners.get(home_id)
        return owner is None or owner == s.pid or s.pid in self.guests.get(home_id, set())

    def close_doors(self, home_id: str) -> None:
        """Owner left (or the house changed hands): visitors are walked back out to the door."""
        hub = self.maps[HUB_MAP_ID]
        home = hub.home_by_id(home_id)
        for gid in self.guests.pop(home_id, set()):
            g = self.sessions.get(gid)
            if g is None:
                continue
            g.send({"t": "door", "home": home_id, "open": False})
            if home and g.room is not None and g.room.map.id == HUB_MAP_ID and in_rect(home["rect"], g.x, g.z):
                x, z = self.free_spot((home["door"][0], home["door"][1]), exclude=gid)
                g.place(x, z, self.now())
                g.send({"t": "toast", "msg": "The owner left, so you stepped back outside 🚪"})

    def on_knock(self, s: Session, m: P.Knock) -> None:
        home = self.maps[HUB_MAP_ID].home_by_id(m.home)
        owner_id = self.home_owners.get(m.home)
        if home is None or owner_id is None or owner_id == s.pid:
            raise GroupError("Nobody lives here — the door is open")
        if s.room is None or s.room.map.id != HUB_MAP_ID or distance(s.x, s.z, *home["door"]) > 5:
            raise GroupError("Walk up to the door to knock")
        owner = self.sessions.get(owner_id)
        if owner is None or not owner.connected:
            raise GroupError(f"Nobody answered — {home['name']}'s owner is not online")
        if s.pid in self.guests.get(m.home, set()):
            s.send({"t": "door", "home": m.home, "open": True, "by": owner.nick})
            return
        owner.send({"t": "knock", "from": s.pid, "nick": s.nick, "home": m.home})
        s.send({"t": "toast", "msg": f"🚪 Knock knock… waiting for {owner.nick} to answer"})

    def on_knock_answer(self, s: Session, m: P.KnockAnswer) -> None:
        home_id = next((h for h, o in self.home_owners.items() if o == s.pid), None)
        v = self.sessions.get(m.to)
        if home_id is None or v is None:
            return
        if m.ok:
            self.guests.setdefault(home_id, set()).add(v.pid)
            v.send({"t": "door", "home": home_id, "open": True, "by": s.nick})
            v.send({"t": "toast", "msg": f"🚪 {s.nick} opened the door — come in!"})
        else:
            v.send({"t": "toast", "msg": f"{s.nick} can't take visitors right now"})

    def go_home(self, s: Session) -> None:
        """Ride from the arena back to your house (or the motor park if you have none)."""
        g = s.group
        arena = g.settings["arena"] if g else None
        if g is not None:
            self.leave_group(s, quiet=True)
        self.send_home(s)
        s.crouch = s.sit = s.lie = False
        if arena:
            fare = min(self.cfg.fares_for(arena), key=lambda f: f.price)
            s.send({"t": "ride", "seconds": fare.ride_s, "mode": fare.id, "arena": arena, "dir": "home"})

    def send_home(self, s: Session, arriving: bool = False) -> None:
        """Your city: Lagos players to the hub (their house or the motor park), Ibadan players to Akobo."""
        if s.city == "ibadan":
            m = self.maps[IBADAN_HOME]
            stop = m.zones.get("bus_stop")
            base = (
                ((stop["rect"][0] + stop["rect"][2]) / 2, (stop["rect"][1] + stop["rect"][3]) / 2) if stop else m.spawn
            )
            self.explore_room(IBADAN_HOME).add(
                s, base[0] + self.rng.uniform(-1.5, 1.5), base[1] + self.rng.uniform(-1, 1), self.now()
            )
            return
        hub = self.maps[HUB_MAP_ID]
        # coming online: your house, or beside the shops for newcomers; back from a game: house or motor park
        at = self.home_spawn(s) if arriving or hub.home_by_id(s.home_id) else self.arrival_point()
        self.join_hub(s, at=at)

    def set_city(self, pid: str, city: str) -> None:
        """Chose (or detected) your city: you live there from now on — move there now if you're not in a game."""
        s = self.sessions.get(pid)
        if s is None or s.city == city:
            if s is not None:
                s.city = city
            return
        s.city = city
        if s.group is None:
            self.send_home(s)

    def join_hub(self, s: Session, prefer: HubShard | None = None, at: tuple[float, float] | None = None) -> None:
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
        if at is not None:
            x, z = at
        elif isinstance(s.room, HubShard) and s.room is not shard:
            x, z = s.x, s.z  # moving shards keeps your spot
        shard.add(s, x, z, self.now())
        s.frozen = False
        s.spectator = False

    def arrival_point(self) -> tuple[float, float]:
        ax, az = self.maps[HUB_MAP_ID].arrival
        return self.free_spot((ax + self.rng.uniform(-1, 1), az + self.rng.uniform(-0.5, 0.5)))

    def set_avatar(self, pid: str, avatar: list[int]) -> None:
        s = self.sessions.get(pid)
        if s is None:
            return
        s.avatar = avatar
        if s.room is not None:
            s.room.broadcast_roster()

    # ------------------------------------------------------------ NPC players
    def create_bot(self, name: str) -> Session:
        pid = f"bot_{self.rng.getrandbits(64):016x}"
        r = self.rng.randrange
        s = Session(
            pid=pid,
            nick=name,
            net_id=next(self._net_ids),
            avatar=[r(8), r(8), r(8), FEMALE if name in FEMALE_NAMES else MALE, r(4)],
            bot=True,
            last_move_at=self.now(),
        )
        self.sessions[pid] = s
        return s

    def drop_bot(self, pid: str) -> None:
        s = self.sessions.pop(pid, None)
        if s is not None and s.room is not None:
            s.room.remove(s)

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
            elif isinstance(msg, P.Invite):
                self.on_invite(s, msg)
            elif isinstance(msg, P.Rematch):
                await self.on_rematch(s, msg.answer)
            elif isinstance(msg, P.Watch):
                if msg.code is not None and msg.code.upper() not in self.groups:
                    raise GroupError("That game has ended")
                s.watching = msg.code.upper() if msg.code else None
            elif isinstance(msg, P.Trip):
                await self.on_trip(s, msg)
            elif isinstance(msg, P.Knock):
                self.on_knock(s, msg)
            elif isinstance(msg, P.KnockAnswer):
                self.on_knock_answer(s, msg)
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
        car = self.cfg.car(s.car) if m.dr and s.car else None
        in_game = s.group is not None and s.group.phase not in ("lobby", "over") and s.room is s.group.arena
        if car is not None and (in_game or not (room.map.kind == "hub" or isinstance(room, ExploreRoom))):
            car = None  # no driving inside a running game
        if car is not None:
            cap = car.speed
        elif m.c and s.crouch:  # only cap at crouch speed once the server already saw the crouch
            cap = mv.crouch_speed
        elif m.r and s.stamina > -2.0:
            cap = mv.run_speed
        else:
            cap = mv.walk_speed
        # Speed check against a budget that refills over real time, not per packet: mobile
        # networks deliver moves in bursts, and a per-packet dt made honest players snap back.
        burst = cap * mv.speed_tolerance * 0.6 + 0.3
        budget = min(s.move_budget + cap * mv.speed_tolerance * max(0.0, min(dt, 1.0)), burst)
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
            boxes=room.map.near(s.x, s.z, m.x, m.z)
            + (self.furniture_near(s.x, s.z, m.x, m.z) if room.map.id == HUB_MAP_ID else []),
            max_step=budget + 0.05,
        )
        if check.ok and room.map.id == HUB_MAP_ID:
            target = self.home_at(m.x, m.z)
            if target is not None and car is not None and not in_rect(target["rect"], s.x, s.z):
                check = MoveCheck(False, "car")  # no driving into houses
            elif target is not None and not in_rect(target["rect"], s.x, s.z) and not self.may_enter(s, target["id"]):
                check = MoveCheck(False, "locked")  # knock first: the owner must let you in
        if not check.ok:
            s.move_budget = budget
            s.last_move_at = now
            self._correct(s, m.s, now)
            return
        step = distance(s.x, s.z, m.x, m.z)
        s.move_budget = max(0.0, budget - step)
        # breath refills over real time, standing still too (no moves are sent then), like it does on the phone;
        # a server that refilled only on moves saw an honest runner as out of breath and dragged them back
        span = max(min(now - s.last_move_at, 60.0), 0.05)
        if m.r and step > 0:
            s.stamina -= step / mv.run_speed  # time spent running, independent of packet timing
        else:
            regen = mv.stamina_regen_per_s + (2.0 if m.ly else 0.0)  # a nap restores it faster
            s.stamina = min(mv.stamina_max_s, s.stamina + regen * span)
        s.x, s.z, s.ry, s.crouch, s.run, s.sit, s.lie = m.x, m.z, m.ry, m.c, m.r, m.st, m.ly
        s.driving = bool(m.dr and s.car and not in_game)
        s.last_move_at = now

    # ------------------------------------------------------------ travel without a game
    def explore_room(self, arena_id: str) -> ExploreRoom:
        r = self.explore.get(arena_id)
        if r is None:
            r = self.explore[arena_id] = ExploreRoom(f"explore:{arena_id}", self.maps[arena_id])
        return r

    async def on_trip(self, s: Session, m: P.Trip) -> None:
        """Board at the bus stop (pay the fare) or drive your own car to a pinned place."""
        g = s.group
        if g is not None and g.phase != "over":
            raise GroupError("Finish or leave your game first")
        room = s.room
        if room is None:
            return
        here = room.map.id
        dest_map = self.maps.get(m.to) if m.to != "hub" else self.maps[HUB_MAP_ID]
        if dest_map is None or (m.to != "hub" and dest_map.kind != "arena"):
            raise GroupError("Unknown place")
        if dest_map.id == here:
            raise GroupError("You are already here")
        city_arena = m.to if m.to != "hub" else here
        if m.mode == "own_car":
            car = self.cfg.car(s.car) if s.car else None
            if car is None:
                raise GroupError("Buy a car first — Tokunbo Autos is beside the motor park")
            seconds, price, mode = max(4.0, min(f.ride_s for f in self.cfg.fares_for(city_arena)) * 0.7), 0, "own_car"
        else:
            fare = next((f for f in self.cfg.fares_for(city_arena) if f.id == m.mode), None)
            if fare is None:
                raise GroupError("Unknown ride")
            stop = room.map.zones.get("bus_stop")
            if stop is None or not in_rect(stop["rect"], s.x, s.z):
                raise GroupError("Walk to the bus stop to board")
            seconds, price, mode = fare.ride_s, fare.price, fare.id
        if price and s.pid not in self.mini:
            try:
                await self.economy.post(s.pid, -price, "fare", f"trip:{s.pid}:{m.key}", ref=f"{here}>{m.to}")
            except InsufficientFunds:
                raise GroupError("Your money no reach for this ride") from None
            await self.push_wallet(s)
        if g is not None:
            self.leave_group(s, quiet=True)
        s.crouch = s.sit = s.lie = s.driving = False
        if m.to == "hub":
            self.send_home(s)
            s.send({"t": "ride", "seconds": seconds, "mode": mode, "arena": here, "dir": "home"})
        else:
            dest = self.explore_room(m.to)
            stop = dest_map.zones.get("bus_stop")
            x, z = (
                ((stop["rect"][0] + stop["rect"][2]) / 2, (stop["rect"][1] + stop["rect"][3]) / 2)
                if stop
                else dest_map.spawn
            )
            dest.add(s, x + self.rng.uniform(-1.5, 1.5), z + self.rng.uniform(-1, 1), self.now())
            s.send({"t": "ride", "seconds": seconds, "mode": mode, "arena": m.to, "dir": "go"})

    def on_invite(self, s: Session, m: P.Invite) -> None:
        """Invite any online player you can see to your lobby (they get a Join prompt)."""
        g = s.group
        if g is None or g.phase != "lobby":
            raise GroupError("Create a game first, then invite people")
        t = self.sessions.get(m.to)
        if t is None or t.bot or not t.connected or t.pid == s.pid:
            raise GroupError("That player is not online")
        if t.pid in g.members and t.pid not in g.left:
            raise GroupError(f"{t.nick} is already in your game")
        t.send({"t": "invite", "from": s.pid, "nick": s.nick, "code": g.code})
        s.send({"t": "toast", "msg": f"Invite sent to {t.nick} 📨"})

    async def on_rematch(self, s: Session, answer: str | None) -> None:
        """Play again = a rematch request. The other players get Accept / No; if at least one accepts,
        a new private game (same settings, no NPCs) starts with everyone who said yes. Nobody: no rematch."""
        g = s.group
        if g is None or g.phase != "over":
            raise GroupError("Finish this game first")
        ask = self.rematches.get(g.id)
        if ask is None:
            if answer == "no":
                return
            others = [
                p for p in g.members
                if p != s.pid and p not in g.bots and (t := self.sessions.get(p)) and t.connected and t.group is g
            ]  # fmt: skip
            if not others:
                raise GroupError("Nobody from this game is still here for a rematch")
            ask = RematchAsk(old=g, by=s.pid, nick=s.nick, invited=set(others), until=self.now() + REMATCH_WAIT_S)
            self.rematches[g.id] = ask
            for p in others:
                self.sessions[p].send({"t": "rematch_ask", "from": s.pid, "nick": s.nick, "secs": REMATCH_WAIT_S})
            s.send({"t": "rematch_wait", "n": len(others), "secs": REMATCH_WAIT_S})
            return
        if s.pid == ask.by or s.pid in ask.yes or s.pid in ask.no:
            return
        if s.pid not in ask.invited:
            raise GroupError("That rematch is only for the last game's players")
        asker = self.sessions.get(ask.by)
        if answer == "no":
            ask.no.add(s.pid)
            if asker is not None:
                asker.send({"t": "toast", "msg": f"{s.nick} no wan rematch 🙅🏾"})
            return
        ask.yes.add(s.pid)
        if ask.code is None:
            # the first yes: the rematch game exists now (the asker is its creator)
            if asker is None or not asker.connected or asker.group is not g:
                self.rematches.pop(g.id, None)
                raise GroupError("The rematch was cancelled")
            ng = await self.create_group(
                asker,
                P.GroupCreate(
                    t="g_create", arena=g.settings["arena"], hide=g.settings["hide"], search=g.settings["search"],
                    safe=g.settings["safe"], bots=0, public=False,
                ),
            )  # fmt: skip
            ask.code = ng.code
        await self.on_group(s, P.GroupJoin(t="g_join", code=ask.code))
        if asker is not None:
            asker.send({"t": "toast", "msg": f"{s.nick} accepted the rematch! 🔁"})

    async def settle_rematches(self) -> None:
        """Start a rematch once everyone answered (or time ran out); with no yes, it's off."""
        now = self.now()
        for gid, ask in list(self.rematches.items()):
            if now < ask.until and not ask.invited <= ask.yes | ask.no:
                continue
            del self.rematches[gid]
            asker = self.sessions.get(ask.by)
            ng = self.groups.get(ask.code) if ask.code else None
            for p in ask.invited | {ask.by}:
                if (t := self.sessions.get(p)) is not None:
                    t.send({"t": "rematch_end"})
            if ng is None or asker is None or ng.phase != "lobby":
                if asker is not None:
                    asker.send({"t": "toast", "msg": "Nobody accepted — no rematch this time 😅"})
                continue
            try:
                async with ng.lock:
                    await ng.start(asker)
            except GroupError as e:
                asker.send({"t": "err", "msg": f"Rematch couldn't start: {e}"})

    def _correct(self, s: Session, seq: int, now: float) -> None:
        if now - s.last_corr_at > 0.2:
            s.last_corr_at = now
            s.send({"t": "corr", "x": round(s.x, 2), "z": round(s.z, 2), "s": seq})

    async def on_group(self, s: Session, msg: Any) -> None:
        if isinstance(msg, P.Bare) and msg.t == "g_match":
            await self.match_me(s)
            return
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
            elif msg.t == "g_add_bot":
                g.add_bot(s)
            elif isinstance(msg, P.RemoveBot):
                g.remove_bot(s, msg.id)
            elif msg.t == "g_leave":
                self.leave_group(s)
            elif msg.t == "g_cancel":
                self.cancel_group(s)
            elif msg.t in ("g_pause", "g_resume"):
                g.pause_requested = msg.t == "g_pause"  # only acted on in a solo game (see GroupRoom.update_pause)
            elif msg.t == "g_return":
                if g.phase != "over":
                    raise GroupError("Finish the game first")
                self.go_home(s)

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
        settings = self.validate_settings(msg.model_dump(exclude={"t", "bots"}))
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
        g.public = msg.public
        self.groups[code] = g
        g.add_member(s)
        for _ in range(min(msg.bots, self.cfg.game.max_players - 1)):
            g.add_bot(s)
        await self.send_chat_history(s, g)
        log.info("group_created game=%s code=%s by=%s", game_id, code, s.pid)
        return g

    # ------------------------------------------------------------ "Match me"
    async def match_me(self, s: Session) -> GroupRoom:
        """Put a player into the best waiting match: same city first, then the fullest lobby (it starts soonest),
        then the oldest (whoever waited longest). No match waiting: open one — the next "Match me" lands there."""
        if s.group is not None and s.group.phase != "over":
            if s.group.matchmade and s.group.phase == "lobby":
                return s.group  # already waiting
            raise GroupError("Leave your current game first")
        best: tuple[tuple[int, int, float], GroupRoom] | None = None
        for g in self.groups.values():
            if not g.matchmade or g.phase != "lobby" or len(g.active) >= MATCH_SIZE or s.pid in g.left:
                continue
            host = self.sessions.get(g.creator)
            if host is None or not host.connected:
                continue
            rank = (0 if host.city == s.city else 1, -len(g.humans), g.created_at)
            if best is None or rank < best[0]:
                best = (rank, g)
        if best is not None:
            g = best[1]
            if s.group is not None:
                self.leave_group(s, quiet=True)
            g.add_member(s)
            if len(g.humans) >= 2 and g.match_ready_at is None:
                g.match_ready_at = self.now()
            await self.send_chat_history(s, g)
            return g
        arena = next((c.arenas[0] for c in self.cfg.cities if c.id == s.city), "arena_park")
        safe = next(iter(self.maps[arena].safe_houses))
        g = await self.create_group(
            s, P.GroupCreate(t="g_create", arena=arena, hide=30, search=180, safe=safe, public=True)
        )
        g.matchmade = True
        g.broadcast_state("matching")
        return g

    async def tick_matchmaking(self, now: float) -> None:
        """Matches start themselves: full, or soon after a second real player joins; alone too long, NPCs fill in."""
        for g in list(self.groups.values()):
            if not g.matchmade or g.phase != "lobby":
                continue
            online = [p for p in g.humans if (x := self.sessions.get(p)) and x.connected]
            host = self.sessions.get(g.creator)
            if host is None or not host.connected or not online:
                continue
            go = len(online) >= MATCH_SIZE or (
                len(online) >= 2 and g.match_ready_at is not None and now - g.match_ready_at >= MATCH_WAIT_S
            )
            if not go and len(online) == 1 and now - g.created_at >= MATCH_ALONE_S:
                while len(g.active) < 3:
                    g.add_bot(host)
                g.broadcast({"t": "toast", "msg": "Nobody else free right now — you're playing NPCs. Train well! 💪🏾"})
                go = True
            if go:
                try:
                    async with g.lock:
                        await g.start(host)
                except GroupError as e:
                    log.info("match start held game=%s: %s", g.id, e)

    def leave_group(self, s: Session, quiet: bool = False) -> None:
        g = s.group
        if g is None:
            return
        g.leave(s)
        if not quiet and not isinstance(s.room, HubShard):
            self.send_home(s)
        s.send({"t": "g_left"})
        if g.phase == "lobby" and not g.humans:  # only NPCs left waiting: nobody will ever start it
            self._drop_group(g.code, g)

    def cancel_group(self, s: Session) -> None:
        """The host calls the game off before it starts: everyone is told, and nobody is left in a dead lobby."""
        g = s.group
        if g is None:
            return
        if g.creator != s.pid or g.phase != "lobby":
            raise GroupError("Only the host can cancel, before the game starts — you can Leave")
        for p in g.humans:
            if p != s.pid and (o := self.sessions.get(p)) is not None:
                o.send({"t": "toast", "msg": f"{g.nicks.get(s.pid, 'The host')} cancelled game {g.code}"})
        self._drop_group(g.code, g)

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
        st = await self.get_streaks(s.pid)
        s.send({"t": "wallet", "balance": bal, **st})

    # ------------------------------------------------------------ streaks (for events later)
    STREAKS = ("hide_streak", "win_streak", "best_hide_streak", "best_win_streak")

    async def get_streaks(self, pid: str) -> dict[str, int]:
        async with self.db() as db:
            p = await db.get(Player, pid)
            f = (p.flags if p else None) or {}
        return {k: int(f.get(k, 0) or 0) for k in self.STREAKS}

    async def bump_streaks(self, changes: dict[str, dict[str, bool]]) -> None:
        """changes: pid -> {"hide": won?, "win": won?}. A win adds one; a loss resets to zero; the best is kept."""
        if not changes:
            return
        async with self.db() as db, db.begin():
            for pid, ch in changes.items():
                p = await db.get(Player, pid, with_for_update=True)
                if p is None:
                    continue
                f = dict(p.flags or {})
                for kind, won in ch.items():
                    cur = int(f.get(f"{kind}_streak", 0) or 0)
                    cur = cur + 1 if won else 0
                    f[f"{kind}_streak"] = str(cur)
                    f[f"best_{kind}_streak"] = str(max(cur, int(f.get(f"best_{kind}_streak", 0) or 0)))
                p.flags = f
        for pid in changes:
            if (s := self.sessions.get(pid)) is not None and s.connected:
                await self.push_wallet(s)

    async def apply_round(
        self, game_id: str, round_no: int, deltas: dict[str, int], outcome: rules.RoundOutcome, participants: list[str]
    ) -> dict[str, int]:
        applied: dict[str, int] = {}
        bots = {p for p in deltas if (b := self.sessions.get(p)) is not None and b.bot}
        participants = [p for p in participants if p not in bots]
        for pid, amount in deltas.items():
            if pid in bots or amount == 0:  # NPC naira is for show; never touches the ledger
                applied[pid] = 0
                continue
            got, _ = await self.economy.post(
                pid, amount, "round", f"round:{game_id}:{round_no}:{pid}", ref=game_id, clamp=True
            )
            applied[pid] = got
        if not outcome.skipped:
            # hide streak: rounds in a row you weren't found (being found breaks it)
            await self.bump_streaks({
                h: {"hide": h not in outcome.found_order}
                for h in outcome.hiders if h not in bots and h not in outcome.idle
            })  # fmt: skip
            async with self.db() as db, db.begin():
                if outcome.seeker not in bots:
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
                    if h in outcome.idle or h in bots:
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
        if self.rematches:
            await self.settle_rematches()
        await self.tick_matchmaking(now)
        for code, g in list(self.groups.items()):
            try:
                async with g.lock:
                    await g.update(now)
            except Exception:
                log.exception("group update failed game=%s", g.id)
            if self._group_expired(g, now):
                self._drop_group(code, g)
        now_ms = int(now * 1000)
        rooms: list[Room] = [*self.shards, *(g.arena for g in self.groups.values()), *self.explore.values()]
        for room in rooms:
            room.snapshot(now_ms)
        # spectators (Live games -> Watch) get a light map feed ~3 times a second
        self._watch_tick += 1
        if self._watch_tick % 3 == 0:
            feeds: dict[str, dict[str, Any]] = {}
            for s in self.sessions.values():
                if not (s.watching and s.connected):
                    continue
                g = self.groups.get(s.watching)
                if g is None:
                    s.watching = None
                    s.send({"t": "wsnap", "code": None})
                    continue
                if g.code not in feeds:
                    feeds[g.code] = g.watch_msg()
                s.send(feeds[g.code])
        # someone who closed the app stays standing where they were (their stand-in) for 30 minutes, then goes
        # offline; we remember the spot, so they still come back exactly there
        for pid, s in list(self.sessions.items()):
            if s.sender is None and s.group is None and s.disconnected_at and now - s.disconnected_at > STANDIN_KEEP_S:
                if isinstance(s.room, HubShard):
                    self.last_spots[pid] = (s.x, s.z, now)
                if s.room is not None:
                    s.room.remove(s)
                del self.sessions[pid]
        if len(self.last_spots) > 5000:  # keep the memory small: drop the oldest
            for pid, _ in sorted(self.last_spots.items(), key=lambda kv: kv[1][2])[:1000]:
                del self.last_spots[pid]
        self.shards = [h for h in self.shards if h.sessions] or self.shards[:1]

    def _group_expired(self, g: GroupRoom, now: float) -> bool:
        online = [p for p in g.members if p not in g.left and (s := self.sessions.get(p)) and s.connected and not s.bot]
        if g.phase == "over":
            # players may stay and explore the venue; close it once no human is left there
            exploring = [p for p in online if (s := self.sessions.get(p)) and s.room is g.arena]
            return not exploring or now - g.phase_end > 2700
        if g.phase == "lobby":
            return not g.members or (not online and now - g.last_activity > self.cfg.game.lobby_idle_expiry_s)
        return (
            not online
            and now - g.last_tick > 0
            and all(
                (s := self.sessions.get(p)) is None or s.bot or (s.disconnected_at and now - s.disconnected_at > 300)
                for p in g.members
            )
        )

    def _drop_group(self, code: str, g: GroupRoom) -> None:
        self.groups.pop(code, None)
        for p in g.members:
            s = self.sessions.get(p)
            if s is not None and s.bot:
                self.drop_bot(p)
            elif s is not None and s.group is g:
                s.group = None
                s.send({"t": "g_left"})  # or the phone keeps showing that game (e.g. a stuck game-over box)
                if s.room is g.arena:
                    # still looking around the venue: keep exploring it, now as a traveller
                    self.explore_room(g.settings["arena"]).add(s, s.x, s.z, self.now())
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
