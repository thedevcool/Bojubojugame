"""Text sanitising, profanity filter and rate limiting."""

from __future__ import annotations

import re
import time
import unicodedata

# Small, conservative list; extend via PRs. Matched on word boundaries.
_BAD_WORDS = {
    "fuck",
    "fucking",
    "shit",
    "bitch",
    "bastard",
    "cunt",
    "dick",
    "pussy",
    "asshole",
    "nigger",
    "nigga",
    "whore",
    "slut",
    "motherfucker",
    "mumu",
    "olodo",
    "werey",
    "ashawo",
    "oloshi",
    "omo ale",
    "dickhead",
    "retard",
}
_BAD_RE = re.compile(r"\b(" + "|".join(re.escape(w) for w in sorted(_BAD_WORDS, key=len, reverse=True)) + r")\b", re.I)
_LINK_RE = re.compile(r"(https?://|www\.|\b[\w-]+\.(com|ng|net|org|io|xyz|me|co|app|link|ly)\b)", re.I)
_CTRL_RE = re.compile(r"[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]")
_NICK_RE = re.compile(r"[^\w .\-]", re.UNICODE)


class TextRejected(ValueError):
    pass


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = _CTRL_RE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def contains_profanity(text: str) -> bool:
    return bool(_BAD_RE.search(text))


def clean_chat(text: str, max_len: int) -> str:
    text = _normalise(text)
    if not text:
        raise TextRejected("Message is empty")
    if len(text) > max_len:
        raise TextRejected(f"Max {max_len} characters")
    if _LINK_RE.search(text):
        raise TextRejected("Links are not allowed")
    return _BAD_RE.sub(lambda m: "*" * len(m.group(0)), text)


def clean_nickname(nick: str) -> str:
    nick = _NICK_RE.sub("", _normalise(nick))[:16].strip()
    if len(nick) < 2:
        raise TextRejected("Nickname must be 2–16 letters or numbers")
    if contains_profanity(nick) or contains_profanity(nick.replace(" ", "")):
        raise TextRejected("Choose a friendlier nickname")
    return nick


class TokenBucket:
    __slots__ = ("rate", "burst", "tokens", "last")

    def __init__(self, rate: float, burst: float) -> None:
        self.rate, self.burst = rate, burst
        self.tokens, self.last = burst, time.monotonic()

    def allow(self, cost: float = 1.0) -> bool:
        now = time.monotonic()
        self.tokens = min(self.burst, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens >= cost:
            self.tokens -= cost
            return True
        return False


class KeyedLimiter:
    """Per-key token buckets (e.g. per IP for REST). Bounded memory."""

    def __init__(self, rate: float, burst: float, max_keys: int = 50_000) -> None:
        self.rate, self.burst, self.max_keys = rate, burst, max_keys
        self.buckets: dict[str, TokenBucket] = {}

    def allow(self, key: str) -> bool:
        b = self.buckets.get(key)
        if b is None:
            if len(self.buckets) >= self.max_keys:
                self.buckets.clear()
            b = self.buckets[key] = TokenBucket(self.rate, self.burst)
        return b.allow()
