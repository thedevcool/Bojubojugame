"""A player's look: [skin, shirt, bottoms, body, hair] (older accounts have only the first three)."""

from __future__ import annotations

from collections.abc import Sequence

# how many choices each slot has: 8 skins, 8 ankara shirts, 8 trousers/skirts, male/female, 4 hairstyles
LIMITS = (8, 8, 8, 2, 4)
FEMALE, MALE = 1, 0


def clean_avatar(raw: Sequence[int]) -> list[int]:
    """Clamp every slot to its range and fill missing slots (older 3-number avatars are male, hair 0)."""
    vals = [int(v) for v in raw[: len(LIMITS)]]
    vals += [0] * (len(LIMITS) - len(vals))
    return [max(0, min(lim - 1, v)) for v, lim in zip(vals, LIMITS, strict=True)]
