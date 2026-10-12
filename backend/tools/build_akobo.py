"""Generates app/content/maps/arena_akobo.json: Akobo, Ibadan, as a district you can explore and play in.

Run: python tools/build_akobo.py   — then commit the JSON.

Inspired by the real place (north-east Ibadan): the Idi-Ape–Basorun–Akobo–Odogbo dual carriageway,
the General Gas flyover over the General Gas junction, walled compounds on red laterite side streets
in Basorun Estate and Akobo Estate, Akobo Ojurin market, the Akobo police station, and the gate to
Odogbo Barracks at the east end. Businesses, churches and schools have invented names.
"""

import json
import random
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "app/content/maps/arena_akobo.json"
B = 60  # half-size
rng = random.Random(23)
props: list[dict] = []


def P(kind, x, z, w, d, h, **kw):
    p = {"kind": kind, "x": round(x, 2), "z": round(z, 2), "w": w, "d": d, "h": h, **kw}
    props.append(p)
    return p


# ------------------------------------------------------------------ the main road (west -> east)
ROAD = "Idi-Ape–Akobo–Odogbo Road"
GX = -30  # General Gas junction
for z in (-4.6, 4.6):
    P("road", 0, z, 2 * B, 7, 0.02, dir="x", name=ROAD)
P("median", 0, 0, 2 * B, 2.2, 0.25)
for z in (-9.3, 9.3):
    for x0, x1 in ((-B, -34.5), (-25.5, B)):
        P("sidewalk", (x0 + x1) / 2, z, x1 - x0, 2.4, 0.12)
# street lights in the median, electric poles along the north side
for x in range(-56, 60, 14):
    if abs(x - GX) > 31:  # not on the flyover's ramps
        P("lamp", x, 0.6, 0.3, 0.3, 6)
for x in range(-54, 60, 18):
    P("pole", x, -10.8, 0.3, 0.3, 7.5, line="akobo-n")

# General Gas junction: the cross road, zebra crossings, and the flyover carrying the main road over it
P("road", GX, -35, 8, 50, 0.02, dir="z", name="Ajamgboju Street")
P("road", GX, 35, 8, 50, 0.02, dir="z", name="General Gas–Iyana Church Road")
for z in (-12.5, 12.5):
    P("zebra", GX, z, 8, 3, 0.03)
P("flyover", GX, 0, 36, 7, 6.2, dir="x", text="GENERAL GAS FLYOVER")
for x in (GX - 14, GX - 8, GX + 8, GX + 14):
    P("pillar", x, 0, 1.2, 1.2, 6.2, color="#cfc8ba")
P("ramp", GX - 24, 0, 12, 7, 6.2, dir="x", up="e")
P("ramp", GX + 24, 0, 12, 7, 6.2, dir="x", up="w")
P("sign", GX + 6, -11, 4.6, 0.3, 3.2, text="GENERAL GAS")
P("sign", GX - 6, 11, 4.6, 0.3, 3.2, text="GENERAL GAS")
# keke and okada rank at the junction
P("sign", GX + 9, -14.5, 3.4, 0.3, 2.6, text="KEKE PARK")
for i in range(3):
    P("keke", GX + 7 + i * 2.2, -17.5, 1.3, 2.6, 1.7)
for i in range(3):
    P("okada", GX - 8 - i * 1.4, -14.5, 0.7, 1.9, 1.1, color=["#d94f3d", "#1d1a16", "#2f6db5"][i])


# ------------------------------------------------------------------ compounds: walled, gated, red earth
def compound(x, z, w, d, gate, house, color, name=None):
    """A walled compound with a gate in one wall, a house facing the gate, a water tank and a generator."""
    t, gw = 0.35, 3.4
    sides = {
        "n": (x, z - d / 2, w, t),
        "s": (x, z + d / 2, w, t),
        "w": (x - w / 2, z, t, d),
        "e": (x + w / 2, z, t, d),
    }
    wall_c = rng.choice(["#d9c6a5", "#cbb48f", "#e3d6bd", "#c9a27a"])
    for side, (cx, cz, sw, sd) in sides.items():
        if side != gate:
            P("wall", cx, cz, sw, sd, 2.3, color=wall_c)
            continue
        along_x = sw > sd
        L = sw if along_x else sd
        seg = (L - gw) / 2
        for k in (-1, 1):
            off = k * (gw / 2 + seg / 2)
            ww, wd = (seg, t) if along_x else (t, seg)
            P("wall", cx + (off if along_x else 0), cz + (0 if along_x else off), ww, wd, 2.3, color=wall_c)
            P("gate_post", cx + (k * gw / 2 if along_x else 0), cz + (0 if along_x else k * gw / 2), 0.5, 0.5, 2.6)
    # the house sits at the back; a front yard by the gate holds the tank and the generator,
    # and narrow alleys down the sides (good hiding spots)
    inward = {"n": 1, "s": -1, "w": 1, "e": -1}[gate]  # from the gate wall into the compound
    along_x = gate in ("n", "s")
    yard = 4.2
    if along_x:
        hw, hd = w - 3, d - yard - 1.2
        hx, hz = x, z + inward * (yard - 0.6) / 2
        front = z - inward * (d / 2 - 1.3)
        corners = [(x - w / 2 + 1.1, front), (x + w / 2 - 1.1, front)]
    else:
        hw, hd = w - yard - 1.2, d - 3
        hx, hz = x + inward * (yard - 0.6) / 2, z
        front = x - inward * (w / 2 - 1.3)
        corners = [(front, z - d / 2 + 1.1), (front, z + d / 2 - 1.1)]
    extra = {"text": name} if name else {}
    h = 3.4 if house == "house" else 6.4
    P(house, hx, hz, round(hw, 1), round(hd, 1), h, color=color, face=gate, **extra)
    rng.shuffle(corners)
    P("tank", *corners[0], 1.4, 1.4, 3.6, color=rng.choice(["#1d1a16", "#2f6db5"]))
    if rng.random() < 0.6:
        P("generator", *corners[1], 1.1, 0.8, 0.9)
    else:
        P("palm", *corners[1], 1.6, 1.6, 7)


