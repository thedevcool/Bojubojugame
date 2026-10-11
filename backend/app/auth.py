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
