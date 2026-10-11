"""Real-world travel routes for the ride animation.

Road routes come from the public OSRM server once per (origin, venue) pair and
are cached in Postgres forever; flights are a great-circle-ish arc. If OSRM is
unreachable we return a gently curved fallback (not cached, so it retries).
"""

from __future__ import annotations

import logging
import math

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db import RouteCache

log = logging.getLogger("boju.routes")
OSRM = "https://router.project-osrm.org/route/v1/driving/{a};{b}?overview=full&geometries=geojson"
MAX_POINTS = 220


def simplify(coords: list[list[float]], max_points: int = MAX_POINTS) -> list[list[float]]:
    if len(coords) <= max_points:
        return [[round(x, 5), round(y, 5)] for x, y in coords]
    step = (len(coords) - 1) / (max_points - 1)
    out = [coords[round(i * step)] for i in range(max_points)]
    return [[round(x, 5), round(y, 5)] for x, y in out]


def arc(a: tuple[float, float], b: tuple[float, float], lift: float, n: int = 64) -> list[list[float]]:
    """Curved path from a to b (lng, lat); ``lift`` bends it sideways (flight-like)."""
    (x0, y0), (x1, y1) = a, b
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy) or 1
    cx, cy = mx - dy / length * length * lift, my + dx / length * length * lift
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t**2 * x1
        y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t**2 * y1
        pts.append([round(x, 5), round(y, 5)])
    return pts


async def get_route(
    sessions: async_sessionmaker[AsyncSession],
    origin: tuple[float, float],
    dest: tuple[float, float],
    key: str,
    mode: str,
) -> tuple[list[list[float]], str]:
    """Returns (coords [[lng, lat]...], source) where source is cache|osrm|arc."""
    if mode == "flight":
        return arc(origin, dest, 0.18), "arc"
    async with sessions() as s:
        hit = await s.get(RouteCache, key)
        if hit is not None:
            return hit.coords, "cache"
    a = f"{origin[0]},{origin[1]}"
    b = f"{dest[0]},{dest[1]}"
    try:
        async with httpx.AsyncClient(timeout=6.0, headers={"User-Agent": "BojuBoju/1.0 (game route cache)"}) as client:
            r = await client.get(OSRM.format(a=a, b=b))
            r.raise_for_status()
            coords = simplify(r.json()["routes"][0]["geometry"]["coordinates"])
    except Exception as e:  # noqa: BLE001 - any failure falls back to a drawn route
        log.warning("osrm failed key=%s err=%s", key, type(e).__name__)
        return arc(origin, dest, 0.06), "arc"
    async with sessions() as s, s.begin():
        if await s.get(RouteCache, key) is None:
            s.add(RouteCache(key=key, coords=coords))
    return coords, "osrm"
