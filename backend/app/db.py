from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


class Player(Base):
    __tablename__ = "players"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    nickname: Mapped[str] = mapped_column(String(24))
    home_area: Mapped[str] = mapped_column(String(40))
    device_secret_hash: Mapped[str] = mapped_column(String(128))
    # Login without email/phone: Boju ID = nickname#tag, plus an optional hashed PIN.
    tag: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pin_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    avatar: Mapped[list[int]] = mapped_column(JSON, default=lambda: [0, 0, 0])
    hunger: Mapped[float] = mapped_column(default=80.0)
    hunger_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Device(Base):
    """Extra devices a player logged in on (each gets its own refresh secret)."""

    __tablename__ = "devices"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id"), index=True)
    secret_hash: Mapped[str] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LedgerEntry(Base):
    """Append-only. Never UPDATE or DELETE rows in this table."""

    __tablename__ = "ledger"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(32))
    ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Game(Base):
    __tablename__ = "games"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    code: Mapped[str] = mapped_column(String(8), index=True)
    creator_id: Mapped[str] = mapped_column(ForeignKey("players.id"))
    arena_id: Mapped[str] = mapped_column(String(40))
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    results: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RoundStat(Base):
    __tablename__ = "round_stats"
    __table_args__ = (Index("ix_round_stats_created", "created_at"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[str] = mapped_column(ForeignKey("games.id"), index=True)
    round_no: Mapped[int] = mapped_column(Integer)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id"), index=True)
    role: Mapped[str] = mapped_column(String(8))  # seeker | hider
    finds: Mapped[int] = mapped_column(Integer, default=0)
    not_found: Mapped[bool] = mapped_column(Boolean, default=False)
    earned: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (Index("ix_chat_channel_created", "channel", "created_at"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    channel: Mapped[str] = mapped_column(String(64))
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id"))
    nickname: Mapped[str] = mapped_column(String(24))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class RouteCache(Base):
    """Road geometry fetched once from OSRM (keeps us far inside its usage policy)."""

    __tablename__ = "route_cache"
    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    coords: Mapped[list[list[float]]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reporter_id: Mapped[str] = mapped_column(ForeignKey("players.id"))
    target_id: Mapped[str] = mapped_column(ForeignKey("players.id"))
    reason: Mapped[str] = mapped_column(String(300))
    context: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


def _add_missing_columns(conn: Connection) -> None:
    """Tiny forward-only migration: add new nullable/defaulted columns to live tables.

    create_all() never alters existing tables, so columns added to a model after
    launch are added here. Only ever ADD COLUMN — never drop or rewrite data.
    """
    insp = inspect(conn)
    for table in Base.metadata.sorted_tables:
        if not insp.has_table(table.name):
            continue
        have = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name in have:
                continue
            ddl = col.type.compile(dialect=conn.dialect)
            default = ""
            if col.default is not None and getattr(col.default, "is_scalar", False):
                default = f" DEFAULT {col.default.arg!r}"
            conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{col.name}" {ddl}{default}'))


class Database:
    def __init__(self, url: str) -> None:
        kw: dict[str, Any] = {"pool_pre_ping": True}
        if url.startswith("sqlite"):
            kw = {"connect_args": {"check_same_thread": False}}
        self.engine: AsyncEngine = create_async_engine(url, **kw)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def create_all(self) -> None:
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.run_sync(_add_missing_columns)
            await conn.execute(
                text("CREATE UNIQUE INDEX IF NOT EXISTS ux_players_nick_tag ON players (lower(nickname), tag)")
            )

    async def session(self) -> AsyncIterator[AsyncSession]:
        async with self.sessions() as s:
            yield s
