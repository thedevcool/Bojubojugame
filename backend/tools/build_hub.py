"""Generates app/content/maps/hub_plaza.json (the Lagos hub district).

Run: python tools/build_hub.py   — then commit the JSON. Places are inspired by
Lagos, not replicas; brand names are invented.
"""

import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "app/content/maps/hub_plaza.json"
props: list[dict] = []


def P(kind, x, z, w, d, h, **kw):
    props.append({"kind": kind, "x": x, "z": z, "w": w, "d": d, "h": h, **kw})


# ---------------------------------------------------------------- roads
P("road", 0, 0, 160, 10, 0.02, dir="x", name="Herbert Macaulay-style Way")
P("road", 0, 42.5, 8, 75, 0.02, dir="z")
P("road", 0, -42.5, 8, 75, 0.02, dir="z")
P("road", -42, 40, 76, 8, 0.02, dir="x", name="Adeniji Street")
for zx in (-9.5, 9.5):
    P("zebra", 0, zx, 8, 3, 0.03)
for xz in (-6.5, 6.5):
    P("zebra", xz, 0, 3, 10, 0.03, dir="z")
P("zebra", -6.5, 40, 3, 8, 0.03, dir="z")
# sidewalks (raised kerb, gutter on the road side)
for x0, x1 in ((-80, -4), (4, 80)):
    P("sidewalk", (x0 + x1) / 2, 6.5, x1 - x0, 3, 0.12)
    P("sidewalk", (x0 + x1) / 2, -6.5, x1 - x0, 3, 0.12)
for z0, z1 in ((8, 80), (-80, -8)):
    P("sidewalk", 5.5, (z0 + z1) / 2, 3, z1 - z0, 0.12)
for z0, z1 in ((8, 36), (44, 80), (-80, -8)):
    P("sidewalk", -5.5, (z0 + z1) / 2, 3, z1 - z0, 0.12)
P("sidewalk", -43.5, 45.2, 73, 2.4, 0.12)
P("sidewalk", -43.5, 34.8, 73, 2.4, 0.12)

# street lights + electric poles with wires
for x in range(-72, 80, 16):
    if abs(x) > 6:
        P("lamp", x, 7.6, 0.3, 0.3, 5)
        P("lamp", x + 8, -7.6, 0.3, 0.3, 5)
for x in range(-76, 80, 19):
    if abs(x) > 6:
        P("pole", x, 8.4, 0.3, 0.3, 7.5, line="main-n")
for z in range(12, 80, 18):
    P("pole", 7.3, z, 0.3, 0.3, 7.5, line="cross-e")
for x in range(-76, -8, 17):
    P("pole", x, 46.8, 0.3, 0.3, 7.5, line="adeniji")

# ---------------------------------------------------------------- NW: Adeniji Street homes
colors = ["#f2d7a0", "#f4b183", "#cfe8b8", "#f7e08a", "#a9d3f5", "#f3c6c6", "#e9c9a3", "#d7c6f0"]
roofs = ["#7a3b2a", "#5b6670", "#8a4b2f", "#6d6d6d"]
names = [
    "No. 3 Adeniji St",
    "No. 5 Adeniji St",
    "No. 7 Adeniji St",
    "No. 9 Adeniji St",
    "No. 4 Adeniji St",
    "No. 6 Adeniji St",
    "No. 8 Adeniji St",
    "No. 10 Adeniji St",
]
for i, x in enumerate((-68, -50, -32, -16)):
    P("home", x, 26, 9, 8, 3.2, door="n", id=f"adeniji_{i * 2 + 3}", name=names[i], color=colors[i], roof=roofs[i % 4])
    P(
        "home",
        x,
        54,
        9,
        8,
        3.2,
        door="s",
        id=f"adeniji_{i * 2 + 4}",
        name=names[i + 4],
        color=colors[i + 4],
        roof=roofs[(i + 1) % 4],
    )
    P("generator", x + 5.6, 22.5, 1.4, 0.9, 1.1)
    P("generator", x - 5.6, 57.5, 1.4, 0.9, 1.1)
    P("palm" if i % 2 else "tree", x + 6.5, 31, 2, 2, 6.5)
for x in (-59, -41, -24):
    P("fence", x, 24.5, 0.25, 11, 1.6, color="#c9b48a")
    P("fence", x, 55.5, 0.25, 11, 1.6, color="#c9b48a")
P("wall", -43, 19.2, 66, 0.3, 2.2, color="#b9a67c", ad="OGA PAINTS — e no dey fade")
P("wall", -43, 61.2, 66, 0.3, 2.2, color="#b9a67c")

