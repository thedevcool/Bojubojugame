"""Accounts: username + password, optional email for resets.

Rules (enforced here, server-side):
- Accounts can only be created with a password (there is no passwordless path).
- Legacy accounts carry a temporary password and the ``must_change_password``
  flag; their tokens are marked and rejected everywhere except the endpoints
  needed to choose a new password.
- 5 wrong passwords lock an account for 15 minutes; reset links are single-use,
  expire after 30 minutes and are stored only as hashes.
"""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select

from app import auth
from app.content import GameConfig
from app.db import Database, Device, PasswordReset, Player
from app.mailer import send_email
from app.realtime.world import World
from app.safety import contains_profanity
from app.settings import get_settings

log = logging.getLogger("boju.accounts")

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.]{3,16}$")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[A-Za-z]{2,}$")
WEAK = {"12345678", "123456789", "password", "password1", "qwertyui", "11111111", "00000000", "bojuboju"}
RESET_MINUTES = 30


# ---------------------------------------------------------------- auth dependencies
def _claims(authorization: str | None) -> tuple[str, bool]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign in again")
    c = auth.verify_claims(authorization[7:])
    if c is None:
        raise HTTPException(401, "Session expired")
    return c


async def current_player(authorization: Annotated[str | None, Header()] = None) -> str:
    pid, must_change = _claims(authorization)
    if must_change:
        raise HTTPException(403, "Set a new password first")
    return pid


async def current_player_any(authorization: Annotated[str | None, Header()] = None) -> str:
    """Also accepts accounts that still have to choose a new password."""
    return _claims(authorization)[0]


Me = Annotated[str, Depends(current_player)]
MeAny = Annotated[str, Depends(current_player_any)]


# ---------------------------------------------------------------- validation
def clean_username(raw: str) -> str:
    name = raw.strip()
    if not USERNAME_RE.match(name):
        raise HTTPException(422, "Username: 3–16 letters, numbers, _ or .")
    if contains_profanity(name) or contains_profanity(name.replace("_", " ").replace(".", " ")):
        raise HTTPException(422, "Choose a friendlier username")
    return name


def check_password(pw: str, username: str = "") -> None:
    if len(pw) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    if len(pw) > 128:
        raise HTTPException(422, "Password is too long")
    if pw.lower() in WEAK or len(set(pw)) < 3 or (username and username.lower() in pw.lower()):
        raise HTTPException(422, "That password is too easy to guess — try another")


def clean_email(raw: str | None) -> str | None:
    if raw is None or not raw.strip():
        return None
    email = raw.strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        raise HTTPException(422, "That email doesn't look right")
    return email


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=16)
    password: str = Field(min_length=1, max_length=128)
    email: str | None = Field(default=None, max_length=254)
    home_area: str = Field(max_length=40)
    avatar: list[int] = Field(default_factory=lambda: [0, 0, 0], min_length=3, max_length=3)


class LoginIn(BaseModel):
    login: str = Field(min_length=3, max_length=254)  # username or email
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)


class EmailIn(BaseModel):
    email: str | None = Field(default=None, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class ForgotIn(BaseModel):
    login: str = Field(min_length=3, max_length=254)


class ResetIn(BaseModel):
    token: str = Field(min_length=20, max_length=100)
    new_password: str = Field(min_length=1, max_length=128)


def _token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=UTC)


