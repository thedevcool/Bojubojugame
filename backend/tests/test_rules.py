import random

import pytest

from app.content import get_config
from app.engine import rules

S = get_config().scoring


def test_pick_must_be_unique_and_in_range():
    picks = {"a": 3}
    with pytest.raises(rules.RuleError):
        rules.validate_pick(picks, "b", 3)
    with pytest.raises(rules.RuleError):
        rules.validate_pick(picks, "b", 7)
    rules.validate_pick(picks, "a", 3)  # re-picking your own number is fine


def test_fill_picks_unique_and_keeps_existing():
    out = rules.fill_picks({"a": 2, "zz": 5}, ["a", "b", "c"], random.Random(1))
    assert out["a"] == 2 and "zz" not in out
    assert len(set(out.values())) == 3 and all(1 <= n <= 6 for n in out.values())


def test_roll_always_lands_on_a_player():
    rng = random.Random(7)
    for _ in range(200):
        rolls, seeker = rules.roll_for_seeker({"a": 1, "b": 6}, rng)
        assert rolls[-1] in (1, 6)
        assert seeker == ("a" if rolls[-1] == 1 else "b")
        assert all(r not in (1, 6) for r in rolls[:-1])


def outcome(**kw):
    base = dict(seeker="s", hiders=["a", "b", "c"])
    base.update(kw)
    return rules.RoundOutcome(**base)


def test_score_one_find():
    d = rules.score_round(outcome(found_order=["a"], safe_at_end={"b"}), S)
    assert d == {"s": 5000, "a": 0, "b": 3500, "c": 7500}


def test_score_multi_find_doubles():
    d = rules.score_round(outcome(found_order=["a", "b"]), S)
    assert d["s"] == 20000 and d["c"] == 7500


def test_score_no_find_penalty_and_idle():
    d = rules.score_round(outcome(idle={"c"}), S)
    assert d == {"s": -2500, "a": 7500, "b": 7500, "c": 0}


def test_skipped_round_scores_nothing():
    assert rules.score_round(outcome(skipped=True), S) == {}


def test_first_found_is_next_seeker_and_seeker_retires():
    plan = rules.plan_next_round(outcome(found_order=["b", "a"]), ["s", "a", "b", "c"])
    assert plan.retired == {"s"} and plan.next_seeker == "b"


def test_no_find_rerolls_among_hiders():
    plan = rules.plan_next_round(outcome(idle={"c"}), ["s", "a", "b", "c"])
    assert plan.retired == frozenset() and plan.next_seeker is None
    assert set(plan.dice_pool) == {"a", "b"}


def test_end_condition():
    assert rules.is_final_round(2) and not rules.is_final_round(3)
    assert rules.is_game_over(active_count=1, last_round_was_final=False, rounds_played=1, max_rounds=12)
    assert rules.is_game_over(active_count=2, last_round_was_final=True, rounds_played=1, max_rounds=12)
    assert rules.is_game_over(active_count=3, last_round_was_final=False, rounds_played=12, max_rounds=12)
    assert not rules.is_game_over(active_count=2, last_round_was_final=False, rounds_played=2, max_rounds=12)


@pytest.mark.parametrize(
    "kw,ok,msg",
    [
        ({}, True, ""),
        ({"phase": "hide"}, False, "Not seeking time"),
        ({"actor_id": "x"}, False, "Only Boju can tag"),
        ({"target_state": "found"}, False, "Already found"),
        ({"in_safe_house": True}, False, "They are in the safe house!"),
        ({"dist": 3.5}, False, "Too far — get closer"),
        ({"line_of_sight": False}, False, "You can't see them"),
    ],
)
def test_can_tag(kw, ok, msg):
    args = dict(
        phase="seek",
        seeker_id="s",
        actor_id="s",
        target_id="a",
        target_state="hiding",
        in_safe_house=False,
        dist=2.0,
        tag_range=3.0,
        line_of_sight=True,
    )
    args.update(kw)
    assert rules.can_tag(**args) == (ok, msg)
