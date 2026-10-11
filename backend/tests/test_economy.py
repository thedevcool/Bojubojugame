import asyncio

import pytest
from sqlalchemy import func, select

from app.content import get_config
from app.db import LedgerEntry
from app.economy import Economy, InsufficientFunds
from tests.conftest import make_player


async def test_ledger_is_idempotent_and_never_negative(db):
    eco = Economy(db.sessions, get_config())
    pid = await make_player(db, "Tunde")
    await eco.post(pid, 1000, "start", "k1")
    await eco.post(pid, 1000, "start", "k1")  # retry: no double credit
    assert await eco.balance(pid) == 1000
    with pytest.raises(InsufficientFunds):
        await eco.post(pid, -1500, "food", "k2")
    applied, bal = await eco.post(pid, -2500, "penalty", "k3", clamp=True)
    assert (applied, bal) == (-1000, 0)
    async with db.sessions() as s:
        assert await s.scalar(select(func.count()).select_from(LedgerEntry)) == 2


async def test_concurrent_spends_cannot_overdraw(db):
    eco = Economy(db.sessions, get_config())
    pid = await make_player(db, "Ada")
    await eco.post(pid, 1000, "start", "s")
    results = await asyncio.gather(*(eco.post(pid, -400, "food", f"buy{i}") for i in range(5)), return_exceptions=True)
    assert sum(1 for r in results if not isinstance(r, Exception)) == 2
    assert await eco.balance(pid) == 200


async def test_food_refills_hunger_and_daily_bonus_once(db):
    cfg = get_config()
    eco = Economy(db.sessions, cfg)
    pid = await make_player(db, "Bola", hunger=10)
    await eco.post(pid, 5000, "start", "s")
    bal, hunger = await eco.buy_food(pid, "jollof", "buy:x")
    assert bal == 5000 - cfg.item("jollof").price and hunger == pytest.approx(65, abs=0.5)
    assert await eco.claim_daily_bonus(pid) == cfg.economy.daily_bonus
    assert await eco.claim_daily_bonus(pid) == cfg.economy.daily_bonus  # same key -> same row
    assert await eco.balance(pid) == bal + cfg.economy.daily_bonus


async def test_topup_is_once_per_campaign(db):
    cfg = get_config()
    eco = Economy(db.sessions, cfg)
    pid = await make_player(db, "Old")
    await eco.post(pid, 20000, "start", "s")
    first = await eco.ensure_topup(pid)
    assert first == cfg.economy.topup_to - 20000
    assert await eco.balance(pid) == cfg.economy.topup_to
    await eco.post(pid, -5000, "food", "f1")
    assert await eco.ensure_topup(pid) == 0  # same campaign never pays twice
    assert await eco.balance(pid) == cfg.economy.topup_to - 5000
