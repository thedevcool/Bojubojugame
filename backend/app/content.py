"""Loads and validates game_config.json and the map files (single source of truth)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from app.engine.geometry import Box
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

    def item(self, item_id: str) -> Item | None:
        return next((i for i in self.items if i.id == item_id), None)

    def fare(self, fare_id: str) -> Fare | None:
        return next((f for f in self.fares if f.id == fare_id), None)

    @property
    def cheapest_fare(self) -> Fare:
        return min(self.fares, key=lambda f: f.price)


NON_SOLID = {"road", "bus_shelter", "sign", "lamp"}
TRUNK = {"tree": 0.7, "big_tree": 1.6, "palm": 0.5}
WALL_T = 0.3
DOOR_W = 2.0


def _expand_room(p: dict[str, Any]) -> list[dict[str, Any]]:
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
        parts = [(a, c - DOOR_W / 2), (c + DOOR_W / 2, b)]
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
        for p in raw["props"]:
            props.extend(_expand_room(p) if p["kind"] == "room" else [dict(p)])
        for p in props:
            p["collider"] = _collider(p)
        self.raw = {**raw, "props": props}
        self.id: str = raw["id"]
        self.kind: str = raw["kind"]
        self.bounds: list[float] = raw["bounds"]
        self.spawn: tuple[float, float] = (raw["spawn"][0], raw["spawn"][1])
        self.found_area: tuple[float, float] = tuple(raw.get("found_area", raw["spawn"]))  # type: ignore[assignment]
        self.boxes: list[Box] = [Box(*p["collider"]) for p in props if p["collider"]]
        self.zones: dict[str, dict[str, Any]] = {z["id"]: z for z in raw.get("zones", [])}
        self.safe_houses: dict[str, dict[str, Any]] = {s["id"]: s for s in raw.get("safe_houses", [])}
        self.sections: list[dict[str, Any]] = raw.get("sections", [])


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