def street(x0, z0, x1, z1, name=None):
    """Untarred laterite side street (with open gutters drawn by the renderer)."""
    along_x = abs(x1 - x0) > abs(z1 - z0)
    P(
        "laterite",
        (x0 + x1) / 2,
        (z0 + z1) / 2,
        abs(x1 - x0) if along_x else 6,
        6 if along_x else abs(z1 - z0),
        0.02,
        dir="x" if along_x else "z",
        **({"name": name} if name else {}),
    )


HOUSE_COLORS = ["#f2d7a0", "#f4b183", "#cfe8b8", "#f7e08a", "#e9c9a3", "#f3c6c6", "#efe6d2", "#d7c6f0"]

# SW: Basorun Estate (quiet, bigger duplexes)
street(-B, 27, -34, 27, "Basorun Estate Road")
street(-26, 27, 0, 27)
street(-12, 12, -12, B)
for i, x in enumerate((-51, -41)):
    compound(x, 18.5, 9, 11, "s", "duplex", HOUSE_COLORS[i])
    compound(x, 39, 9, 14, "n", "duplex", HOUSE_COLORS[i + 2])
compound(-20.5, 18.5, 9, 11, "s", "duplex", HOUSE_COLORS[4])
compound(-4.5, 19, 8, 12, "s", "house", HOUSE_COLORS[5])
compound(-4.5, 40, 8, 14, "n", "house", HOUSE_COLORS[6])
# a church hall (safe house) and a church
P("church", -20.5, 46, 10, 9, 6.5, color="#efe9dc", text="GRACE ASSEMBLY", face="n")
P("room", -50, 54.5, 8, 8, 3, door="n", color="#c9a27a", id="church_hall")

# SE: Akobo Estate (bungalows on a laterite grid; police station and school on the main road)
P("shop", 8, 17, 10, 6, 4.2, face="n", text="AKOBO POLICE STATION", color="#22313f")
P("venue", 28, 17, 16, 7, 6, color="#e8d9b0", text="AKOBO ESTATE HIGH SCHOOL", face="n")
street(0, 27, B, 27, "Akobo Estate Road")
street(20, 27, 20, B, "Omolayo Avenue")
street(42, 27, 42, B)
for x in (8, 31, 52):
    compound(x, 37.5, 9, 13, "n", "house", rng.choice(HOUSE_COLORS))
for x in (8, 31):
    compound(x, 52, 9, 12, "s", "house", rng.choice(HOUSE_COLORS))
P("mosque", 52, 53, 9, 9, 4.5, color="#e7efe4", text="AKOBO CENTRAL MOSQUE", face="n")
P("room", 52, 21, 8, 8, 3, door="n", color="#d9c6a5", id="estate_gatehouse")

# NE: Akobo Ojurin market (stalls, kiosks, mama-put, POS umbrellas)
P("billboard", 6, -14.5, 8, 0.4, 7, text="AKOBO OJURIN MARKET")
goods = ["AMALA", "PEPPER", "TOMATO", "PROVISIONS", "BOLE", "PURE WATER", "YAM", "FISH"]
colors = ["#d94f3d", "#2f9e57", "#f2b705", "#2f6db5", "#e67e22", "#8e44ad"]
k = 0
for row_z in (-22, -30, -38):
    for x in range(10, 50, 6):
        if (x, row_z) in ((22, -30), (28, -30)):
            continue  # an open square in the middle of the market
        P("stall", x, row_z, 3, 2, 2.5, color=colors[k % len(colors)], text=goods[k % len(goods)])
        k += 1
