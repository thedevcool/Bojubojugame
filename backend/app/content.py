"""Loads and validates game_config.json and the map files (single source of truth)."""

from __future__ import annotations

import json
from functools import cached_property, lru_cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from app import houses
from app.engine.geometry import Box, BoxIndex
from app.engine.nav import NavGrid, hide_spots
from app.engine.rules import Scoring

CONTENT_DIR = Path(__file__).parent / "content"


class GameRules(BaseModel):
    min_players: int = Field(ge=2)
    max_players: int = Field(le=6)
    hide_time_options: list[int]
    search_time_options: list[int]
    default_hide_time: int
    default_search_time: int
    travel_window_s: float
    dice_pick_s: float
    reveal_s: float
    result_s: float
    tag_range_m: float
    visibility_range_m: float
    crouch_visibility_range_m: float
    safe_house_total_s: float
    safe_house_capacity: int
    disconnect_grace_s: float
    seeker_disconnect_skip_s: float
    max_rounds: int
    hunger_per_round: int
    min_hunger_to_play: int
    lobby_idle_expiry_s: float
    gather_timeout_s: float = 75.0


class Movement(BaseModel):
    walk_speed: float
    run_speed: float
    crouch_speed: float
    stamina_max_s: float
    stamina_regen_per_s: float
    player_radius: float
    speed_tolerance: float
    stand_height: float
    crouch_height: float


class Economy(BaseModel):
    starting_balance: int = Field(ge=0)
    daily_bonus: int = Field(ge=0)
    max_hunger: int
    starting_hunger: int
    hunger_decay_per_hour: float
    # One-time top-up for existing players during the test phase (0 disables).
    # Bump topup_id to run a new top-up campaign; each player gets each campaign once.
    topup_to: int = Field(default=0, ge=0)
    topup_id: str = "none"


class Fare(BaseModel):
    id: str
    name: str
    price: int = Field(ge=0)
    ride_s: float


class Item(BaseModel):
    id: str
    name: str
    category: str
    price: int = Field(ge=0)
    hunger: int = 0
    spot: str | None = None


class Emote(BaseModel):
    id: str
    text: str


class ChatCfg(BaseModel):
    max_len: int
    history: int
    retention_days: int
    rate_per_s: float
    burst: int
    nearby_radius_m: float


class NetCfg(BaseModel):
    hub_shard_max: int
    hub_interest_radius_m: float
    snapshot_hz: float
    max_frame_bytes: int


