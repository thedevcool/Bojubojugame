"""One Boju Boju group: lobby → travel → dice → reveal → hide → seek → result → … → over.

All state changes happen synchronously under ``self.lock`` *before* any
awaited I/O, so concurrent messages always see a consistent phase.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from app.content import GameConfig, MapData
from app.economy import InsufficientFunds
from app.engine import rules
from app.engine.geometry import distance, has_line_of_sight, in_rect
from app.realtime.bots import BOT_NAMES, BotBrain, drive_bots
from app.realtime.rooms import ArenaRoom, Session

if TYPE_CHECKING:
    from app.realtime.world import World

log = logging.getLogger("boju.group")

GAME_PHASES = {"gather", "dice", "reveal", "hide", "seek", "result"}
GATHER_RADIUS = 4.5  # the circle everyone stands in before the dice
SEEN_GRACE_S = 1.2  # Boju keeps seeing a hider this long after losing sight (no popping out of view)
LIVE_PHASES = {"hide", "seek"}  # chat locked, positions culled


class GroupError(Exception):
    pass


@dataclass
class Standing:
    earned: int = 0
    finds: int = 0
    survived: int = 0
    rounds_as_seeker: int = 0


@dataclass
class RoundState:
    no: int
    seeker: str
    hiders: list[str]
    is_final: bool
    state: dict[str, str] = field(default_factory=dict)  # hiding | found | idle
    found_order: list[str] = field(default_factory=list)
    in_safe: set[str] = field(default_factory=set)
    safe_used: dict[str, float] = field(default_factory=dict)
    skipped: bool = False


class GroupRoom:
    def __init__(self, world: World, game_id: str, code: str, creator: Session, settings: dict[str, Any]) -> None:
        self.world = world
        self.cfg: GameConfig = world.cfg
        self.id = game_id
        self.code = code
        self.creator = creator.pid
        self.members: list[str] = []
        self.nicks: dict[str, str] = {}
        self.settings = settings
        self.phase = "lobby"
        self.phase_end = 0.0
        self.boarded: set[str] = set()
        self.retired: set[str] = set()
        self.left: set[str] = set()
        self.picks: dict[str, int] = {}
        self.dice_pool: list[str] = []
        self.dice_rolls: list[int] = []
        self.pending_seeker: str | None = None
        self.round: RoundState | None = None
        self.rounds_played = 0
        self.standings: dict[str, Standing] = {}
        self.last_result: dict[str, Any] | None = None
        self.final_results: list[dict[str, Any]] | None = None
        self.game_over_pending = False
        self.last_activity = world.now()
        self.last_tick = world.now()
        self.lock = asyncio.Lock()
        self.bots: dict[str, BotBrain] = {}
        self.arrive_at: dict[str, float] = {}
        self.gathered: list[str] = []
        self.seen_until: dict[tuple[str, str], float] = {}
        self.public = True
        self.arena = ArenaRoom(f"arena:{game_id}", self.map, self)

    # ------------------------------------------------------------ helpers
    @property
    def map(self) -> MapData:
        return self.world.maps[self.settings["arena"]]

    @property
    def active(self) -> list[str]:
        return [p for p in self.members if p not in self.retired and p not in self.left]

    @property
    def humans(self) -> list[str]:
        return [p for p in self.active if p not in self.bots]

    def summary(self) -> dict[str, Any]:
        """One row of the Live games list."""
        active = self.active
        return {
            "code": self.code,
            "creator": self.nicks.get(self.creator, "?"),
            "arena": self.settings["arena"],
            "arena_name": self.map.raw.get("name", self.settings["arena"]),
            "phase": self.phase,
            "humans": len(self.humans),
            "bots": len([p for p in active if p in self.bots]),
            "max": self.cfg.game.max_players,
            "public": self.public,
            "joinable": self.public and self.phase == "lobby" and len(active) < self.cfg.game.max_players,
            "round": self.round.no if self.round else 0,
        }

    def watch_msg(self) -> dict[str, Any]:
        """What a spectator's map shows. Hiders only appear when Boju could see them (no cheating by proxy)."""
        r = self.round
        seeker = self.session(r.seeker) if r else None
        players = []
        for p in self.active:
            s = self.session(p)
            if s is None or s.room is not self.arena:
                continue
            role = ""
            if r is not None and self.phase in LIVE_PHASES:
                if p == r.seeker:
                    role = "seeker"
                else:
                    role = "safe" if p in r.in_safe else r.state.get(p, "")
                    if role == "hiding" and (seeker is None or not self.can_see(seeker, s)):
                        continue
            players.append([p, self.nicks[p], round(s.x, 1), round(s.z, 1), role, p in self.bots])
        return {
            "t": "wsnap",
            "code": self.code,
            "arena": self.settings["arena"],
            "phase": self.phase,
            "phase_end": int(self.phase_end * 1000),
            "found": len(r.found_order) if r else 0,
            "hiding": sum(1 for v in r.state.values() if v == "hiding") if r else 0,
            "players": players,
        }

    def is_bot(self, pid: str) -> bool:
        return pid in self.bots

    def add_bot(self, s: Session) -> None:
        if s.pid != self.creator:
            raise GroupError("Only the creator can add NPC players")
        if self.phase != "lobby":
            raise GroupError("Add NPCs before the game starts")
        if len(self.active) >= self.cfg.game.max_players:
            raise GroupError("Group is full (max 6)")
        used = {self.nicks[p] for p in self.members}
        name = next((n for n in self.world.rng.sample(BOT_NAMES, len(BOT_NAMES)) if n not in used), "Bot")
        bot = self.world.create_bot(name)
        self.bots[bot.pid] = BotBrain()
        self.add_member(bot)

    def remove_bot(self, s: Session, pid: str) -> None:
        if s.pid != self.creator or self.phase != "lobby" or pid not in self.bots:
            raise GroupError("Can't remove that NPC now")
        self.members.remove(pid)
        del self.bots[pid]
        self.world.drop_bot(pid)
        self.broadcast_state("player_left")

    def session(self, pid: str) -> Session | None:
        return self.world.sessions.get(pid)

    def set_phase(self, phase: str, duration: float, event: str) -> None:
        self.phase = phase
        self.phase_end = self.world.now() + duration
        self.broadcast_state(event)

    def broadcast(self, msg: dict[str, Any]) -> None:
        for pid in self.members:
            if pid not in self.left and (s := self.session(pid)):
                s.send(msg)

    def state_msg(self, event: str = "") -> dict[str, Any]:
        r = self.round
        return {
            "t": "g_state",
            "event": event,
            "id": self.id,
            "code": self.code,
            "creator": self.creator,
            "settings": self.settings,
            "phase": self.phase,
            "phase_end": int(self.phase_end * 1000),
            "members": [
                {
                    "id": p,
                    "nick": self.nicks[p],
                    "online": bool((s := self.session(p)) and s.connected),
                    "boarded": p in self.boarded,
                    "retired": p in self.retired,
                    "left": p in self.left,
                    "pick": self.picks.get(p),
                    "bot": p in self.bots,
                }
                for p in self.members
            ],
            "dice_pool": self.dice_pool,
            "round": None
            if r is None
            else {
                "no": r.no,
                "seeker": r.seeker,
                "final": r.is_final,
                "state": r.state,
                "found": r.found_order,
                "safe": sorted(r.in_safe),
                "safe_used": {k: round(v, 1) for k, v in r.safe_used.items()},
            },
            "gather": {"center": list(self.map.spawn), "r": GATHER_RADIUS, "in": self.gathered}
            if self.phase == "gather"
            else None,
            "pending_seeker": self.pending_seeker,
            "last_result": self.last_result,
            "final": self.final_results,
        }

    def broadcast_state(self, event: str = "") -> None:
        self.broadcast(self.state_msg(event))

    # ------------------------------------------------------------ lobby
    def add_member(self, s: Session) -> None:
        if s.pid in self.members and s.pid not in self.left:
            return
        if self.phase != "lobby":
            raise GroupError("This game has already started")
        if len(self.active) >= self.cfg.game.max_players:
            raise GroupError("Group is full (max 6)")
        if s.pid in self.left:
            self.left.discard(s.pid)
            self.members.remove(s.pid)
        self.members.append(s.pid)
        self.nicks[s.pid] = s.nick
        self.standings.setdefault(s.pid, Standing())
        s.group = self
        self.last_activity = self.world.now()
        self.broadcast_state("player_joined")

    def update_settings(self, s: Session, changes: dict[str, Any]) -> None:
        if s.pid != self.creator:
            raise GroupError("Only the creator can change settings")
        if self.phase != "lobby":
            raise GroupError("Settings are locked once the game starts")
        self.settings = self.world.validate_settings(
            {**self.settings, **{k: v for k, v in changes.items() if v is not None}}
        )
        self.arena = ArenaRoom(f"arena:{self.id}", self.map, self)
        self.broadcast_state("settings")

    async def start(self, s: Session) -> None:
        if s.pid != self.creator:
            raise GroupError("Only the creator can start")
        if self.phase != "lobby":
            raise GroupError("Already started")
        players = self.active
        if len(players) < self.cfg.game.min_players:
            raise GroupError("Need at least 2 players")
        offline = [self.nicks[p] for p in players if not ((x := self.session(p)) and x.connected)]
        if offline:
            raise GroupError(f"Waiting for {', '.join(offline)} to come online")
        if not self.humans:
            raise GroupError("At least one real player is needed")
        hungry = []
        for p in self.humans:
            if p in self.world.mini:
                continue
            if await self.world.economy.get_hunger(p) < self.cfg.game.min_hunger_to_play:
                hungry.append(self.nicks[p])
        if hungry:
            raise GroupError(f"Too hungry to play: {', '.join(hungry)}. Go and chop first!")
        if self.phase != "lobby":
            return
        self.broadcast({"t": "g_event", "e": "group_started"})
        self.set_phase("travel", self.cfg.game.travel_window_s, "travel_started")
        # everybody in Lagos is taken straight to the motor park to board
        for p in self.humans:
            if (h := self.session(p)) is not None and h.room is not None and h.room.map.kind == "hub":
                stop = h.room.map.zones.get("bus_stop")
                if stop is not None:
                    x0, z0, x1, z1 = stop["rect"]
                    h.crouch = h.sit = h.lie = h.driving = False
                    h.place(*self.world.free_spot(((x0 + x1) / 2, (z0 + z1) / 2), exclude=p), self.world.now())
        for p in list(self.bots):  # NPCs take the first bus
            if (b := self.session(p)) is not None:
                self.boarded.add(p)
                self.enter_arena(b, 0)

    async def board(self, s: Session, fare_id: str) -> None:
        if self.phase != "travel":
            raise GroupError("Not travel time")
        if s.pid in self.boarded or s.pid not in self.active:
            return
        fare = next((f for f in self.cfg.fares_for(self.settings["arena"]) if f.id == fare_id), None)
        if fare is None:
            raise GroupError("Unknown ride")
        zone = s.room.map.zones.get("bus_stop") if s.room and s.room.map.kind == "hub" else None
        if zone is None or not in_rect(zone["rect"], s.x, s.z):
            raise GroupError("Walk to the bus stop first")
        self.boarded.add(s.pid)  # reserve before awaiting to block double-boarding
        if s.pid not in self.world.mini:
            try:
                await self.world.economy.post(s.pid, -fare.price, "fare", f"fare:{self.id}:{s.pid}", ref=fare.id)
            except InsufficientFunds:
                self.boarded.discard(s.pid)
                raise GroupError(f"Not enough naira for {fare.name}") from None
            await self.world.push_wallet(s)
        self.enter_arena(s, fare.ride_s, fare.id)
        self.broadcast_state("boarded")

    def enter_arena(self, s: Session, ride_s: float, mode: str = "danfo") -> None:
        """You get off the bus at the arena's bus stop, then walk to the circle."""
        idx = self.members.index(s.pid)
        stop = self.map.zones.get("bus_stop")
        if stop is not None:
            x0, z0, x1, z1 = stop["rect"]
            x, z = (x0 + x1) / 2 + (idx % 3 - 1) * 1.2, (z0 + z1) / 2 + (idx // 3) * 1.2
        else:
            x, z = self.arena.spawn_point(idx)
        self.arena.add(s, x, z, self.world.now())
        self.arrive_at[s.pid] = self.world.now() + ride_s
        s.send({"t": "ride", "seconds": ride_s, "mode": mode, "arena": self.settings["arena"]})

    # ------------------------------------------------------------ gather in the circle
    def start_gather(self, now: float) -> None:
        last = max((self.arrive_at.get(p, now) for p in self.active), default=now)
        self.gathered = []
        self.set_phase("gather", max(0.0, last - now) + self.cfg.game.gather_timeout_s, "gather")

    def in_circle(self, pid: str, now: float) -> bool:
        s = self.session(pid)
        if s is None or s.room is not self.arena or now < self.arrive_at.get(pid, 0.0):
            return False
        cx, cz = self.map.spawn
        return distance(s.x, s.z, cx, cz) <= GATHER_RADIUS

    def update_gather(self, now: float) -> None:
        inside = [p for p in self.active if self.in_circle(p, now)]
        if inside != self.gathered:
            self.gathered = inside
            self.broadcast_state("gather")
        if len(inside) == len(self.active) or now >= self.phase_end:
            # stragglers get walked in by the conductor
            for i, p in enumerate(self.active):
                if p not in inside and (s := self.session(p)) is not None and s.room is self.arena:
                    s.place(*self.arena.spawn_point(i), now)
            self.gathered = []
            self.start_dice(self.active)

    # ------------------------------------------------------------ dice
    def start_dice(self, pool: list[str]) -> None:
        self.picks = {}
        self.dice_rolls = []
        self.dice_pool = list(pool)
        if len(pool) == 1:
            self.begin_reveal(pool[0], rolls=[])
            return
        self.set_phase("dice", self.cfg.game.dice_pick_s, "dice_pick")

    def pick(self, s: Session, n: int) -> None:
        if self.phase != "dice" or s.pid not in self.dice_pool:
            raise GroupError("You are not rolling this time")
        try:
            rules.validate_pick(self.picks, s.pid, n)
        except rules.RuleError as e:
            raise GroupError(str(e)) from None
        self.picks[s.pid] = n
        self.broadcast_state("picked")

    def roll(self) -> None:
        numbers = rules.fill_picks(self.picks, self.dice_pool, self.world.rng)
        self.picks = numbers
        rolls, seeker = rules.roll_for_seeker(numbers, self.world.rng)
        self.broadcast({"t": "g_dice", "rolls": rolls, "seeker": seeker, "numbers": numbers})
        self.begin_reveal(seeker, rolls)

    def begin_reveal(self, seeker: str, rolls: list[int]) -> None:
        self.pending_seeker = seeker
        self.dice_rolls = rolls
        self.set_phase("reveal", self.cfg.game.reveal_s + (1.5 if rolls else 0), "dice_rolled")

    # ------------------------------------------------------------ rounds
    def start_round(self) -> None:
        seeker = self.pending_seeker
        assert seeker is not None
        players = self.active
        hiders = [p for p in players if p != seeker]
        self.round = RoundState(
            no=self.rounds_played + 1,
            seeker=seeker,
            hiders=hiders,
            is_final=rules.is_final_round(len(players)),
            state={h: "hiding" for h in hiders},
            safe_used={h: 0.0 for h in hiders},
        )
        self.pending_seeker = None
        now = self.world.now()
        for i, p in enumerate(players):
            s = self.session(p)
            if s is None:
                continue
            if s.room is not self.arena:
                self.arena.add(s, 0, 0, now)
            x, z = self.arena.spawn_point(i)
            if p == seeker:
                x, z = self.map.spawn
            s.place(x, z, now)
            s.frozen = p == seeker
            s.spectator = False
            s.crouch = False
        for p in self.members:
            if p not in players and (s := self.session(p)) and s.room is self.arena:
                self.to_found_area(s)
        self.set_phase("hide", self.settings["hide"], "hide_started")

    def to_found_area(self, s: Session) -> None:
        fx, fz = self.map.found_area
        i = self.members.index(s.pid)
        s.place(fx + (i - 2.5) * 1.5, fz, self.world.now())
        s.frozen = True
        s.spectator = True

    def can_see(self, viewer: Session, other: Session) -> bool:
        r = self.round
        if r is None or self.phase not in LIVE_PHASES or viewer.pid != r.seeker:
            return True
        st = r.state.get(other.pid)
        if st != "hiding":
            return True
        if self.phase == "hide":
            return False  # Boju is counting with eyes closed
        now = self.world.now()
        key = (viewer.pid, other.pid)
        rng = self.cfg.game.crouch_visibility_range_m if other.crouch else self.cfg.game.visibility_range_m
        h = self.cfg.movement.crouch_height if other.crouch else self.cfg.movement.stand_height
        if distance(viewer.x, viewer.z, other.x, other.z) <= rng and has_line_of_sight(
            viewer.x, viewer.z, other.x, other.z, h, self.map.near(viewer.x, viewer.z, other.x, other.z)
        ):
            self.seen_until[key] = now + SEEN_GRACE_S
            return True
        # just ducked out of sight: keep them for a moment so they run off-screen instead of popping out
        return now < self.seen_until.get(key, 0.0)

    def tag(self, s: Session, auto: bool = False) -> dict[str, Any]:
        r = self.round
        if r is None or self.phase != "seek":
            return {"t": "g_tag", "ok": False, "msg": "Not seeking time"}
        if s.pid != r.seeker:
            return {"t": "g_tag", "ok": False, "msg": "Only Boju can tag"}
        best: tuple[float, str] | None = None
        reason = "Nobody close by"
        for h in r.hiders:
            hs = self.session(h)
            if hs is None:
                continue
            d = distance(s.x, s.z, hs.x, hs.z)
            height = self.cfg.movement.crouch_height if hs.crouch else self.cfg.movement.stand_height
            ok, why = rules.can_tag(
                phase=self.phase,
                seeker_id=r.seeker,
                actor_id=s.pid,
                target_id=h,
                target_state=r.state.get(h, ""),
                in_safe_house=h in r.in_safe,
                dist=d,
                tag_range=self.cfg.game.tag_range_m,
                line_of_sight=d <= self.cfg.game.tag_range_m * 2
                and has_line_of_sight(s.x, s.z, hs.x, hs.z, height, self.map.near(s.x, s.z, hs.x, hs.z)),
            )
            if ok and (best is None or d < best[0]):
                best = (d, h)
            elif not ok and d <= self.cfg.game.tag_range_m * 2 and r.state.get(h) == "hiding":
                reason = why
        if best is None:
            return {"t": "g_tag", "ok": False, "msg": reason}
        target = best[1]
        r.state[target] = "found"
        r.found_order.append(target)
        if (ts := self.session(target)) is not None:
            self.to_found_area(ts)
        self.broadcast(
            {"t": "g_tag", "ok": True, "target": target, "nick": self.nicks[target], "by": s.pid, "auto": auto}
        )
        self.broadcast_state("tag_result")
        if not any(v == "hiding" for v in r.state.values()):
            self.phase_end = self.world.now()  # everybody found: end now
        return {}

    # ------------------------------------------------------------ tick
    async def update(self, now: float) -> None:
        dt = min(1.0, max(0.0, now - self.last_tick))
        self.last_tick = now
        if self.bots and self.phase != "lobby":
            drive_bots(self, now, dt)
        if self.phase in GAME_PHASES and (len(self.active) < 2 or not self.humans) and not self.game_over_pending:
            await self.finish_game()
            return
        if self.phase == "travel":
            if now >= self.phase_end or all(p in self.boarded for p in self.active):
                await self.auto_board()
                self.start_gather(now)
        elif self.phase == "gather":
            self.update_gather(now)
        elif self.phase == "dice":
            if now >= self.phase_end or all(p in self.picks for p in self.dice_pool):
                self.roll()
        elif self.phase == "reveal":
            if now >= self.phase_end:
                self.start_round()
        elif self.phase in LIVE_PHASES and self.round is not None:
            self.track_live(now, dt)
            # a human Boju catches you just by reaching you (NPC Boju keeps a human-like reaction delay)
            if self.phase == "seek" and self.round.seeker not in self.bots and (sk := self.session(self.round.seeker)):
                self.tag(sk, auto=True)
            if self.round.skipped or now >= self.phase_end:
                if self.phase == "hide" and not self.round.skipped:
                    if (sk := self.session(self.round.seeker)) is not None:
                        sk.frozen = False
                    self.set_phase("seek", self.settings["search"], "seek_started")
                else:
                    await self.finish_round()
        elif self.phase == "result":
            if now >= self.phase_end:
                if self.game_over_pending:
                    await self.finish_game()
                elif self.pending_seeker:
                    self.begin_reveal(self.pending_seeker, [])
                else:
                    self.start_dice([p for p in self.dice_pool if p in self.active] or self.active)

    def track_live(self, now: float, dt: float) -> None:
        r = self.round
        assert r is not None
        g = self.cfg.game
        seeker = self.session(r.seeker)
        if r.seeker in self.left or (
            seeker is not None
            and seeker.disconnected_at is not None
            and now - seeker.disconnected_at > g.seeker_disconnect_skip_s
        ):
            r.skipped = True
            return
        safe = self.map.safe_houses.get(self.settings["safe"])
        for h in r.hiders:
            if r.state.get(h) != "hiding":
                continue
            hs = self.session(h)
            if h in self.left or (
                hs is not None and hs.disconnected_at is not None and now - hs.disconnected_at > g.disconnect_grace_s
            ):
                r.state[h] = "idle"
                r.in_safe.discard(h)
                continue
            if hs is None or safe is None or self.phase != "seek":
                continue
            inside = in_rect(safe["rect"], hs.x, hs.z)
            if not inside:
                r.in_safe.discard(h)
                continue
            if h not in r.in_safe:
                if r.safe_used[h] >= g.safe_house_total_s:
                    continue
                if len(r.in_safe) >= g.safe_house_capacity:
                    if hs.allow("safe_full_toast", 0.2, 1):
                        hs.send({"t": "toast", "msg": "Safe house is full!"})
                    continue
                r.in_safe.add(h)
                self.broadcast_state("safe_enter")
            r.safe_used[h] += dt
            if r.safe_used[h] >= g.safe_house_total_s:
                r.in_safe.discard(h)
                hs.send({"t": "toast", "msg": "Safe-house time up! Run!"})
                self.broadcast_state("safe_exit")
        if not any(v == "hiding" for v in r.state.values()) and self.phase == "seek":
            self.phase_end = min(self.phase_end, now)

    async def auto_board(self) -> None:
        fare = min(self.cfg.fares_for(self.settings["arena"]), key=lambda f: f.price)
        for p in self.active:
            if p in self.boarded:
                continue
            self.boarded.add(p)
            s = self.session(p)
            mini = p in self.world.mini
            if not mini:
                await self.world.economy.post(
                    p, -fare.price, "fare", f"fare:{self.id}:{p}", ref=f"auto:{fare.id}", clamp=True
                )
            if s is not None:
                if not mini:
                    await self.world.push_wallet(s)
                s.send({"t": "toast", "msg": f"Auto-boarded a {fare.name}" + ("" if mini else " — fare paid")})
                self.enter_arena(s, fare.ride_s, fare.id)

    async def finish_round(self) -> None:
        r = self.round
        assert r is not None
        outcome = rules.RoundOutcome(
            seeker=r.seeker,
            hiders=r.hiders,
            found_order=list(r.found_order),
            safe_at_end=set(r.in_safe),
            idle={h for h, v in r.state.items() if v == "idle"},
            skipped=r.skipped,
        )
        deltas = rules.score_round(outcome, self.cfg.scoring)
        plan = rules.plan_next_round(outcome, self.active)
        self.retired |= plan.retired
        self.pending_seeker = plan.next_seeker
        self.dice_pool = list(plan.dice_pool)
        self.rounds_played += 1
        self.game_over_pending = rules.is_game_over(
            active_count=len(self.active),
            last_round_was_final=r.is_final and not r.skipped,
            rounds_played=self.rounds_played,
            max_rounds=self.cfg.game.max_rounds,
        )
        for s in (self.session(p) for p in self.members):
            if s is not None:
                s.frozen = s.pid in self.retired or s.pid in self.left
                s.spectator = s.frozen
        self.last_result = {
            "round": r.no,
            "seeker": r.seeker,
            "skipped": r.skipped,
            "found": r.found_order,
            "safe": sorted(outcome.safe_at_end),
            "idle": sorted(outcome.idle),
            "deltas": deltas,
            "retired": sorted(plan.retired),
            "next_seeker": plan.next_seeker,
            "game_over": self.game_over_pending,
        }
        self.set_phase("result", self.cfg.game.result_s, "round_result")
        # ---- I/O after the state is consistent
        applied = await self.world.apply_round(self.id, r.no, deltas, outcome, participants=[r.seeker, *r.hiders])
        for p, amount in applied.items():
            st = self.standings.setdefault(p, Standing())
            st.earned += amount
        st = self.standings[r.seeker]
        st.rounds_as_seeker += 1
        st.finds += len(r.found_order)
        for h in r.hiders:
            if h not in r.found_order and h not in outcome.idle and not r.skipped:
                self.standings[h].survived += 1
        self.last_result["deltas"] = applied
        self.broadcast_state("round_result")

    async def finish_game(self) -> None:
        if self.phase == "over":
            return
        self.final_results = sorted(
            ({"id": p, "nick": self.nicks[p], **self.standings.get(p, Standing()).__dict__} for p in self.members),
            key=lambda x: (-x["earned"], -x["finds"], -x["survived"]),
        )
        self.phase = "over"
        self.phase_end = self.world.now()
        for s in (self.session(p) for p in self.members):
            if s is not None:
                s.frozen = False
                s.spectator = False
        self.broadcast_state("game_over")
        self.broadcast({"t": "g_over", "game_id": self.id, "results": self.final_results})
        await self.world.save_game_results(self.id, self.final_results)
        for hook in self.world.game_over_hooks:
            try:
                await hook(self.id, self.final_results)
            except Exception:  # a hook (e.g. LagosLife being down) must never break the game
                log.exception("game_over hook failed game=%s", self.id)

    # ------------------------------------------------------------ leaving
    def leave(self, s: Session) -> None:
        if s.pid not in self.members:
            return
        if self.phase in ("lobby", "over"):
            self.members.remove(s.pid)
        else:
            self.left.add(s.pid)
            if self.round and self.round.state.get(s.pid) == "hiding":
                self.round.state[s.pid] = "idle"
        s.group = None
        if self.creator == s.pid and (self.humans or self.active):
            self.creator = (self.humans or self.active)[0]
        self.broadcast_state("player_left")
