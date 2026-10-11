"""House layouts (room & parlour) and furniture placement rules.

Everything here is pure and works in a house's *local* frame: origin at the
house centre, the front door on the +z wall, x to the right when you face the
door from inside. ``to_world`` maps local points into the map for any door
direction. The same rules run in the browser (frontend/src/game/furniture.ts).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

WALL_T = 0.3
FRONT_DOOR_W = 1.8
INNER_DOOR_W = 1.3
CLEAR = 0.15  # gap kept between furniture and walls

LocalRect = tuple[float, float, float, float]  # x0, z0, x1, z1 (local)


def to_world(door: str, cx: float, cz: float, lx: float, lz: float) -> tuple[float, float]:
    if door == "n":
        return cx - lx, cz - lz
    if door == "e":
        return cx + lz, cz - lx
    if door == "w":
        return cx - lz, cz + lx
    return cx + lx, cz + lz


@dataclass(frozen=True)
class Layout:
    """Interior plan of one house in its local frame."""

    w: float  # along the front wall
    d: float  # front to back
    style: str
    walls: tuple[LocalRect, ...]  # interior partitions (solid)
    doorways: tuple[LocalRect, ...]  # keep-clear areas in front of every doorway
    rooms: tuple[tuple[str, LocalRect], ...]


def _rect(cx: float, cz: float, w: float, d: float) -> LocalRect:
    return (cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2)


def layout(w: float, d: float, style: str) -> Layout:
    """Bungalow = parlour + bedroom. Duplex = parlour + bedroom + kitchen."""
    hw, hd = w / 2, d / 2
    split = -d * 0.1  # parlour at the front is a little bigger
    doors_x = [-w / 4, w / 4] if style == "duplex" else [w / 4]
    walls: list[LocalRect] = []
    # the partition between parlour and the back rooms, with a doorway per room
    edges = sorted([-hw, *[x for dx in doors_x for x in (dx - INNER_DOOR_W / 2, dx + INNER_DOOR_W / 2)], hw])
    for a, b in zip(edges[0::2], edges[1::2], strict=True):
        walls.append((a, split - WALL_T / 2, b, split + WALL_T / 2))
    rooms: list[tuple[str, LocalRect]] = [("Parlour", (-hw, split, hw, hd))]
    if style == "duplex":
        walls.append((-WALL_T / 2, -hd, WALL_T / 2, split))  # bedroom | kitchen
        rooms += [("Bedroom", (-hw, -hd, 0.0, split)), ("Kitchen", (0.0, -hd, hw, split))]
    else:
        rooms.append(("Bedroom", (-hw, -hd, hw, split)))
    doorways = [_rect(0.0, hd - 0.6, FRONT_DOOR_W + 0.4, 1.4)]
    doorways += [_rect(dx, split, INNER_DOOR_W + 0.3, 1.6) for dx in doors_x]
    return Layout(w=w, d=d, style=style, walls=tuple(walls), doorways=tuple(doorways), rooms=tuple(rooms))


# ---------------------------------------------------------------- furniture rules
def footprint(item_w: float, item_d: float, rot: int) -> tuple[float, float]:
    return (item_d, item_w) if rot % 2 else (item_w, item_d)


def _overlap(a: LocalRect, b: LocalRect, pad: float = 0.0) -> bool:
    return a[0] < b[2] + pad and b[0] < a[2] + pad and a[1] < b[3] + pad and b[1] < a[3] + pad


@dataclass
class Placement:
    id: int
    item: str
    lx: float
    lz: float
    rot: int


def check_layout(lay: Layout, placed: list[Placement], catalog: dict[str, Any]) -> str | None:
    """Returns a human-readable problem, or None if the layout is fine."""
    hw, hd = lay.w / 2 - WALL_T / 2 - CLEAR, lay.d / 2 - WALL_T / 2 - CLEAR
    solids: list[tuple[str, LocalRect]] = []
    for p in placed:
        spec = catalog.get(p.item)
        if spec is None:
            return "Unknown item"
        fw, fd = footprint(spec.w, spec.d, p.rot)
        r = _rect(p.lx, p.lz, fw, fd)
        eps = 1e-6
        if r[0] < -hw - eps or r[2] > hw + eps or r[1] < -hd - eps or r[3] > hd + eps:
            return f"{spec.name} doesn't fit there — keep it inside the walls"
        if not spec.solid:
            continue  # rugs and ceiling fans go anywhere
        if any(_overlap(r, wall) for wall in lay.walls):
            return f"{spec.name} is inside a wall"
        if any(_overlap(r, dw) for dw in lay.doorways):
            return f"{spec.name} is blocking a doorway"
        for name, other in solids:
            if _overlap(r, other, -0.02):
                return f"{spec.name} is on top of the {name.lower()}"
        solids.append((spec.name, r))
    return None


def starter_set(lay: Layout) -> list[tuple[str, float, float, int]]:
    """Furniture you find in a newly rented house: (item, lx, lz, rot)."""
    hw, hd = lay.w / 2, lay.d / 2
    split = -lay.d * 0.1
    bedroom_right = 0.0 if lay.style == "duplex" else hw
    out = [
        ("bed", -hw + 1.35, -hd + 1.45, 0),
        ("wardrobe", (-hw + bedroom_right) / 2 + 0.6, -hd + 0.66, 0),
        ("sofa", -hw + 0.8, (split + hd) / 2, 1),
        ("tv", hw - 0.6, (split + hd) / 2, 3),
        ("center_table", -0.6, (split + hd) / 2, 1),
        ("rug", -0.6, (split + hd) / 2, 0),
        ("ceiling_fan", 0.0, (split + hd) / 2, 0),
    ]
    if lay.style == "duplex":
        out += [("fridge", hw - 0.65, -hd + 0.65, 0), ("cooker", hw - 1.6, -hd + 0.6, 0)]
    else:
        out += [("standing_fan", hw - 0.6, -hd + 0.6, 0)]
    return out