class City(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    blurb: str = ""
    arenas: list[str]
    fares: list[Fare] | None = None  # None = local fares (danfo/keke)


class Phone(BaseModel):
    id: str
    name: str
    price: int = Field(ge=0)
    color: str
    tagline: str = ""


class Furniture(BaseModel):
    id: str
    name: str
    price: int = Field(ge=0)
    w: float = Field(gt=0, le=4)
    d: float = Field(gt=0, le=4)
    h: float = Field(gt=0, le=3.2)
    category: str
    solid: bool = True
    seat: float | None = None  # sit height, if you can sit on it
    bed: bool = False  # you can sleep on it


class Rent(BaseModel):
    days: int = Field(ge=1)
    prices: dict[str, int]


class GameConfig(BaseModel):
    currency_symbol: str
    money_disclaimer: str
    scoring: Scoring
    game: GameRules
    movement: Movement
    economy: Economy
    fares: list[Fare]
    items: list[Item]
    home_areas: list[str]
    emotes: list[Emote]
    chat: ChatCfg
    network: NetCfg
    cities: list[City]
    phones: list[Phone]
    furniture: list[Furniture]
    rent: Rent
    home_coords: dict[str, tuple[float, float]]

    def city_of(self, arena_id: str) -> City | None:
        return next((c for c in self.cities if arena_id in c.arenas), None)

    def fares_for(self, arena_id: str) -> list[Fare]:
        city = self.city_of(arena_id)
        return city.fares if city and city.fares else self.fares

    def furniture_by_id(self) -> dict[str, Furniture]:
        return {f.id: f for f in self.furniture}

    def item(self, item_id: str) -> Item | None:
        return next((i for i in self.items if i.id == item_id), None)

    def fare(self, fare_id: str) -> Fare | None:
        return next((f for f in self.fares if f.id == fare_id), None)

    @property
    def cheapest_fare(self) -> Fare:
        return min(self.fares, key=lambda f: f.price)


NON_SOLID = {
    "road",
    "bus_shelter",
    "sign",
    "lamp",
    "roof",
    "rug",
    "fan",
    "sidewalk",
    "zebra",
    "gutter",
    "field",
    "floor",
    "wire",
    "puddle",
    "lawn",
    "lot",
    "porch",
    "canopy",
    "door_leaf",
    "ac",
}
TRUNK = {"tree": 0.7, "big_tree": 1.6, "palm": 0.5}
WALL_T = 0.3
DOOR_W = 2.0


def _expand_room(p: dict[str, Any], door_w: float = DOOR_W) -> list[dict[str, Any]]:
    """A 'room' is 4 walls with a doorway on one side (modular kit)."""
    x, z, w, d, h = p["x"], p["z"], p["w"], p["d"], p["h"]
    color = p.get("color", "#d8c8a8")
    door = p.get("door", "s")
    x0, x1, z0, z1 = x - w / 2, x + w / 2, z - d / 2, z + d / 2

    def wall(cx: float, cz: float, ww: float, dd: float) -> dict[str, Any]:
        return {"kind": "wall", "x": cx, "z": cz, "w": ww, "d": dd, "h": h, "color": color}

    def side(horizontal: bool, fixed: float, a: float, b: float, has_door: bool) -> list[dict[str, Any]]:
        if not has_door:
            mid = (a + b) / 2
            return [wall(mid, fixed, b - a, WALL_T) if horizontal else wall(fixed, mid, WALL_T, b - a)]
        c = (a + b) / 2
        parts = [(a, c - door_w / 2), (c + door_w / 2, b)]
        out = []
        for s, e in parts:
            m, ln = (s + e) / 2, e - s
            out.append(wall(m, fixed, ln, WALL_T) if horizontal else wall(fixed, m, WALL_T, ln))
        return out

    walls = (
        side(True, z0, x0, x1, door == "n")
        + side(True, z1, x0, x1, door == "s")
        + side(False, x0, z0, z1, door == "w")
        + side(False, x1, z0, z1, door == "e")
    )
    floor = {
        "kind": "floor",
        "x": x,
        "z": z,
        "w": w,
        "d": d,
        "h": 0.05,
        "color": "#8c7a5b",
        "solid": False,
        "label": p.get("id"),
    }
    return [floor, *walls]


def _expand_home(p: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """A home = outer walls (with windows) + room-and-parlour partitions + porch + roof.

    Furniture is not part of the map: tenants own it (see app/houses.py, app/life.py).
    """
    door = p.get("door", "s")
    x, z, w, d, h = p["x"], p["z"], p["w"], p["d"], p["h"]
    style = p.get("style", "bungalow")
    local_w, local_d = (w, d) if door in ("n", "s") else (d, w)
    lay = houses.layout(local_w, local_d, style)
    room = _expand_room({**p, "kind": "room"}, door_w=houses.FRONT_DOOR_W)
    room[0]["color"] = "#b9a58a"  # tiled floor
    for part in room[1:]:
        part["win"] = True  # windows with burglar-proof bars on the outside walls
    out = list(room)

    def local_box(kind: str, r: tuple[float, float, float, float], hh: float, **kw: Any) -> dict[str, Any]:
        cx, cz = houses.to_world(door, x, z, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2)
        bw, bd = r[2] - r[0], r[3] - r[1]
        if door in ("e", "w"):
            bw, bd = bd, bw
        return {"kind": kind, "x": round(cx, 3), "z": round(cz, 3), "w": bw, "d": bd, "h": hh, "label": p["id"], **kw}

    for r in lay.walls:
        out.append(local_box("wall", r, h, color="#efe6d4", inner=True))
    hd = local_d / 2
    # porch: a raised slab and two pillars holding a small canopy over the front door
    out.append(local_box("porch", (-1.6, hd, 1.6, hd + 1.4), 0.14, solid=False))
    for px in (-1.45, 1.45):
        out.append(local_box("pillar", (px - 0.13, hd + 1.15, px + 0.13, hd + 1.41), h - 0.2))
    out.append(local_box("canopy", (-1.75, hd, 1.75, hd + 1.55), h - 0.2, solid=False))
    out.append(local_box("door_leaf", (-0.78, hd - 0.85, -0.72, hd - 0.05), 2.1, solid=False))
    out.append(local_box("ac", (local_w / 2 + 0.15, -0.5, local_w / 2 + 0.55, 0.5), 2.2, solid=False))
    out.append(
        {
            "kind": "roof",
            "x": x,
            "z": z,
            "w": w + 0.8,
            "d": d + 0.8,
            "h": h,
            "label": p["id"],
            "color": p.get("roof", "#7a3b2a"),
            "style": style,
        }
    )
    sx, sz = houses.to_world(door, x, z, 0.0, hd - 1.6)
    ox, oz = houses.to_world(door, x, z, 0.0, hd + 1.9)
    home = {
        "id": p["id"],
        "name": p.get("name", "Home"),
        "rect": [x - w / 2 + 0.2, z - d / 2 + 0.2, x + w / 2 - 0.2, z + d / 2 - 0.2],
        "spawn": [round(sx, 2), round(sz, 2)],
        "door": [round(ox, 2), round(oz, 2)],
        "center": [x, z],
        "dir": door,
        "lw": local_w,
        "ld": local_d,
        "style": style,
        "walls": [list(r) for r in lay.walls],
        "doorways": [list(r) for r in lay.doorways],
        "rooms": [{"name": n, "rect": list(r)} for n, r in lay.rooms],
    }
    return out, home


def _collider(p: dict[str, Any]) -> list[float] | None:
    if not p.get("solid", p["kind"] not in NON_SOLID):
        return None
    if p["kind"] in TRUNK:
        t = TRUNK[p["kind"]] / 2
        return [p["x"] - t, p["z"] - t, p["x"] + t, p["z"] + t, p["h"]]
    hw, hd = p["w"] / 2, p["d"] / 2
    return [p["x"] - hw, p["z"] - hd, p["x"] + hw, p["z"] + hd, p["h"]]


class MapData:
    def __init__(self, raw: dict[str, Any]) -> None:
        props: list[dict[str, Any]] = []
        homes: list[dict[str, Any]] = []
        for p in raw["props"]:
            if p["kind"] == "room":
                props.extend(_expand_room(p))
            elif p["kind"] == "home":
                parts, home = _expand_home(p)
                props.extend(parts)
                homes.append(home)
            else:
                props.append(dict(p))
        for p in props:
            p["collider"] = _collider(p)
        self.raw = {**raw, "props": props, "homes": homes}
        self.homes = homes
        self.arrival: tuple[float, float] = tuple(raw.get("arrival", raw["spawn"]))  # type: ignore[assignment]
        self.id: str = raw["id"]
        self.kind: str = raw["kind"]
        self.bounds: list[float] = raw["bounds"]
        self.spawn: tuple[float, float] = (raw["spawn"][0], raw["spawn"][1])
        self.found_area: tuple[float, float] = tuple(raw.get("found_area", raw["spawn"]))  # type: ignore[assignment]
        self.boxes: list[Box] = [Box(*p["collider"]) for p in props if p["collider"]]
        self.index = BoxIndex(self.boxes)
        self.zones: dict[str, dict[str, Any]] = {z["id"]: z for z in raw.get("zones", [])}
        self.safe_houses: dict[str, dict[str, Any]] = {s["id"]: s for s in raw.get("safe_houses", [])}
        self.sections: list[dict[str, Any]] = raw.get("sections", [])

    def near(self, x0: float, z0: float, x1: float, z1: float, pad: float = 1.0) -> list[Box]:
        return self.index.query(x0, z0, x1, z1, pad)

    def home_by_id(self, home_id: str | None) -> dict[str, Any] | None:
        return next((h for h in self.homes if h["id"] == home_id), None) if home_id else None

    @property
    def newcomer(self) -> tuple[float, float]:
        n = self.raw.get("newcomer") or self.raw["spawn"]
        return float(n[0]), float(n[1])

    @cached_property
    def nav(self) -> NavGrid:
        return NavGrid(self.bounds, self.boxes, 0.35)

    @cached_property
    def hide_spots(self) -> list[tuple[float, float]]:
        return hide_spots(self.nav, self.boxes)


@lru_cache
def get_config() -> GameConfig:
    return GameConfig.model_validate(json.loads((CONTENT_DIR / "game_config.json").read_text("utf-8")))


@lru_cache
def get_maps() -> dict[str, MapData]:
    maps = {}
    for f in sorted((CONTENT_DIR / "maps").glob("*.json")):
        m = MapData(json.loads(f.read_text("utf-8")))
        maps[m.id] = m
    return maps


HUB_MAP_ID = "hub_plaza"


def arena_ids() -> list[str]:
    return [m.id for m in get_maps().values() if m.kind == "arena"]