# ---------------------------------------------------------------- SW: gated estate
P("wall", -51, -14, 50, 0.3, 2.6, color="#e9e2d0")
P("wall", -16, -14, 8, 0.3, 2.6, color="#e9e2d0")
P("gate_post", -21.3, -14, 0.8, 0.8, 3)
P("gate_post", -26.7, -14, 0.8, 0.8, 3)
P("sign", -24, -13, 6, 0.3, 4.2, text="PALM VIEW ESTATE")
P("wall", -44, -76, 64, 0.3, 2.6, color="#e9e2d0")
P("wall", -76, -45, 0.3, 62, 2.6, color="#e9e2d0")
P("wall", -12, -45, 0.3, 62, 2.6, color="#e9e2d0")
P("kiosk", -18, -19, 2.4, 2.4, 2.6, color="#2f6db5", text="SECURITY")
P("lawn", -44, -45, 60, 58, 0.02)
for i, (x, z, door) in enumerate(((-62, -30, "s"), (-36, -30, "s"), (-62, -62, "n"), (-36, -62, "n"))):
    P(
        "home",
        x,
        z,
        11,
        9,
        3.4,
        door=door,
        id=f"estate_{i + 1}",
        name=f"Palm View Duplex {i + 1}",
        color=["#f3efe6", "#e8edf2", "#f2e6da", "#eef0e4"][i],
        roof="#3c4a57",
        style="duplex",
    )
    P(
        "car",
        x + 7.5,
        z + (5 if door == "s" else -5),
        2,
        4.2,
        1.5,
        color=["#22313f", "#a23b3b", "#8a8f96", "#1d1a16"][i],
    )
P("flat", -22, -60, 10, 14, 9, color="#c8d3db")
for x, z in ((-50, -45), (-30, -47), (-68, -44), (-20, -32)):
    P("palm", x, z, 2, 2, 7)
P("hedge", -49, -38, 14, 1, 1.1)
P("hedge", -49, -52, 14, 1, 1.1)

# ---------------------------------------------------------------- NE: market, motor park, shops
P("stall", 14, 12, 3, 2, 2.4, color="#d94f3d", text="SUYA")
P("grill", 16.6, 12, 1, 1, 1.0)
P("stall", 21, 12, 3, 2, 2.4, color="#e3a33b", text="CORN")
P("room", 30, 15, 7, 6, 3, door="s", color="#f0dcb0", id="mama_put_room")
P("sign", 30, 11.4, 5, 0.3, 3.9, text="MAMA PUT")
P("lot", 55, 23, 30, 22, 0.02)
for x in (46, 52, 58):
    P("danfo", x, 27, 2.4, 6, 2.6)
P("keke", 64, 24, 1.4, 2.4, 1.8)
P("keke", 66, 28, 1.4, 2.4, 1.8)
P("bus_shelter", 50, 14.5, 8, 2, 2.8, text="MOTOR PARK")
P("sign", 62, 12.5, 4, 0.3, 3.4, text="OSHODI • CMS • OBALENDE")
for z, txt, c in (
    (26, "OGA PHONE", "#3d7fd9"),
    (32, "BISI PROVISIONS", "#2f9e57"),
    (38, "SHARP CUT BARBER", "#8e44ad"),
    (44, "GOOD HEALTH CHEMIST", "#d94f3d"),
):
    P("shop", 12, z, 4, 5, 3.2, color=c, text=txt, face="w")
P("venue", 42, 62, 18, 12, 7, color="#6b3fa0", text="EVENTS — coming soon")
P("kiosk", 24, 24, 2.4, 2.4, 2.6, color="#f7c500", text="RECHARGE")
P("tree", 30, 38, 3, 3, 6.5)
P("tree", 66, 44, 3, 3, 6.5)
P("palm", 24, 50, 2, 2, 7)
P("billboard", 30, 9.2, 8, 0.4, 7, text="SUPA MALT — e sweet die!")
P("billboard", -40, -9.2, 8, 0.4, 7, text="NAIJA FRESH BREAD")

# ---------------------------------------------------------------- SE: football field + mechanic
P("field", 42, -44, 44, 34, 0.02)
P("goal", 21.5, -44, 0.3, 7, 2.4)
P("goal", 62.5, -44, 0.3, 7, 2.4)
P("room", 70, -16, 10, 8, 3.4, door="w", color="#a9a29a", id="mechanic")
P("sign", 64.6, -16, 0.3, 4, 3.8, text="MECHANIC")
P("car", 62, -24, 2, 4.2, 1.5, color="#5b6670")
P("tyres", 64, -12, 1.6, 1.6, 0.9)
for x, z in ((14, -30), (14, -60), (72, -60), (30, -72), (54, -72)):
    P("tree", x, z, 3, 3, 6.5)
