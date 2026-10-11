from __future__ import annotations

import hashlib
import hmac
import secrets
import time

import jwt

from app.settings import get_settings


def issue_token(player_id: str) -> str:
    s = get_settings()
    now = int(time.time())
    return jwt.encode({"sub": player_id, "iat": now, "exp": now + s.jwt_ttl_minutes * 60}, s.jwt_secret, "HS256")


def verify_token(token: str) -> str | None:
    try:
        data = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
    except jwt.PyJWTError:
        return None
    sub = data.get("sub")
    return sub if isinstance(sub, str) else None


def new_device_secret() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hash_secret(raw)


def hash_secret(raw: str) -> str:
    # High-entropy random secret: a plain SHA-256 is sufficient and survives JWT key rotation.
    return hashlib.sha256(raw.encode()).hexdigest()


def secret_matches(raw: str, stored: str) -> bool:
    return hmac.compare_digest(hash_secret(raw), stored)


# ---- PIN login (no email/phone by design) ------------------------------------------------
PIN_MAX_FAILS = 5
PIN_LOCK_MINUTES = 15


def hash_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(pin.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${dk.hex()}"


def pin_matches(pin: str, stored: str | None) -> bool:
    if not stored or not stored.startswith("scrypt$"):
        return False
    _, salt_hex, dk_hex = stored.split("$")
    dk = hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32)
    return hmac.compare_digest(dk.hex(), dk_hex)


def boju_id(nickname: str, tag: int | None) -> str | None:
    return f"{nickname}#{tag:04d}" if tag is not None else None


def parse_boju_id(raw: str) -> tuple[str, int] | None:
    raw = raw.strip()
    if "#" not in raw:
        return None
    nick, _, tag = raw.rpartition("#")
    if not nick.strip() or not tag.isdigit() or len(tag) != 4:
        return None
    return nick.strip(), int(tag)
