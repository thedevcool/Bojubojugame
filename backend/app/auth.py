from __future__ import annotations

import hashlib
import hmac
import secrets
import time

import jwt

from app.settings import get_settings


def issue_token(player_id: str, must_change: bool = False) -> str:
    """Short-lived session token. ``mc`` marks accounts that must set a new password
    before they may do anything except change it."""
    s = get_settings()
    now = int(time.time())
    claims: dict[str, object] = {"sub": player_id, "iat": now, "exp": now + s.jwt_ttl_minutes * 60}
    if must_change:
        claims["mc"] = 1
    return jwt.encode(claims, s.jwt_secret, "HS256")


def verify_claims(token: str) -> tuple[str, bool] | None:
    try:
        data = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
    except jwt.PyJWTError:
        return None
    sub = data.get("sub")
    return (sub, bool(data.get("mc"))) if isinstance(sub, str) else None


def verify_token(token: str) -> str | None:
    """Player id for a token that is allowed to play (not pending a password change)."""
    c = verify_claims(token)
    return c[0] if c and not c[1] else None


def new_device_secret() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hash_secret(raw)


def hash_secret(raw: str) -> str:
    # High-entropy random secret: a plain SHA-256 is sufficient and survives JWT key rotation.
    return hashlib.sha256(raw.encode()).hexdigest()


def secret_matches(raw: str, stored: str) -> bool:
    return hmac.compare_digest(hash_secret(raw), stored)


# ---- passwords ----------------------------------------------------------------------------
MAX_FAILS = 5
LOCK_MINUTES = 15
LEGACY_TEMP_PASSWORD = "123456"  # only for accounts created before passwords existed


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${dk.hex()}"


def password_matches(pw: str, stored: str | None) -> bool:
    if not stored or not stored.startswith("scrypt$"):
        return False
    _, salt_hex, dk_hex = stored.split("$")
    dk = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32)
    return hmac.compare_digest(dk.hex(), dk_hex)
