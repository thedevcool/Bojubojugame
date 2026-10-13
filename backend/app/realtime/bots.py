"""NPC players ("bots") that play Boju Boju with humans.

Bots are ordinary group members driven by the server tick. They obey the same
rules as humans: they only "see" hiders that pass the server visibility check,
tag through ``GroupRoom.tag`` and move at capped speeds (a bit slower than a
running human so people can out-run them).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from app.engine.geometry import distance, has_line_of_sight

if TYPE_CHECKING:
    from app.realtime.group import GroupRoom
    from app.realtime.rooms import Session

BOT_NAMES = [
    "Bisi",
    "Chidi",
    "Emeka",
    "Kemi",
    "Segun",
    "Ngozi",
    "Femi",
    "Aisha",
    "Musa",
    "Yemi",
    "Bola",
    "Ifeoma",
    "Dayo",
    "Zainab",
    "Tobi",
    "Amaka",
    "Sade",
    "Uche",
    "Kunle",
    "Halima",
]
FEMALE_NAMES = {"Bisi", "Kemi", "Ngozi", "Aisha", "Yemi", "Bola", "Ifeoma", "Zainab", "Amaka", "Sade", "Halima"}

HIDE_SPEED = 5.0
WALK_SPEED = 3.0
CHASE_SPEED = 5.3  # still under a running human (6.0): you can out-run Boju, but not by strolling
FLEE_SPEED = 5.2
HEAR_M = 4.5  # Boju hears someone this close, even round a corner (footsteps, breathing)


@dataclass
class BotBrain:
    path: list[tuple[float, float]] = field(default_factory=list)
    speed: float = WALK_SPEED
    next_think: float = 0.0
    goal: tuple[float, float] | None = None
    react_at: float | None = None
    last_seen: tuple[float, float] | None = None
    visited: set[int] = field(default_factory=set)
    phase_seen: str = ""
    search: list[int] = field(default_factory=list)  # hide spots to check first (round where someone vanished)


def _step(s: Session, b: BotBrain, dt: float, now: float) -> None:
    budget = b.speed * dt
    while b.path and budget > 0:
        tx, tz = b.path[0]
        d = distance(s.x, s.z, tx, tz)
        if d <= budget:
            s.x, s.z = tx, tz
            budget -= d
            b.path.pop(0)
        else:
            k = budget / d
            s.ry = math.atan2(tx - s.x, tz - s.z)
            s.x += (tx - s.x) * k
            s.z += (tz - s.z) * k
            budget = 0
    s.run = bool(b.path) and b.speed > WALK_SPEED + 0.5
    s.last_move_at = now


def _go(g: GroupRoom, s: Session, b: BotBrain, target: tuple[float, float], speed: float) -> bool:
    path = g.map.nav.find_path(s.x, s.z, target[0], target[1])
    if not path:
        return False
    b.path, b.goal, b.speed = path, target, speed
    s.crouch = False
    return True


def _pick_spot(
    g: GroupRoom, rng: random.Random, away_from: tuple[float, float], min_dist: float, taken: set[tuple[float, float]]
) -> tuple[float, float] | None:
    """A good hiding spot: far enough from `away_from`, out of its line of sight, not next to another hider.
    Tries a handful at random and keeps the best (so NPCs hide properly, and not all in the same place)."""
    spots = g.map.hide_spots
    if not spots:
        return None
    best: tuple[float, tuple[float, float]] | None = None
    for _ in range(24):
        cand = spots[rng.randrange(len(spots))]
        if cand in taken:
            continue
        d = distance(*cand, *away_from)
        if d < min_dist:
            continue
        hidden = _hidden(g, away_from, cand, crouched=True)
        crowd = min((distance(*cand, *t) for t in taken), default=99.0)
        score = (10.0 if hidden else 0.0) + min(d, 40.0) * 0.15 + min(crowd, 12.0) * 0.3 + rng.random()
        if best is None or score > best[0]:
            best = (score, cand)
    return best[1] if best else spots[rng.randrange(len(spots))]


def _hidden(g: GroupRoom, frm: tuple[float, float], at: tuple[float, float], crouched: bool) -> bool:
    h = g.cfg.movement.crouch_height if crouched else g.cfg.movement.stand_height
    return not has_line_of_sight(frm[0], frm[1], at[0], at[1], h, g.map.near(frm[0], frm[1], at[0], at[1]))


def drive_bots(g: GroupRoom, now: float, dt: float) -> None:
    rng = g.world.rng
    r = g.round
    for pid, b in g.bots.items():
        s = g.session(pid)
        if s is None or s.room is not g.arena:
            continue
        if b.phase_seen != g.phase:  # reset per phase
            b.phase_seen = g.phase
            b.path, b.goal, b.react_at = [], None, None
            b.next_think = now + rng.uniform(0.6, 2.5)
            if g.phase == "hide":
                b.visited.clear()
                b.search.clear()
                b.last_seen = None
        if s.frozen:
            b.path = []
            continue
        if g.phase == "gather":
            # get off the bus and walk to the circle like everyone else
            if b.goal is None and now >= g.arrive_at.get(pid, 0.0) and now >= b.next_think:
                _go(g, s, b, g.arena.spawn_point(g.members.index(pid)), WALK_SPEED)
        elif g.phase == "dice":
            if pid in g.dice_pool and pid not in g.picks and now >= b.next_think:
                free = [n for n in range(1, 7) if n not in g.picks.values()]
                if free:
                    g.picks[pid] = rng.choice(free)
                    g.broadcast_state("picked")
        elif r is not None and g.phase in ("hide", "seek"):
            if pid == r.seeker:
                if g.phase == "seek":
                    _seek(g, s, b, now, rng)
            elif r.state.get(pid) == "hiding":
                _hide(g, s, b, now, rng)
        _step(s, b, dt, now)


def _hide(g: GroupRoom, s: Session, b: BotBrain, now: float, rng: random.Random) -> None:
    r = g.round
    assert r is not None
    if g.phase == "hide":
        if b.goal is None and now >= b.next_think:
            taken = {o.goal for o in g.bots.values() if o.goal}
            spot = _pick_spot(g, rng, g.map.spawn, 14.0, taken)
            if spot:
                _go(g, s, b, spot, HIDE_SPEED)
        if b.goal and not b.path:
            s.crouch = rng.random() < 0.7
        return
    # seek phase: stay put unless the seeker is close and can see us
    if now < b.next_think:
        return
    b.next_think = now + 0.5
    seeker = g.session(r.seeker)
    if seeker is None:
        return
    safe = g.map.safe_houses.get(g.settings["safe"])
    if s.pid in r.in_safe and r.safe_used.get(s.pid, 0) > g.cfg.game.safe_house_total_s - 3:
        spot = _pick_spot(g, rng, (seeker.x, seeker.z), 15.0, set())
        if spot:
            _go(g, s, b, spot, FLEE_SPEED)
        return
    d = distance(s.x, s.z, seeker.x, seeker.z)
    seen = g.can_see(seeker, s)
    if not seen and d < 7 and not b.path and rng.random() < 0.35:
        # Boju is close but hasn't seen me: slip away to a spot out of their sight, crouched
        spot = _pick_spot(g, rng, (seeker.x, seeker.z), 12.0, set())
        if spot and _go(g, s, b, spot, WALK_SPEED):
            s.crouch = True
            return
    if d < 9 and seen and (not b.path or b.speed < FLEE_SPEED):
        can_safe = (
            safe is not None
            and r.safe_used.get(s.pid, 0) < g.cfg.game.safe_house_total_s - 4
            and len(r.in_safe) < g.cfg.game.safe_house_capacity
        )
        if can_safe and safe is not None:
            x0, z0, x1, z1 = safe["rect"]
            if _go(g, s, b, ((x0 + x1) / 2, (z0 + z1) / 2), FLEE_SPEED):
                return
        spot = _pick_spot(g, rng, (seeker.x, seeker.z), 18.0, set())
        if spot:
            _go(g, s, b, spot, FLEE_SPEED)
    elif not b.path and b.goal is not None:
        s.crouch = True


def _seek(g: GroupRoom, s: Session, b: BotBrain, now: float, rng: random.Random) -> None:
    """A proper Boju: chases what it sees, hears footsteps round corners, searches where it last saw someone,
    then sweeps the hiding spots nearest-first, ticking off the ones it can already see are empty."""
    r = g.round
    assert r is not None
    if now < b.next_think:
        return
    b.next_think = now + 0.3
    visible: list[tuple[float, Session]] = []
    heard: Session | None = None
    for h in r.hiders:
        hs = g.session(h)
        if hs is None or r.state.get(h) != "hiding":
            continue
        d = distance(s.x, s.z, hs.x, hs.z)
        if g.can_see(s, hs):
            visible.append((d, hs))
        elif d < HEAR_M * (0.6 if hs.crouch else 1.0) and h not in r.in_safe:
            heard = hs
    if visible:
        d, target = min(visible, key=lambda v: v[0])
        b.last_seen = (target.x, target.z)
        if d <= g.cfg.game.tag_range_m * 0.9 and target.pid not in r.in_safe:
            b.path = []
            if b.react_at is None:
                b.react_at = now + rng.uniform(0.25, 0.55)  # human-ish reaction time
            elif now >= b.react_at:
                b.react_at = None
                g.tag(s)
            return
        b.react_at = None
        if target.pid in r.in_safe:
            # can't tag in the safe house: wait by it — safe time runs out
            if d > 6:
                _go(g, s, b, (target.x, target.z), WALK_SPEED)
            else:
                b.path = []
            return
        # cut them off: aim a little ahead of where they're heading
        lead = 0.6 if target.run else 0.25
        tx = target.x + math.sin(target.ry) * lead * 4
        tz = target.z + math.cos(target.ry) * lead * 4
        if not _go(g, s, b, (tx, tz), CHASE_SPEED):
            _go(g, s, b, (target.x, target.z), CHASE_SPEED)
        return
    b.react_at = None
    if heard is not None and (not b.path or b.goal != (heard.x, heard.z)):
        _go(g, s, b, (heard.x, heard.z), WALK_SPEED + 1.0)  # "I hear you…"
        return
    if b.last_seen and not b.path:
        ls = b.last_seen
        b.last_seen = None
        # check the spots round where they vanished first
        near = [i for i, sp in enumerate(g.map.hide_spots) if i not in b.visited and distance(*sp, *ls) < 12]
        b.search = sorted(near, key=lambda i: distance(*g.map.hide_spots[i], *ls))[:4]
        _go(g, s, b, ls, WALK_SPEED + 0.8)
        return
    if not b.path:
        spots = g.map.hide_spots
        if not spots:
            return
        # tick off spots Boju can already see are empty
        for i, sp in enumerate(spots):
            if i not in b.visited and distance(s.x, s.z, *sp) < 10 and not _hidden(g, (s.x, s.z), sp, crouched=True):
                b.visited.add(i)
        while b.search and b.search[0] in b.visited:
            b.search.pop(0)
        if b.search:
            i = b.search.pop(0)
        else:
            left = [i for i in range(len(spots)) if i not in b.visited]
            if not left:
                b.visited.clear()
                left = list(range(len(spots)))
            # nearest unchecked spot (a little randomness so Boju isn't predictable)
            left.sort(key=lambda i: distance(s.x, s.z, *spots[i]) + rng.uniform(0, 4))
            i = left[0]
        b.visited.add(i)
        _go(g, s, b, spots[i], WALK_SPEED + 0.6)
