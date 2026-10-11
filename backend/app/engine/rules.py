"""Boju Boju rules as pure functions (dice, scoring, next seeker, end)."""

from __future__ import annotations

import random
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

DICE_FACES = (1, 2, 3, 4, 5, 6)


class RuleError(ValueError):
    pass


def validate_pick(picks: dict[str, int], player: str, number: int) -> None:
    if number not in DICE_FACES:
        raise RuleError("Pick a number from 1 to 6")
    for other, n in picks.items():
        if other != player and n == number:
            raise RuleError("That number is taken")


def fill_picks(picks: dict[str, int], candidates: Sequence[str], rng: random.Random) -> dict[str, int]:
    """Give every candidate a unique number, keeping valid existing picks."""
    if len(candidates) > len(DICE_FACES):
        raise RuleError("At most 6 players can roll")
    result = {p: n for p, n in picks.items() if p in candidates}
    free = [n for n in DICE_FACES if n not in result.values()]
    rng.shuffle(free)
    for p in candidates:
        if p not in result:
            result[p] = free.pop()
    return result


def roll_for_seeker(numbers: dict[str, int], rng: random.Random, max_rolls: int = 200) -> tuple[list[int], str]:
    """Roll until a face matches a player's number. Returns (rolls, seeker)."""
    if not numbers:
        raise RuleError("No players to roll for")
    by_number = {n: p for p, n in numbers.items()}
    rolls: list[int] = []
    for _ in range(max_rolls):
        face = rng.randint(1, 6)
        rolls.append(face)
        if face in by_number:
            return rolls, by_number[face]
    # Astronomically unlikely; stay deterministic rather than loop forever.
    face = min(by_number)
    rolls.append(face)
    return rolls, by_number[face]


@dataclass(frozen=True, slots=True)
class Scoring:
    seeker_find_one: int
    seeker_per_hider_multi: int
    seeker_none_penalty: int
    hider_not_found: int
    hider_safe: int
    hider_found: int


@dataclass(slots=True)
class RoundOutcome:
    seeker: str
    hiders: list[str]
    found_order: list[str] = field(default_factory=list)
    safe_at_end: set[str] = field(default_factory=set)
    idle: set[str] = field(default_factory=set)  # disconnected hiders
    skipped: bool = False  # seeker disconnected: no scoring


def score_round(o: RoundOutcome, s: Scoring) -> dict[str, int]:
    """Naira delta per player (penalties negative; the wallet clamps at 0)."""
    if o.skipped:
        return {}
    deltas: dict[str, int] = {}
    finds = len(o.found_order)
    if finds == 0:
        deltas[o.seeker] = -s.seeker_none_penalty
    elif finds == 1:
        deltas[o.seeker] = s.seeker_find_one
    else:
        deltas[o.seeker] = s.seeker_per_hider_multi * finds
    for h in o.hiders:
        if h in o.idle:
            deltas[h] = 0
        elif h in o.found_order:
            deltas[h] = s.hider_found
        elif h in o.safe_at_end:
            deltas[h] = s.hider_safe
        else:
            deltas[h] = s.hider_not_found
    return deltas


@dataclass(frozen=True, slots=True)
class NextRound:
    retired: frozenset[str]
    next_seeker: str | None  # None => roll dice among ``dice_pool``
    dice_pool: tuple[str, ...]


def plan_next_round(o: RoundOutcome, active: Iterable[str]) -> NextRound:
    """Who retires and who seeks next.

    - A seeker who found at least one hider retires (keeps their naira).
    - The first person found becomes the next seeker.
    - If nobody was found (or the round was skipped) the next seeker is rolled
      by dice among the remaining hiders.
    """
    active_set = list(dict.fromkeys(active))
    retired: set[str] = set()
    if not o.skipped and o.found_order:
        retired.add(o.seeker)
        remaining = [p for p in active_set if p not in retired]
        first = o.found_order[0]
        if first in remaining:
            return NextRound(frozenset(retired), first, ())
    remaining = [p for p in active_set if p not in retired]
    pool = (
        [p for p in remaining if p in o.hiders and p not in o.idle]
        or [p for p in remaining if p != o.seeker]
        or remaining
    )
    return NextRound(frozenset(retired), None, tuple(pool))


def is_final_round(active_count: int) -> bool:
    return active_count == 2


def is_game_over(*, active_count: int, last_round_was_final: bool, rounds_played: int, max_rounds: int) -> bool:
    return active_count < 2 or last_round_was_final or rounds_played >= max_rounds


def can_tag(
    *,
    phase: str,
    seeker_id: str,
    actor_id: str,
    target_id: str,
    target_state: str,
    in_safe_house: bool,
    dist: float,
    tag_range: float,
    line_of_sight: bool,
) -> tuple[bool, str]:
    if phase != "seek":
        return False, "Not seeking time"
    if actor_id != seeker_id:
        return False, "Only Boju can tag"
    if target_id == seeker_id:
        return False, "Invalid target"
    if target_state != "hiding":
        return False, "Already found"
    if in_safe_house:
        return False, "They are in the safe house!"
    if dist > tag_range:
        return False, "Too far — get closer"
    if not line_of_sight:
        return False, "You can't see them"
    return True, ""
