"""Server-authoritative wallet on an append-only ledger, plus hunger."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.content import GameConfig
from app.db import LedgerEntry, Player


class InsufficientFunds(Exception):
    pass


class Economy:
    def __init__(self, sessions: async_sessionmaker[AsyncSession], cfg: GameConfig) -> None:
        self.sessions = sessions
        self.cfg = cfg
        # Serialises writes per player inside this process; the row lock below
        # covers Postgres when we scale out. Both together = no overdraw.
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    @staticmethod
    async def _balance(s: AsyncSession, player_id: str) -> int:
        total = await s.scalar(
            select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(LedgerEntry.player_id == player_id)
        )
        return int(total or 0)

    async def balance(self, player_id: str) -> int:
        async with self.sessions() as s:
            return await self._balance(s, player_id)

    async def post(
        self,
        player_id: str,
        amount: int,
        reason: str,
        key: str,
        ref: str | None = None,
        *,
        clamp: bool = False,
    ) -> tuple[int, int]:
        """Atomically apply ``amount`` (negative = spend). Idempotent by ``key``.

        Returns (applied_amount, new_balance). Raises InsufficientFunds for a
        spend that would go negative unless ``clamp`` (penalties/auto-fares),
        in which case only what the player has is taken.
        """
        async with self._locks[player_id], self.sessions() as s, s.begin():
            existing = await s.scalar(select(LedgerEntry).where(LedgerEntry.idempotency_key == key))
            if existing is not None:
                return existing.amount, await self._balance(s, player_id)
            # Row lock serialises concurrent spends for this player (Postgres).
            await s.execute(select(Player.id).where(Player.id == player_id).with_for_update())
            bal = await self._balance(s, player_id)
            if amount < 0 and bal + amount < 0:
                if not clamp:
                    raise InsufficientFunds()
                amount = -bal
            if amount != 0:
                s.add(LedgerEntry(player_id=player_id, amount=amount, reason=reason, ref=ref, idempotency_key=key))
            try:
                await s.flush()
            except IntegrityError:  # lost a race on the same key
                await s.rollback()
                return 0, await self.balance(player_id)
            return amount, bal + amount

    async def claim_daily_bonus(self, player_id: str, now: datetime | None = None) -> int:
        day = (now or datetime.now(UTC)).strftime("%Y-%m-%d")
        applied, _ = await self.post(player_id, self.cfg.economy.daily_bonus, "daily_bonus", f"daily:{player_id}:{day}")
        return applied

    async def ensure_topup(self, player_id: str) -> int:
        """Bring a player's balance up to ``topup_to`` once per campaign (idempotent)."""
        target = self.cfg.economy.topup_to
        if target <= 0:
            return 0
        key = f"topup:{self.cfg.economy.topup_id}:{player_id}"
        async with self.sessions() as s:
            if await s.scalar(select(LedgerEntry.id).where(LedgerEntry.idempotency_key == key)) is not None:
                return 0  # this campaign already paid this player
        missing = target - await self.balance(player_id)
        if missing <= 0:
            return 0
        applied, _ = await self.post(player_id, missing, "topup", key, ref=self.cfg.economy.topup_id)
        return applied

    # ---- hunger (stored value + timestamp, decays lazily) ----
    def hunger_now(self, p: Player, now: datetime | None = None) -> float:
        now = now or datetime.now(UTC)
        at = p.hunger_at if p.hunger_at.tzinfo else p.hunger_at.replace(tzinfo=UTC)
        hours = max(0.0, (now - at).total_seconds() / 3600)
        return max(0.0, min(self.cfg.economy.max_hunger, p.hunger - hours * self.cfg.economy.hunger_decay_per_hour))

    async def get_hunger(self, player_id: str) -> float:
        async with self.sessions() as s:
            p = await s.get(Player, player_id)
            return self.hunger_now(p) if p else 0.0

    async def change_hunger(self, player_id: str, delta: float) -> float:
        async with self._locks[player_id], self.sessions() as s, s.begin():
            p = await s.get(Player, player_id, with_for_update=True)
            if p is None:
                return 0.0
            now = datetime.now(UTC)
            p.hunger = max(0.0, min(self.cfg.economy.max_hunger, self.hunger_now(p, now) + delta))
            p.hunger_at = now
            return p.hunger

    async def buy_food(self, player_id: str, item_id: str, key: str) -> tuple[int, float]:
        item = self.cfg.item(item_id)
        if item is None or item.category != "food":
            raise ValueError("Unknown food")
        _, bal = await self.post(player_id, -item.price, "food", key, ref=item.id)
        hunger = await self.change_hunger(player_id, item.hunger)
        return bal, hunger