for z, c, text in ((-18, "#16a085", "POS"), (-26, "#d94f3d", "RECHARGE CARD"), (-34, "#f2b705", "BARBING SALON")):
    P("kiosk", 52, z, 2.6, 2.6, 2.7, color=c, text=text)
for x, z in ((14, -46), (22, -46), (30, -46)):
    P("umbrella", x, z, 1.4, 1.4, 2.3, color=rng.choice(["#2f6db5", "#d94f3d", "#f2b705"]), text="POS")
P("canopy", 42, -48, 10, 5, 2.6)  # the mama-put shed
for x in (38.5, 42, 45.5):
    P("bench", x, -48, 2, 0.6, 0.5)
P("room", 52, -52, 8, 8, 3, door="s", color="#b9875a", id="mama_put")
P("danfo", 4, -24, 2.2, 5.2, 2.4)
P("tyres", 4, -34, 1.6, 1.6, 0.9)

# NW: General Gas side (supermarket, filling station, hotel, church, a few compounds)
P("shop", -50, -16, 12, 7, 4.6, face="s", text="AKOBO MEGA MART", color="#2f6db5")
P("canopy", -8, -20, 12, 8, 4.6)  # filling station forecourt
for x in (-11, -5):
    P("pump", x, -20, 0.8, 1.2, 1.7)
P("shop", -8, -27.5, 9, 5, 3.8, face="s", text="FILLING STATION", color="#d94f3d")
P("flat", -50, -32, 12, 10, 9.5, color="#efe6d2", text="ODOGBO SUITES HOTEL", face="s")
P("church", -12, -45, 12, 9, 6.5, color="#f4efe4", text="LIVING HOPE CHAPEL", face="s")
compound(-50, -50, 10, 12, "s", "house", HOUSE_COLORS[1])
compound(-39, -50, 9, 12, "s", "house", HOUSE_COLORS[3])

# east end: the gate to Odogbo Barracks
P("wall", B - 1, -26, 0.5, 30, 3, color="#7a8b5a")
P("gate_post", B - 1, -10.8, 0.8, 0.8, 3.4)
P("sign", B - 4, -13.5, 6, 0.3, 3.4, text="ODOGBO BARRACKS")
P("hedge", B - 6, -40, 1, 14, 1.2)

# a few trees and parked cars along the side streets
for x, z in ((-38, 29.2), (-2, 29.2), (14, 29.2), (36, 29.2), (-24, -40), (34, -54), (-56, 29.2)):
    P(rng.choice(["tree", "palm", "big_tree"]), x, z, 2.4, 2.4, 7.5)
for x, z, c in ((-44, 25.4, "#22313f"), (26, 25.4, "#f3efe6"), (36, 25.4, "#a23b3b")):
    P("car", x, z, 4.2, 2, 1.5, color=c)
# the arena's bus stop (where the bus drops you and takes you home)
P("bus_shelter", 8, 10.2, 6, 1.6, 2.8, text="AKOBO BUS STOP")
# perimeter: the district carries on, but the play area ends here
for side in (-1, 1):
    P("fence", 0, side * (B + 0.6), 2 * B + 2, 0.3, 2.2, color="#a0663f")
    P("fence", side * (B + 0.6), 0, 0.3, 2 * B + 2, 2.2, color="#a0663f")

data = {
    "id": "arena_akobo",
    "name": "Akobo",
    "kind": "arena",
    "city": "ibadan",
    "venue": {"name": "Akobo, Ibadan", "lat": 7.437, "lng": 3.955},
    "bounds": [-B, -B, B, B],
    "ground": "#a8613a",
    "spawn": [16, 9.4],
    "arrival": [16, 9.4],
    "found_area": [25, -30],
    "props": props,
    "sections": [
        {"id": "road", "name": ROAD, "rect": [-B, -12, B, 12]},
        {"id": "general_gas", "name": "General Gas", "rect": [-B, -B, 0, -12]},
        {"id": "market", "name": "Akobo Ojurin Market", "rect": [0, -B, B, -12]},
        {"id": "basorun", "name": "Basorun Estate", "rect": [-B, 12, 0, B]},
        {"id": "estate", "name": "Akobo Estate", "rect": [0, 12, B, B]},
    ],
    "safe_houses": [
        {"id": "mama_put", "name": "Mama Put Shed", "rect": [48.4, -55.6, 55.6, -48.4]},
        {"id": "estate_gatehouse", "name": "Estate Gatehouse", "rect": [48.4, 17.4, 55.6, 24.6]},
        {"id": "church_hall", "name": "Church Hall", "rect": [-53.6, 50.9, -46.4, 58.1]},
    ],
    "zones": [{"id": "bus_stop", "kind": "bus_stop", "name": "Akobo Bus Stop", "rect": [4, 10.4, 12, 13.6]}],
}

OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False), "utf-8")
print(f"wrote {OUT.name} with {len(props)} props")