def make_router(db: Database, world: World, cfg: GameConfig) -> APIRouter:
    r = APIRouter(prefix="/api")

    def session_payload(p: Player, device_secret: str) -> dict[str, Any]:
        return {
            "token": auth.issue_token(p.id, must_change=p.must_change_password),
            "player_id": p.id,
            "device_secret": device_secret,
            "username": p.username,
            "must_change_password": p.must_change_password,
        }

    async def find(s: Any, login: str) -> Player | None:
        key = login.strip().lower()
        return await s.scalar(
            select(Player).where(or_(func.lower(Player.username) == key, func.lower(Player.email) == key))
        )

    @r.post("/auth/register")
    async def register(body: RegisterIn) -> dict[str, Any]:
        username = clean_username(body.username)
        check_password(body.password, username)
        email = clean_email(body.email)
        if body.home_area not in cfg.home_areas:
            raise HTTPException(422, "Pick a Lagos area from the list")
        raw, hashed = auth.new_device_secret()
        async with db.sessions() as s, s.begin():
            if await s.scalar(select(Player.id).where(func.lower(Player.username) == username.lower())):
                raise HTTPException(409, "That username is taken — try another")
            if email and await s.scalar(select(Player.id).where(func.lower(Player.email) == email)):
                raise HTTPException(409, "That email is already used by another account")
            p = Player(
                username=username,
                nickname=username,
                password_hash=auth.hash_password(body.password),
                must_change_password=False,
                email=email,
                avatar=[max(0, min(7, int(v))) for v in body.avatar],
                home_area=body.home_area,
                device_secret_hash=hashed,
                hunger=float(cfg.economy.starting_hunger),
            )
            s.add(p)
            await s.flush()
            out = session_payload(p, raw)
        await world.economy.post(p.id, cfg.economy.starting_balance, "starting_balance", f"start:{p.id}")
        return out

    @r.post("/auth/login")
    async def login(body: LoginIn) -> dict[str, Any]:
        bad = HTTPException(401, "Username or password no correct")
        now = datetime.now(UTC)
        result: dict[str, Any] | None = None
        async with db.sessions() as s, s.begin():
            p = await find(s, body.login)
            if p is None or not p.password_hash:
                auth.password_matches(body.password, auth.hash_password("x"))  # equalise timing
                raise bad
            locked = _aware(p.locked_until)
            if locked and locked > now:
                mins = max(1, int((locked - now).total_seconds() // 60) + 1)
                raise HTTPException(429, f"Too many wrong passwords. Try again in {mins} min or reset it.")
            if auth.password_matches(body.password, p.password_hash):
                p.failed_logins = 0
                p.locked_until = None
                raw, hashed = auth.new_device_secret()
                s.add(Device(player_id=p.id, secret_hash=hashed))
                result = session_payload(p, raw)
            else:
                p.failed_logins = (p.failed_logins or 0) + 1
                if p.failed_logins >= auth.MAX_FAILS:
                    p.failed_logins = 0
                    p.locked_until = now + timedelta(minutes=auth.LOCK_MINUTES)
        if result is None:  # the failure counter was committed above
            raise bad
        log.info("login player=%s", result["player_id"])
        return result

    @r.post("/auth/password")
    async def change_password(body: ChangePasswordIn, pid: MeAny) -> dict[str, Any]:
        async with db.sessions() as s, s.begin():
            p = await s.get(Player, pid, with_for_update=True)
            if p is None:
                raise HTTPException(404, "Unknown player")
            if not auth.password_matches(body.current_password, p.password_hash):
                raise HTTPException(403, "Current password no correct")
            check_password(body.new_password, p.username or "")
            if body.new_password == body.current_password:
                raise HTTPException(422, "Pick a different password from the old one")
            p.password_hash = auth.hash_password(body.new_password)
            p.must_change_password = False
            return {"ok": True, "token": auth.issue_token(p.id)}

    @r.post("/auth/email")
    async def set_email(body: EmailIn, pid: Me) -> dict[str, Any]:
        email = clean_email(body.email)
        async with db.sessions() as s, s.begin():
            p = await s.get(Player, pid, with_for_update=True)
            if p is None or not auth.password_matches(body.password, p.password_hash):
                raise HTTPException(403, "Password no correct")
            if email and await s.scalar(select(Player.id).where(func.lower(Player.email) == email, Player.id != pid)):
                raise HTTPException(409, "That email is already used by another account")
            p.email = email
            return {"ok": True, "email": email}

    @r.post("/auth/forgot")
    async def forgot(body: ForgotIn) -> dict[str, Any]:
        """Always answers the same way so nobody can probe which accounts exist."""
        generic = {"ok": True, "message": "If that account has an email, a reset link is on its way."}
        async with db.sessions() as s, s.begin():
            p = await find(s, body.login)
            if p is None or not p.email:
                return generic
            raw = secrets.token_urlsafe(32)
            s.add(
                PasswordReset(
                    player_id=p.id,
                    token_hash=_token_hash(raw),
                    expires_at=datetime.now(UTC) + timedelta(minutes=RESET_MINUTES),
                )
            )
            to, name = p.email, p.username
        st = get_settings()
        # Fall back to the CORS origin (the real site URL) if PUBLIC_FRONTEND_URL wasn't configured.
        base = st.public_frontend_url if "localhost" not in st.public_frontend_url else st.frontend_origin.split(",")[0]
        link = f"{base.strip().rstrip('/')}/reset?token={raw}"
        await send_email(
            to,
            "Reset your Boju Boju password",
            f"Hi {name},\n\nTap this link to choose a new password (valid for {RESET_MINUTES} minutes):\n{link}\n\n"
            "If you didn't ask for this, you can ignore this email.\n\n— Boju Boju 🙈",
        )
        return generic

    @r.post("/auth/reset")
    async def reset(body: ResetIn) -> dict[str, Any]:
        now = datetime.now(UTC)
        async with db.sessions() as s, s.begin():
            row = await s.scalar(
                select(PasswordReset).where(PasswordReset.token_hash == _token_hash(body.token)).with_for_update()
            )
            expires = _aware(row.expires_at) if row else None
            if row is None or row.used or expires is None or expires < now:
                raise HTTPException(400, "This reset link has expired — request a new one")
            p = await s.get(Player, row.player_id, with_for_update=True)
            if p is None:
                raise HTTPException(400, "This reset link has expired — request a new one")
            check_password(body.new_password, p.username or "")
            row.used = True
            p.password_hash = auth.hash_password(body.new_password)
            p.must_change_password = False
            p.failed_logins = 0
            p.locked_until = None
            # sign out every device: whoever had access before the reset loses it
            p.device_secret_hash = auth.new_device_secret()[1]
            await s.execute(delete(Device).where(Device.player_id == p.id))
        return {"ok": True}

    @r.get("/me")
    async def me(pid: MeAny) -> dict[str, Any]:
        async with db.sessions() as s:
            p = await s.get(Player, pid)
        if p is None:
            raise HTTPException(404, "Unknown player")
        topup = bonus = 0
        if not p.must_change_password:
            topup = await world.economy.ensure_topup(pid)
            bonus = await world.economy.claim_daily_bonus(pid)
        return {
            "id": p.id,
            "username": p.username,
            "nickname": p.nickname,
            "email": p.email,
            "must_change_password": p.must_change_password,
            "home_area": p.home_area,
            "avatar": p.avatar,
            "balance": await world.economy.balance(pid),
            "hunger": round(world.economy.hunger_now(p), 1),
            "daily_bonus": bonus,
            "topup": topup,
            "phone_id": p.phone_id,
            "home_id": p.home_id,
            "rent_until": _aware(p.rent_until).isoformat() if p.rent_until else None,  # type: ignore[union-attr]
        }

    return r
