"""Sessions (one per connected player) and spatial rooms (hub shards, arenas)."""

from __future__ import annotations

import asyncio
import logging
import math
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from app.content import MapData
from app.engine.geometry import distance
from app.realtime.protocol import encode
from app.safety import TokenBucket

if TYPE_CHECKING:
    from app.realtime.group import GroupRoom

log = logging.getLogger("boju.rt")

Sender = Callable[[bytes], None]


@dataclass(eq=False)
class Session:
    pid: str
    nick: str
    net_id: int
    sender: Sender | None = None
    avatar: list[int] = field(default_factory=lambda: [0, 0, 0])
    bot: bool = False
    home_id: str | None = None
    city: str = "lagos"  # where you live and always spawn: "lagos" (the hub) or "ibadan" (Akobo)
    sit: bool = False
    lie: bool = False
    car: str | None = None  # car model the player owns
    driving: bool = False
    watching: str | None = None  # group code this player is spectating on their map
    room: Room | None = None
    group: GroupRoom | None = None
    x: float = 0.0
    z: float = 0.0
    ry: float = 0.0
    crouch: bool = False
    run: bool = False
    frozen: bool = False
    spectator: bool = False
    stamina: float = 5.0
    last_move_at: float = 0.0
    # distance the player may still cover (token bucket): absorbs network jitter / bunched packets
    move_budget: float = 0.0
    last_corr_at: float = 0.0
    disconnected_at: float | None = None
    limits: dict[str, TokenBucket] = field(default_factory=dict)

    @property
    def connected(self) -> bool:
        return self.sender is not None or self.bot

    def send(self, msg: dict[str, Any]) -> None:
        if self.sender is not None:
            try:
                self.sender(encode(msg))
            except Exception:  # noqa: BLE001 - a dead socket must not break the caller
                log.debug("send failed pid=%s", self.pid)

    def allow(self, kind: str, rate: float, burst: float) -> bool:
        b = self.limits.get(kind)
        if b is None:
            b = self.limits[kind] = TokenBucket(rate, burst)
        return b.allow()

    def place(self, x: float, z: float, now: float, *, notify: bool = True) -> None:
        self.x, self.z, self.last_move_at = x, z, now
        self.move_budget = 0.0
        if notify:
            self.send({"t": "tp", "x": round(x, 2), "z": round(z, 2)})


class Room:
    """A set of sessions sharing one map instance."""

    def __init__(self, room_id: str, map_data: MapData) -> None:
        self.id = room_id
        self.map = map_data
        self.sessions: dict[str, Session] = {}

    def add(self, s: Session, x: float, z: float, now: float) -> None:
        if s.room is not None and s.room is not self:
            s.room.remove(s)
        s.room = self
        self.sessions[s.pid] = s
        s.place(x, z, now, notify=False)
        s.send({"t": "zone", "map": self.map.id, "room": self.id, "x": round(x, 2), "z": round(z, 2)})
        self.broadcast_roster()

    def remove(self, s: Session) -> None:
        if self.sessions.pop(s.pid, None) is not None:
            s.room = None
            self.broadcast_roster()

    def broadcast(self, msg: dict[str, Any]) -> None:
        for s in self.sessions.values():
            s.send(msg)

    def broadcast_roster(self) -> None:
        roster = [
            {"n": s.net_id, "id": s.pid, "nick": s.nick, "av": s.avatar, "bot": s.bot, "car": s.car}
            for s in self.sessions.values()
        ]
        self.broadcast({"t": "roster", "players": roster})

    def can_see(self, viewer: Session, other: Session) -> bool:
        return True

    def snapshot(self, now_ms: int) -> None:
        for viewer in self.sessions.values():
            if not viewer.connected:
                continue
            players = []
            for o in self.sessions.values():
                if o is viewer or not self.can_see(viewer, o):
                    continue
                flags = (
                    (1 if o.crouch else 0)
                    | (2 if o.run else 0)
                    | (4 if o.spectator else 0)
                    | (8 if not o.connected else 0)
                    | (16 if o.sit else 0)
                    | (32 if o.lie else 0)
                    | (64 if o.driving else 0)
                )
                players.append([o.net_id, round(o.x * 100), round(o.z * 100), round(o.ry * 100), flags])
            viewer.send({"t": "snap", "ts": now_ms, "p": players})

    def spawn_point(self, i: int) -> tuple[float, float]:
        sx, sz = self.map.spawn
        ang = i * 2.399963  # golden angle spreads players out
        rad = 1.2 + 0.6 * math.sqrt(i)
        return sx + math.cos(ang) * rad, sz + math.sin(ang) * rad


class HubShard(Room):
    def __init__(self, room_id: str, map_data: MapData, interest_radius: float, capacity: int) -> None:
        super().__init__(room_id, map_data)
        self.interest_radius = interest_radius
        self.capacity = capacity

    @property
    def full(self) -> bool:
        return len(self.sessions) >= self.capacity

    def can_see(self, viewer: Session, other: Session) -> bool:
        return distance(viewer.x, viewer.z, other.x, other.z) <= self.interest_radius


class ExploreRoom(Room):
    """A city venue you travelled to on your own (no game): everyone there sees everyone."""


class ArenaRoom(Room):
    def __init__(self, room_id: str, map_data: MapData, group: GroupRoom) -> None:
        super().__init__(room_id, map_data)
        self.group = group

    def can_see(self, viewer: Session, other: Session) -> bool:
        return self.group.can_see(viewer, other)


async def writer(queue: asyncio.Queue[bytes], send: Callable[[bytes], Any]) -> None:
    """Drains a session's outbound queue to its socket."""
    while True:
        data = await queue.get()
        await send(data)
