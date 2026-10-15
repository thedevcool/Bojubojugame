from __future__ import annotations

import re
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    inspect,
    text,
)
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
    # Accounts: unique username + scrypt password; email is optional and only used for resets.
    username: Mapped[str | None] = mapped_column(String(20), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    # Life sim: the phone you bought and the house you rent
    phone_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    car_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    home_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    rent_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Signed in through LagosLife (Vatar Games SDK): their per-game player id (p_… live, t_… test).
    # These "mini" accounts have no usable password and can't log in on our own site.
    vatar_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    avatar: Mapped[list[int]] = mapped_column(JSON, default=lambda: [0, 0, 0])
    # small per-account UI progress (guided tour step, first-game guide answer): survives devices,
    # and LagosLife's frame, where browser storage is often blocked
    flags: Mapped[dict[str, str] | None] = mapped_column(JSON, nullable=True)
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


class Friendship(Base):
    """One row per pair (a_id < b_id). status: pending | accepted."""

    __tablename__ = "friendships"
    __table_args__ = (Index("ux_friend_pair", "a_id", "b_id", unique=True),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    a_id: Mapped[str] = mapped_column(ForeignKey("players.id"), index=True)
    b_id: Mapped[str] = mapped_column(ForeignKey("players.id"), index=True)
    requested_by: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(10), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FurnitureItem(Base):
    """A piece of furniture a player owns. Placed items sit in their house (local coords, see app/houses.py)."""

    __tablename__ = "furniture"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id"), index=True)
    item: Mapped[str] = mapped_column(String(24))
    placed: Mapped[bool] = mapped_column(Boolean, default=False)
    lx: Mapped[float] = mapped_column(Float, default=0.0)
    lz: Mapped[float] = mapped_column(Float, default=0.0)
    rot: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Ad(Base):
    """A paid poster on a wall in the game. Paid with REAL naira via Paystack (never game naira)."""

    __tablename__ = "ads"
    __table_args__ = (Index("ix_ads_map_status", "map_id", "status"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id"), index=True)
    map_id: Mapped[str] = mapped_column(String(40))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    z: Mapped[float] = mapped_column(Float)
    nx: Mapped[int] = mapped_column(Integer)  # wall faces this way (-1/0/1)
    nz: Mapped[int] = mapped_column(Integer)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)
    size: Mapped[str] = mapped_column(String(8))
    price: Mapped[int] = mapped_column(Integer)  # real naira
    title: Mapped[str] = mapped_column(String(40))
    email: Mapped[str] = mapped_column(String(254))
    reference: Mapped[str] = mapped_column(String(64), unique=True)
    # paystack: awaiting_payment -> review (paid) -> live ; or rejected / refunded
    # vatar (LagosLife): review (unpaid) -> approved -> live (paid in LagosLife) ; or rejected
    provider: Mapped[str] = mapped_column(String(12), default="paystack")
    purchase_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="awaiting_payment")
    image: Mapped[bytes] = mapped_column(LargeBinary)
    image_type: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    live_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class VatarMatch(Base):
    """A LagosLife match (stakes held by LagosLife) played as one of our games."""

    __tablename__ = "vatar_matches"
    match_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    mode: Mapped[str] = mapped_column(String(8))
    nonce: Mapped[str] = mapped_column(String(128))
    claimed_by: Mapped[str] = mapped_column(String(32))  # our player who creates the lobby
    group_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    game_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    settled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DirectMessage(Base):
    __tablename__ = "direct_messages"
    __table_args__ = (Index("ix_dm_pair_id", "sender_id", "recipient_id", "id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sender_id: Mapped[str] = mapped_column(ForeignKey("players.id"))
    recipient_id: Mapped[str] = mapped_column(ForeignKey("players.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class PasswordReset(Base):
    """One-time reset links (only the hash of the token is stored)."""

    __tablename__ = "password_resets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
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


class AnalyticsVisit(Base):
    """One authenticated websocket visit, used for admin activity and time-spent metrics."""

    __tablename__ = "analytics_visits"
    __table_args__ = (
        Index("ix_analytics_visits_started", "started_at"),
        Index("ix_analytics_visits_ended", "ended_at"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)


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


def username_from(nickname: str) -> str:
    base = re.sub(r"[^a-z0-9_.]", "", nickname.lower().replace(" ", "_"))[:14]
    return base if len(base) >= 3 else (base + "player")[:14]


def _backfill_accounts(conn: Connection) -> None:
    """Players from before passwords existed get a username (from their nickname) and the
    temporary password 123456, flagged so they must choose a new one before playing."""
    from app.auth import LEGACY_TEMP_PASSWORD, hash_password  # local: avoid import cycle

    rows = conn.execute(text("SELECT id, nickname FROM players WHERE username IS NULL OR password_hash IS NULL")).all()
    if not rows:
        return
    taken = {r[0] for r in conn.execute(text("SELECT lower(username) FROM players WHERE username IS NOT NULL"))}
    for pid, nickname in rows:
        base = username_from(nickname or "player")
        name, n = base, 1
        while name in taken:
            n += 1
            name = f"{base[: 14 - len(str(n))]}{n}"
        taken.add(name)
        conn.execute(
            text(
                "UPDATE players SET username = COALESCE(username, :u), password_hash = :p, "
                "must_change_password = :t WHERE id = :id"
            ),
            {"u": name, "p": hash_password(LEGACY_TEMP_PASSWORD), "t": True, "id": pid},
        )


def _dedupe_homes(conn: Connection) -> None:
    """Houses used to be shareable: keep the tenant with the latest rent, move the rest out."""
    rows = conn.execute(text("SELECT id, home_id, rent_until FROM players WHERE home_id IS NOT NULL")).all()
    keep: dict[str, tuple[str, str]] = {}
    evict: list[str] = []
    for pid, home, until in rows:
        key = (str(until or ""), pid)
        cur = keep.get(home)
        if cur is None:
            keep[home] = key
        elif key > cur:
            evict.append(cur[1])
            keep[home] = key
        else:
            evict.append(pid)
    for pid in evict:
        conn.execute(text("UPDATE players SET home_id = NULL, rent_until = NULL WHERE id = :id"), {"id": pid})


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
            await conn.run_sync(_backfill_accounts)
            await conn.run_sync(_dedupe_homes)
            for ddl in (
                # one tenant per house
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_players_home ON players (home_id) WHERE home_id IS NOT NULL",
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_players_username ON players (lower(username))",
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_players_email ON players (lower(email)) WHERE email IS NOT NULL",
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_players_vatar ON players (vatar_id) WHERE vatar_id IS NOT NULL",
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_ads_purchase ON ads (purchase_id) WHERE purchase_id IS NOT NULL",
            ):
                await conn.execute(text(ddl))

    async def session(self) -> AsyncIterator[AsyncSession]:
        async with self.sessions() as s:
            yield s
