"""2D (x/z ground plane) collision, movement validation and line of sight.

Every function here is pure and deterministic so it can be unit tested and
re-used by the realtime layer for anti-cheat checks.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Box:
    """Axis-aligned solid footprint with a height (for line-of-sight)."""

    min_x: float
    min_z: float
    max_x: float
    max_z: float
    h: float

    def contains(self, x: float, z: float) -> bool:
        return self.min_x <= x <= self.max_x and self.min_z <= z <= self.max_z


Rect = tuple[float, float, float, float]  # min_x, min_z, max_x, max_z


def in_rect(rect: Rect | list[float], x: float, z: float) -> bool:
    return rect[0] <= x <= rect[2] and rect[1] <= z <= rect[3]


def in_bounds(bounds: Rect | list[float], x: float, z: float, radius: float) -> bool:
    return bounds[0] + radius <= x <= bounds[2] - radius and bounds[1] + radius <= z <= bounds[3] - radius


def circle_hits_box(x: float, z: float, r: float, b: Box) -> bool:
    cx = min(max(x, b.min_x), b.max_x)
    cz = min(max(z, b.min_z), b.max_z)
    dx, dz = x - cx, z - cz
    return dx * dx + dz * dz < r * r


def collides(x: float, z: float, r: float, boxes: list[Box]) -> bool:
    return any(circle_hits_box(x, z, r, b) for b in boxes)


def segment_hits_box(x0: float, z0: float, x1: float, z1: float, b: Box, pad: float = 0.0) -> bool:
    """Liang–Barsky slab test of segment against box expanded by ``pad``."""
    dx, dz = x1 - x0, z1 - z0
    t0, t1 = 0.0, 1.0
    for p, q in (
        (-dx, x0 - (b.min_x - pad)),
        (dx, (b.max_x + pad) - x0),
        (-dz, z0 - (b.min_z - pad)),
        (dz, (b.max_z + pad) - z0),
    ):
        if p == 0.0:
            if q < 0.0:
                return False
            continue
        t = q / p
        if p < 0.0:
            if t > t1:
                return False
            t0 = max(t0, t)
        else:
            if t < t0:
                return False
            t1 = min(t1, t)
    return t0 <= t1


def has_line_of_sight(ax: float, az: float, bx: float, bz: float, target_height: float, boxes: list[Box]) -> bool:
    """True if nothing at least as tall as the target blocks the segment.

    A crouched hider (short) is hidden by hedges and low walls; a standing
    one is visible over them.
    """
    for b in boxes:
        if b.h >= target_height and segment_hits_box(ax, az, bx, bz, b):
            return False
    return True


def distance(ax: float, az: float, bx: float, bz: float) -> float:
    return math.hypot(bx - ax, bz - az)


@dataclass(frozen=True, slots=True)
class MoveCheck:
    ok: bool
    reason: str = ""


def validate_move(
    *,
    from_x: float,
    from_z: float,
    to_x: float,
    to_z: float,
    dt: float,
    max_speed: float,
    tolerance: float,
    radius: float,
    bounds: Rect | list[float],
    boxes: list[Box],
    max_step: float | None = None,
) -> MoveCheck:
    """Server-side anti-cheat check for one movement step."""
    if not (math.isfinite(to_x) and math.isfinite(to_z)):
        return MoveCheck(False, "nan")
    if not in_bounds(bounds, to_x, to_z, radius):
        return MoveCheck(False, "bounds")
    # Allow a little latency jitter but never teleporting.
    allowed = max_step if max_step is not None else max_speed * max(dt, 0.05) * tolerance + 0.15
    if distance(from_x, from_z, to_x, to_z) > allowed:
        return MoveCheck(False, "speed")
    if collides(to_x, to_z, radius * 0.9, boxes):
        return MoveCheck(False, "solid")
    # Tunnelling: the path must not pass through a solid core.
    for b in boxes:
        if segment_hits_box(from_x, from_z, to_x, to_z, b, pad=-0.05) and not (b.contains(from_x, from_z)):
            return MoveCheck(False, "wall")
    return MoveCheck(True)


class BoxIndex:
    """Uniform-grid spatial index so collision/LOS checks only touch nearby boxes."""

    def __init__(self, boxes: list[Box], cell: float = 8.0) -> None:
        self.cell = cell
        self.boxes = boxes
        self.grid: dict[tuple[int, int], list[Box]] = {}
        for b in boxes:
            for key in self._cells(b.min_x, b.min_z, b.max_x, b.max_z):
                self.grid.setdefault(key, []).append(b)

    def _cells(self, x0: float, z0: float, x1: float, z1: float) -> list[tuple[int, int]]:
        c = self.cell
        return [
            (i, j)
            for i in range(math.floor(x0 / c), math.floor(x1 / c) + 1)
            for j in range(math.floor(z0 / c), math.floor(z1 / c) + 1)
        ]

    def query(self, x0: float, z0: float, x1: float, z1: float, pad: float = 0.0) -> list[Box]:
        """Boxes whose cells overlap the padded bounding box of the two points."""
        lo_x, hi_x = min(x0, x1) - pad, max(x0, x1) + pad
        lo_z, hi_z = min(z0, z1) - pad, max(z0, z1) + pad
        seen: dict[int, Box] = {}
        for key in self._cells(lo_x, lo_z, hi_x, hi_z):
            for b in self.grid.get(key, ()):
                seen[id(b)] = b
        return list(seen.values())
