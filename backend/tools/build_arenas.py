"""Generates the city arenas (Ibadan, Abuja) as data.

Run: python tools/build_arenas.py   — then commit the JSON. Layouts are
procedural (seeded) with themed landmarks; tests check every arena is
playable (spawn clear, safe houses reachable, enough hiding spots).
"""

import json
import math
import random
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "app/content/maps"
B = 45  # half-size


def P(kind, x, z, w, d, h, **kw):
    return {"kind": kind, "x": round(x, 2), "z": round(z, 2), "w": w, "d": d, "h": h, **kw}


def overlaps(a, b, margin):
    return (
        abs(a["x"] - b["x"]) * 2 < a["w"] + b["w"] + margin * 2
        and abs(a["z"] - b["z"]) * 2 < a["d"] + b["d"] + margin * 2
    )


def scatter(rng, props, pool, n, region, keep_clear, margin=2.6):
    x0, z0, x1, z1 = region
    placed = 0
    for _ in range(n * 40):
        if placed >= n:
            break
        kind, w, d, h, extra = rng.choice(pool)
        if callable(w):
            w, d = w(rng), d(rng)
        if rng.random() < 0.5 and kind in ("hedge", "wall"):
            w, d = d, w
        cand = P(kind, rng.uniform(x0 + 3, x1 - 3), rng.uniform(z0 + 3, z1 - 3), w, d, h, **extra)
        if any(math.hypot(cand["x"] - cx, cand["z"] - cz) < r for cx, cz, r in keep_clear):
            continue
        if any(overlaps(cand, p, margin) for p in props):
            continue
        props.append(cand)
        placed += 1


def safe_room(x, z, door, sid, name, color):
    room = P("room", x, z, 8, 8, 3, door=door, color=color, id=sid)
    rect = [x - 3.6, z - 3.6, x + 3.6, z + 3.6]
    return room, {"id": sid, "name": name, "rect": rect}


def build(cfg):
    rng = random.Random(cfg["seed"])
    props = [dict(p) for p in cfg["landmarks"]]
    safes = []
    for (x, z, door), (sid, name) in zip(((30, 30, "n"), (30, -30, "w"), (-30, 30, "e")), cfg["safe"], strict=True):
        room, sh = safe_room(x, z, door, sid, name, cfg["room_color"])
        props.append(room)
        safes.append(sh)
    keep = [(0, 12, 7), (30, 25, 5), (24.5, -30, 5), (-24.5, 30, 5)]  # spawn + safe-house doorways
    for region in ((-45, -45, 0, 0), (0, -45, 45, 0), (-45, 0, 0, 45), (0, 0, 45, 45)):
        scatter(rng, props, cfg["pool"], cfg["per_quadrant"], region, keep)
    # perimeter dressing (visual fence just outside the play bounds)
    for side in (-1, 1):
        props.append(P("fence", 0, side * (B + 0.6), 2 * B + 2, 0.3, 2.2, color=cfg["fence"]))
        props.append(P("fence", side * (B + 0.6), 0, 0.3, 2 * B + 2, 2.2, color=cfg["fence"]))
    s = cfg["sections"]
    return {
        "id": cfg["id"],
        "name": cfg["name"],
        "kind": "arena",
        "city": cfg["city"],
        "venue": cfg["venue"],
        "bounds": [-B, -B, B, B],
        "ground": cfg["ground"],
        "spawn": [0, 12],
        "found_area": [0, 52],
        "props": props,
        "sections": [
            {"id": "centre", "name": s[0], "rect": [-14, -14, 14, 14]},
            {"id": "nw", "name": s[1], "rect": [-45, -45, 0, 0]},
            {"id": "ne", "name": s[2], "rect": [0, -45, 45, 0]},
            {"id": "sw", "name": s[3], "rect": [-45, 0, 0, 45]},
            {"id": "se", "name": s[4], "rect": [0, 0, 45, 45]},
        ],
        "safe_houses": safes,
        "zones": [],
    }