P("kiosk", 10, -12, 2.4, 2.4, 2.6, color="#d94f3d", text="PURE WATER")

hub = {
    "id": "hub_plaza",
    "name": "Lagos Hub District",
    "kind": "hub",
    "bounds": [-80, -80, 80, 80],
    "ground": "#a8734a",
    "spawn": [8, 10],
    "arrival": [50, 17],
    "newcomer": [8.4, 20.5],  # brand-new players start here, right beside the phone shop
    "props": props,
    "sections": [
        {"id": "adeniji", "name": "Adeniji Street", "rect": [-80, 14, -8, 66]},
        {"id": "estate", "name": "Palm View Estate", "rect": [-76, -76, -12, -14]},
        {"id": "market", "name": "Market & Motor Park", "rect": [8, 8, 80, 40]},
        {"id": "events", "name": "Events Ground", "rect": [8, 40, 80, 80]},
        {"id": "pitch", "name": "Football Pitch", "rect": [8, -80, 80, -8]},
        {"id": "junction", "name": "Ojuelegba-style Junction", "rect": [-8, -8, 8, 8]},
    ],
    "safe_houses": [],
    "zones": [
        {"id": "bus_stop", "kind": "bus_stop", "name": "Motor Park", "rect": [44, 9, 56, 18]},
        {"id": "phone_shop", "kind": "phone_shop", "name": "Oga Phone", "rect": [6.8, 23.6, 9.9, 28.4]},
        {"id": "suya", "kind": "food", "name": "Suya Spot", "rect": [11, 8.5, 19, 15]},
        {"id": "corn", "kind": "food", "name": "Roasted Corn", "rect": [19, 8.5, 24, 15]},
        {"id": "mama_put", "kind": "food", "name": "Mama Put", "rect": [26.8, 12.4, 33.2, 17.6]},
    ],
    "npc_paths": [
        {"pts": [[-76, 6.6], [-6, 6.6]], "n": 4},
        {"pts": [[6, 6.6], [76, 6.6]], "n": 5},
        {"pts": [[-76, -6.6], [-6, -6.6]], "n": 3},
        {"pts": [[6, -6.6], [76, -6.6]], "n": 4},
        {"pts": [[5.5, 9], [5.5, 78]], "n": 4},
        {"pts": [[-5.5, -9], [-5.5, -78]], "n": 2},
        {"pts": [[-78, 45.2], [-8, 45.2]], "n": 4},
        {"pts": [[-78, 34.8], [-8, 34.8]], "n": 3},
        {"pts": [[12, 9.6], [30, 9.6], [40, 19], [62, 19], [62, 34]], "n": 4},
        {"pts": [[-60, -44], [-40, -44], [-40, -40], [-60, -40], [-60, -44]], "n": 2},
        {"pts": [[25, -40], [55, -48], [40, -30], [30, -56]], "n": 4},
    ],
    "vendors": [
        {"x": 14, "z": 13.6, "ry": 3.14, "say": "Fresh suya dey o!"},
        {"x": 21, "z": 13.6, "ry": 3.14, "say": "Corn! Hot corn!"},
        {"x": 30, "z": 16.6, "ry": 3.14, "say": "Jollof don ready!"},
        {"x": 9.4, "z": 32, "ry": -1.57, "say": "Customer, come and buy!"},
        {"x": 48, "z": 16.5, "ry": 3.14, "say": "Oshodi! Oshodi! Enter with your change!"},
        {"x": 56, "z": 16.5, "ry": 3.14, "say": "CMS! CMS! One chance!"},
        {"x": -18, "z": -21.5, "ry": 0, "say": "Welcome to Palm View, oga."},
        {"x": 68, "z": -19, "ry": -1.57, "say": "Your car go fine like new!"},
    ],
    "vehicles": [
        {"kind": "danfo", "pts": [[-90, -2.5], [90, -2.5]], "speed": 8, "n": 2},
        {"kind": "car", "pts": [[-90, -2.5], [90, -2.5]], "speed": 10, "n": 2},
        {"kind": "danfo", "pts": [[90, 2.5], [-90, 2.5]], "speed": 8, "n": 2},
        {"kind": "keke", "pts": [[90, 2.5], [-90, 2.5]], "speed": 6, "n": 2},
        {"kind": "car", "pts": [[2, -90], [2, 90]], "speed": 9, "n": 1},
        {"kind": "keke", "pts": [[-2, 90], [-2, -90]], "speed": 6, "n": 1},
    ],
}
OUT.write_text(json.dumps(hub, indent=1, ensure_ascii=False), "utf-8")
print(f"wrote {OUT} with {len(props)} props")