def rand_len(a, b):
    return lambda r: round(r.uniform(a, b), 1)


ABUJA = {
    "id": "arena_abuja",
    "name": "Millennium Park-style Gardens",
    "city": "abuja",
    "venue": {"name": "Millennium Park, Abuja", "lat": 9.0703, "lng": 7.5011},
    "ground": "#86b45c",
    "seed": 9,
    "room_color": "#efe9dc",
    "fence": "#d8cfc0",
    "per_quadrant": 13,
    "landmarks": [
        P("fountain", 0, -2, 9, 9, 1.3),
        P("hedge", -8, 8, 6, 1, 1.1),
        P("hedge", 8, 8, 6, 1, 1.1),
        *[P("palm", x, -16, 2, 2, 7.5) for x in (-20, -12, 12, 20)],
        P("wall", -30, -30, 12, 0.5, 2.4, color="#d8cfc0"),
        P("wall", -30, -24, 12, 0.5, 1.2, color="#d8cfc0"),
        P("wall", -30, -36, 12, 0.5, 1.2, color="#d8cfc0"),
    ],
    "pool": [
        ("hedge", rand_len(4, 9), lambda r: 1.0, 1.1, {}),
        ("tree", 3, 3, 6.5, {}),
        ("palm", 2, 2, 7.5, {}),
        ("wall", rand_len(4, 8), lambda r: 0.4, 1.3, {"color": "#d8cfc0"}),
        ("bench", 2, 0.6, 0.5, {}),
        ("kiosk", 2.4, 2.4, 2.6, {"color": "#2f6db5", "text": "ICE CREAM"}),
        ("car", 2, 4.2, 1.5, {"color": "#22313f"}),
    ],
    "sections": ["The Fountain", "Stone Steps", "Palm Avenue", "Rose Garden", "Pavilion Lawn"],
    "safe": [("pavilion", "The Pavilion"), ("gazebo", "Garden Gazebo House"), ("lodge", "Garden Lodge")],
}

IBADAN = {
    "id": "arena_ibadan",
    "name": "Agodi Gardens-style Hills",
    "city": "ibadan",
    "venue": {"name": "Agodi Gardens, Ibadan", "lat": 7.4045, "lng": 3.9177},
    "ground": "#7a9a4a",
    "seed": 4,
    "room_color": "#b9875a",
    "fence": "#a0663f",
    "per_quadrant": 12,
    "landmarks": [
        P("big_tree", 0, -2, 3, 3, 10),
        P("rock", -6, 3, 4, 3.5, 2.4),
        P("rock", 6, -6, 3.5, 3, 2.0),
        P("tower", 0, -32, 6, 6, 22, text="LOOKOUT"),
        P("wall", -30, -30, 10, 0.5, 2.2, color="#a0663f"),
        P("wall", -34, -26, 0.5, 8, 2.2, color="#a0663f"),
    ],
    "pool": [
        ("rock", rand_len(2.5, 5), rand_len(2.5, 4.5), 2.2, {}),
        ("big_tree", 3, 3, 9, {}),
        ("tree", 3, 3, 6.5, {}),
        ("wall", rand_len(4, 7), lambda r: 0.5, 2.0, {"color": "#a0663f"}),
        ("hedge", rand_len(3, 6), lambda r: 1.0, 1.1, {}),
        ("stall", 3, 2, 2.4, {"color": "#d94f3d", "text": "AMALA"}),
        ("tyres", 1.6, 1.6, 0.9, {}),
    ],
    "sections": ["Agodi Rock", "Dugbe Corner", "Bower's Lookout", "Mapo Hillside", "Bodija Path"],
    "safe": [("hunter_hut", "Hunter's Hut"), ("mud_house", "Old Mud House"), ("garden_hut", "Garden Hut")],
}

for cfg in (ABUJA, IBADAN):
    data = build(cfg)
    (OUT / f"{cfg['id']}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False), "utf-8")
    print(f"wrote {cfg['id']} with {len(data['props'])} props")
