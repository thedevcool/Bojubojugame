"""Builds Ibadan places from OpenStreetMap and real terrain: Iwo Road, Gate, Bashorun, Oke Mapo, Airport Road.

Run (from backend/, in its environment):
    pip install pyarrow pillow && python tools/build_ibadan_osm.py   — then commit the JSON.

For each place it:
1. fetches the OpenStreetMap buildings, roads and points of interest around the place from Overpass
   (overpass-api.de). If Overpass can't be reached, it reads the same OSM data from the Humanitarian
   OpenStreetMap Team's Nigeria export (GeoParquet on S3, refreshed from OSM), only the parts round Ibadan;
2. turns the map so the main road runs along an axis, then snaps every footprint into the modular kit
   (axis-aligned houses, flats, shops, churches and mosques; roads keep their real angle);
3. adds what makes it a Boju Boju arena: hiding props in yards and by the road (tanks, generators, parked
   cars, kiosks, stalls, trees), three safe houses, a bus stop by the main road, the gather circle (spawn)
   in the most open spot, the "found" area and a perimeter fence;
4. samples the real ground height around the place from terrain tiles (Terrarium PNGs, AWS open data),
   for the hills you see beyond the fence. The play area itself stays level, so movement, tagging and
   sight lines are exactly as in every other place.

Raw downloads are cached in tools/.osm_cache (not committed). Data © OpenStreetMap contributors (ODbL).
Businesses get generic labels (PHARMACY, POS…), never their real names or logos.
"""

from __future__ import annotations

import io
import json
import math
import random
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))  # the game's own collision and nav grid, for the walkability check

from app.content import _collider  # noqa: E402
from app.engine.geometry import Box  # noqa: E402
from app.engine.nav import NavGrid  # noqa: E402

MAPS = HERE.parent / "app/content/maps"
CACHE = HERE / ".osm_cache"
B = 60.0  # half-size of the play area (m)
PAD = 70.0  # extra data fetched round the play area (for roads crossing the edge)
TERRAIN_R = 320.0  # terrain sampled this far out from the centre (m)
TERRAIN_N = 33  # grid points per side
UA = "BojuBoju-mapbuilder/1.0 (game map builder)"

PLACES: list[dict[str, Any]] = [
    {
        "id": "arena_iwo_road",
        "name": "Iwo Road",
        "lat": 7.40391,
        "lng": 3.93350,
        "main": "Iwo Road",
        "blurb": "Iwo Road, Ibadan",
        "sign": "IWO ROAD",
        "safe": ["Mama Put Shed", "Vulcanizer's Shed", "Old Kiosk"],
        "ground": "#a8613a",
    },
    {
        "id": "arena_gate",
        "name": "Gate",
        "lat": 7.39718,
        "lng": 3.92073,
        "main": "Old Ife Road",
        "blurb": "Gate, Ibadan",
        "sign": "GATE",
        "safe": ["Agodi Gate Shed", "Mai Shayi Hut", "Tailor's Shop"],
        "ground": "#a8613a",
    },
    {
        "id": "arena_bashorun",
        "name": "Bashorun",
        "lat": 7.41650,
        "lng": 3.93850,
        "main": None,
        "blurb": "Bashorun, Ibadan",
        "sign": "BASHORUN",
        "safe": ["Corner Shop", "Barber's Shed", "Compound Gatehouse"],
        "ground": "#a8613a",
    },
    {
        "id": "arena_oke_mapo",
        "name": "Oke Mapo",
        "lat": 7.37609,
        "lng": 3.89655,
        "main": None,
        "blurb": "Oke Mapo, Ibadan",
        "sign": "MAPO",
        "landmarks": {"Mapo Hall": "MAPO HALL"},  # public landmarks keep their names
        "safe": ["Market Shed", "Elder's Parlour", "Hall Gatehouse"],
        "ground": "#a8613a",
    },
    {
        "id": "arena_airport_road",
        "name": "Airport Road",
        "lat": 7.38868,
        "lng": 3.97055,
        "main": "Airport road",
        "blurb": "Airport Road, Ibadan",
        "sign": "AIRPORT ROAD",
        "safe": ["Bus Shed", "Recharge Card Kiosk", "Mechanic's Shed"],
        "ground": "#a8613a",
    },
]

# ---------------------------------------------------------------------------------------------- fetching


def _get(url: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: float = 120) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def bbox_of(place: dict[str, Any], r: float) -> tuple[float, float, float, float]:
    la, lo = place["lat"], place["lng"]
    dla = r / 110574
    dlo = r / (111320 * math.cos(math.radians(la)))
    return la - dla, lo - dlo, la + dla, lo + dlo


def from_overpass(place: dict[str, Any]) -> list[dict[str, Any]]:
    s, w, n, e = bbox_of(place, (B + PAD) * 1.5)
    bb = f"{s:.6f},{w:.6f},{n:.6f},{e:.6f}"
    q = (
        f"[out:json][timeout:90];(way[building]({bb});way[highway]({bb});"
        f"node[amenity]({bb});node[shop]({bb});node[natural=tree]({bb}););out geom tags;"
    )
    raw = json.loads(_get("https://overpass-api.de/api/interpreter", urllib.parse.urlencode({"data": q}).encode()))
    out = []
    for el in raw["elements"]:
        tags = el.get("tags", {})
        if el["type"] == "node":
            out.append({"tags": tags, "geom": ("Point", (el["lon"], el["lat"])), "id": f"node/{el['id']}"})
        elif el["type"] == "way" and el.get("geometry"):
            pts = [(g["lon"], g["lat"]) for g in el["geometry"]]
            closed = len(pts) > 3 and pts[0] == pts[-1]
            geom = ("Polygon", [pts]) if "building" in tags and closed else ("LineString", pts)
            out.append({"tags": tags, "geom": geom, "id": f"way/{el['id']}"})
    return out


class _RangeFile(io.RawIOBase):
    """A file over HTTP range requests, so pyarrow reads only the parts of a big Parquet file it needs."""

    def __init__(self, url: str) -> None:
        self.url, self.pos = url, 0
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            self.size = int(r.headers["Content-Length"])

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, off: int, whence: int = 0) -> int:
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n: int = -1) -> bytes:
        n = self.size - self.pos if n < 0 else min(n, self.size - self.pos)
        if n <= 0:
            return b""
        for attempt in range(4):
            try:
                data = _get(self.url, headers={"Range": f"bytes={self.pos}-{self.pos + n - 1}"})
                break
            except OSError:
                if attempt == 3:
                    raise
        self.pos += len(data)
        return data

    def readinto(self, b: Any) -> int:
        d = self.read(len(b))
        b[: len(d)] = d
        return len(d)


def _wkb(g: bytes) -> tuple[str, Any]:
    import struct

    pos = 0

    def rd() -> tuple[str, Any]:
        nonlocal pos
        bo = "<" if g[pos] == 1 else ">"
        t = struct.unpack(bo + "I", g[pos + 1 : pos + 5])[0] % 1000
        pos += 5

        def n() -> int:
            nonlocal pos
            v = struct.unpack(bo + "I", g[pos : pos + 4])[0]
            pos += 4
            return int(v)

        def pts(k: int) -> list[tuple[float, float]]:
            nonlocal pos
            v = struct.unpack(bo + "d" * 2 * k, g[pos : pos + 16 * k])
            pos += 16 * k
            return list(zip(v[0::2], v[1::2], strict=True))

        if t == 1:
            return ("Point", pts(1)[0])
        if t == 2:
            return ("LineString", pts(n()))
        if t == 3:
            return ("Polygon", [pts(n()) for _ in range(n())])
        if t in (4, 5, 6, 7):
            return ("Multi", [rd() for _ in range(n())])
        raise ValueError(f"WKB type {t}")

    return rd()


HOT = "https://production-raw-data-api.s3.amazonaws.com/ISO3/NGA/_layers/osm/{}.parquet"
_hot_cache: dict[str, list[dict[str, Any]]] = {}


def _hot_layer(layer: str, box: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    """One layer of HOT's OSM export, only the row groups (and rows) that touch ``box``."""
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    s, w, n, e = box
    f = pq.ParquetFile(_RangeFile(HOT.format(layer)))
    md = f.metadata
    cols = {md.row_group(0).column(i).path_in_schema: i for i in range(md.num_columns)}
    rows: list[dict[str, Any]] = []
    for g in range(md.num_row_groups):
        rg = md.row_group(g)

        def st(name: str, rg: Any = rg) -> Any:
            return rg.column(cols[name]).statistics

        if st("bbox.xmin").min > e or st("bbox.xmax").max < w or st("bbox.ymin").min > n or st("bbox.ymax").max < s:
            continue
        t = f.read_row_group(g)
        bb = t.column("bbox").combine_chunks()
        m = pc.and_(
            pc.and_(pc.less_equal(bb.field("xmin"), e), pc.greater_equal(bb.field("xmax"), w)),
            pc.and_(pc.less_equal(bb.field("ymin"), n), pc.greater_equal(bb.field("ymax"), s)),
        )
        for r in t.filter(m).to_pylist():
            geom = r.pop("geom")
            r.pop("bbox", None)
            tags = {k.replace("building_levels", "building:levels"): v for k, v in r.items() if v is not None}
            rows.append({"tags": tags, "geom": _wkb(geom), "id": r.get("id", "")})
        print(f"  HOT {layer}: row group {g}, {len(rows)} features so far", file=sys.stderr)
    return rows


def from_hot(place: dict[str, Any]) -> list[dict[str, Any]]:
    city = (7.30, 3.83, 7.50, 4.03)  # Ibadan: read once for every place
    path = CACHE / "hot_ibadan.json"
    if not _hot_cache:
        if path.exists():
            _hot_cache.update(json.loads(path.read_text("utf-8")))
        else:
            for layer in ("buildings", "roads", "points_of_interest"):
                _hot_cache[layer] = _hot_layer(layer, city)
            path.write_text(json.dumps(_hot_cache), "utf-8")
    s, w, n, e = bbox_of(place, (B + PAD) * 1.5)

    def inside(f: dict[str, Any]) -> bool:
        def pts(g: Any) -> list[Any]:
            t, c = g
            if t == "Point":
                return [c]
            if t == "LineString":
                return list(c)
            if t == "Polygon":
                return list(c[0])
            return [p for part in c for p in pts(part)]

        return any(s <= y <= n and w <= x <= e for x, y in pts(f["geom"]))

    out = []
    for layer in ("buildings", "roads", "points_of_interest"):
        for f in _hot_cache[layer]:
            if inside(f):
                geom = f["geom"]
                if geom[0] == "Multi":  # buildings: keep each part; roads: each line
                    for part in geom[1]:
                        out.append({**f, "geom": tuple(part)})
                else:
                    out.append({**f, "geom": tuple(geom)})
    return out


def fetch(place: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"{place['id']}.json"
    if path.exists():
        d = json.loads(path.read_text("utf-8"))
        return d["features"], d["source"]
    try:
        feats, source = from_overpass(place), "OpenStreetMap via Overpass API"
    except OSError as err:
        print(f"  Overpass unreachable ({err}); using HOT's OpenStreetMap export", file=sys.stderr)
        feats, source = from_hot(place), "OpenStreetMap via HOT export (production-raw-data-api)"
    path.write_text(json.dumps({"features": feats, "source": source}), "utf-8")
    return feats, source


# ---------------------------------------------------------------------------------------------- terrain


def terrain(place: dict[str, Any], rot: float) -> dict[str, Any]:
    """Ground heights (m, relative to the centre) on a grid round the place, from Terrarium tiles."""
    from PIL import Image

    z = 15
    la0, lo0 = place["lat"], place["lng"]
    tiles: dict[tuple[int, int], Any] = {}

    def tile_xy(la: float, lo: float) -> tuple[float, float]:
        n = 2**z
        x = (lo + 180) / 360 * n
        y = (1 - math.asinh(math.tan(math.radians(la))) / math.pi) / 2 * n
        return x * 256, y * 256

    def elev_px(px: float, py: float) -> float:
        tx, ty = int(px // 256), int(py // 256)
        if (tx, ty) not in tiles:
            p = CACHE / f"terrarium_{z}_{tx}_{ty}.png"
            if not p.exists():
                p.write_bytes(_get(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png"))
            tiles[(tx, ty)] = Image.open(p).convert("RGB").load()
        r, g, b = tiles[(tx, ty)][int(px) % 256, int(py) % 256]
        return r * 256 + g + b / 256 - 32768

    def elev(la: float, lo: float) -> float:  # bilinear between pixels
        px, py = tile_xy(la, lo)
        x0, y0 = math.floor(px - 0.5), math.floor(py - 0.5)
        fx, fy = px - 0.5 - x0, py - 0.5 - y0
        a, b2 = elev_px(x0, y0), elev_px(x0 + 1, y0)
        c, d = elev_px(x0, y0 + 1), elev_px(x0 + 1, y0 + 1)
        return (a * (1 - fx) + b2 * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

    kx, ky = 111320 * math.cos(math.radians(la0)), 110574.0
    cos, sin = math.cos(rot), math.sin(rot)
    grid = []
    for j in range(TERRAIN_N):
        for i in range(TERRAIN_N):
            gx = -TERRAIN_R + 2 * TERRAIN_R * i / (TERRAIN_N - 1)
            gz = -TERRAIN_R + 2 * TERRAIN_R * j / (TERRAIN_N - 1)
            # game (x east, z south) turned back by ``rot`` -> east/north metres -> lat/lng
            ex, sz = gx * cos + gz * sin, -gx * sin + gz * cos
            grid.append(elev(la0 - sz / ky, lo0 + ex / kx))
    base = elev(la0, lo0)
    return {
        "r": TERRAIN_R,
        "n": TERRAIN_N,
        "base_m": round(base),
        "h": [round(v - base, 1) for v in grid],
    }


# ---------------------------------------------------------------------------------------------- geometry


class Frame:
    """lat/lng <-> game metres (x east, z south), turned by ``rot`` so the main road runs along an axis."""

    def __init__(self, la: float, lo: float, rot: float = 0.0) -> None:
        self.la, self.lo, self.rot = la, lo, rot
        self.kx, self.ky = 111320 * math.cos(math.radians(la)), 110574.0

    def __call__(self, lo: float, la: float) -> tuple[float, float]:
        x, z = (lo - self.lo) * self.kx, -(la - self.la) * self.ky
        c, s = math.cos(self.rot), math.sin(self.rot)
        return x * c - z * s, x * s + z * c


def hull(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts

    def cross(o: Any, a: Any, b: Any) -> float:
        return float((a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]))

    lo: list[tuple[float, float]] = []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    up: list[tuple[float, float]] = []
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def min_rect(pts: list[tuple[float, float]]) -> tuple[float, float, float, float, float]:
    """Smallest rectangle round the points: (cx, cz, length, width, angle of its long side)."""
    h = hull(pts)
    best = None
    for i in range(len(h)):
        a, b = h[i], h[(i + 1) % len(h)]
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        c, s = math.cos(ang), math.sin(ang)
        us = [p[0] * c + p[1] * s for p in h]
        vs = [-p[0] * s + p[1] * c for p in h]
        area = (max(us) - min(us)) * (max(vs) - min(vs))
        if best is None or area < best[0]:
            mu, mv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            best = (area, mu * c - mv * s, mu * s + mv * c, max(us) - min(us), max(vs) - min(vs), ang)
    assert best is not None
    _, cx, cz, L, W, ang = best
    if W > L:
        L, W, ang = W, L, ang + math.pi / 2
    return cx, cz, L, W, ang


def wrap90(a: float) -> float:
    """Angle folded into (-45°, 45°]: how far a line is from the nearest axis."""
    a = math.fmod(a, math.pi / 2)
    if a > math.pi / 4:
        a -= math.pi / 2
    if a <= -math.pi / 4:
        a += math.pi / 2
    return a


def seg_rect_overlap(box: tuple[float, float, float, float], seg: dict[str, Any], pad: float = 0.0) -> bool:
    """Does an axis-aligned box overlap a road segment (a turned rectangle)? Separating axis test."""
    x0, z0, x1, z1 = box
    ax, az, bx, bz, w = seg["a"][0], seg["a"][1], seg["b"][0], seg["b"][1], seg["w"] / 2 + pad
    dx, dz = bx - ax, bz - az
    L = math.hypot(dx, dz) or 1e-6
    ux, uz = dx / L, dz / L
    vx, vz = -uz, ux
    corners = [(x0, z0), (x1, z0), (x0, z1), (x1, z1)]
    rc = [
        (ax + vx * w, az + vz * w),
        (ax - vx * w, az - vz * w),
        (bx + vx * w, bz + vz * w),
        (bx - vx * w, bz - vz * w),
    ]
    for nx, nz in ((1.0, 0.0), (0.0, 1.0), (ux, uz), (vx, vz)):
        p1 = [cx * nx + cz * nz for cx, cz in corners]
        p2 = [cx * nx + cz * nz for cx, cz in rc]
        if max(p1) <= min(p2) or max(p2) <= min(p1):
            return False
    return True


def clip_segment(a: Any, b: Any, lim: float) -> tuple[Any, Any] | None:
    """Liang–Barsky: the part of segment a-b inside the square [-lim, lim]²."""
    t0, t1 = 0.0, 1.0
    dx, dz = b[0] - a[0], b[1] - a[1]
    for p, q in ((-dx, a[0] + lim), (dx, lim - a[0]), (-dz, a[1] + lim), (dz, lim - a[1])):
        if p == 0:
            if q < 0:
                return None
            continue
        t = q / p
        if p < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    return (a[0] + t0 * dx, a[1] + t0 * dz), (a[0] + t1 * dx, a[1] + t1 * dz)


# ---------------------------------------------------------------------------------------------- the kit

ROAD_W = {
    "motorway": 8.0,
    "trunk": 8.0,
    "primary": 8.0,
    "secondary": 7.0,
    "tertiary": 6.5,
    "unclassified": 5.5,
    "residential": 5.0,
    "living_street": 4.5,
    "service": 3.6,
    "track": 3.2,
}
ROAD_RANK = [
    "track",
    "service",
    "living_street",
    "residential",
    "unclassified",
    "tertiary",
    "secondary",
    "primary",
    "trunk",
    "motorway",
]
HOUSE_COLORS = ["#e7d1a1", "#d9c6a5", "#cfd8c4", "#e9dcc4", "#d7b98e", "#e3cfc0", "#c9d3d9", "#efe6d2"]
SHOP_COLORS = ["#d94f3d", "#2f9e57", "#2f6db5", "#e67e22", "#8e44ad", "#16a085"]
AMENITY_LABEL = {
    "pharmacy": "PHARMACY",
    "hospital": "CLINIC",
    "clinic": "CLINIC",
    "school": "SCHOOL",
    "bank": "BANK",
    "fuel": "FILLING STATION",
    "restaurant": "BUKA",
    "fast_food": "BUKA",
    "bar": "JOINT",
    "marketplace": "MARKET",
    "police": "POLICE",
    "post_office": "POST OFFICE",
    "cinema": "CINEMA",
    "place_of_worship": None,  # church or mosque, by religion
}
SHOP_WORDS = ["PROVISIONS", "POS", "RECHARGE CARD", "BARBING SALON", "TAILOR", "PHONE REPAIRS", "PURE WATER", "CHEMIST"]
SOLID_MIN_GAP = 0.9  # never leave a gap narrower than this between two buildings (players get stuck)


def build(place: dict[str, Any]) -> dict[str, Any]:
    rng = random.Random(place["id"])
    feats, source = fetch(place)
    print(f"{place['name']}: {len(feats)} OSM features ({source})", file=sys.stderr)

    # 1) turn the map so the main road (or the streets overall) run along an axis
    f0 = Frame(place["lat"], place["lng"])
    acc_c = acc_s = 0.0
    for f in feats:
        hw = f["tags"].get("highway")
        if f["geom"][0] != "LineString" or hw not in ROAD_W:
            continue
        main = place["main"] and (f["tags"].get("name") or "").lower() == place["main"].lower()
        wgt = 6.0 if main else ROAD_W[hw] ** 2 / 10
        pts = [f0(*p) for p in f["geom"][1]]
        for a, b in zip(pts, pts[1:], strict=False):
            mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            if abs(mx) > B * 1.4 or abs(mz) > B * 1.4:
                continue
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            ang = math.atan2(b[1] - a[1], b[0] - a[0]) * 4  # 4x: lines 90° apart vote the same way
            acc_c += wgt * L * math.cos(ang)
            acc_s += wgt * L * math.sin(ang)
    rot = -math.atan2(acc_s, acc_c) / 4
    fr = Frame(place["lat"], place["lng"], rot)

    # 2) roads: every segment inside the play area, at its real angle
    segs: list[dict[str, Any]] = []
    names: list[tuple[str, float, float, float]] = []  # (name, x, z, length) for district names
    for f in feats:
        hw = f["tags"].get("highway")
        if hw not in ROAD_W or f["geom"][0] not in ("LineString", "Polygon"):
            continue
        tags = f["tags"]
        w = ROAD_W[hw]
        if tags.get("oneway") == "yes" and hw in ("trunk", "primary", "secondary", "motorway"):
            w *= 0.8  # one side of a dual carriageway
        paved = tags.get("surface") in ("asphalt", "paved", "concrete") or (
            hw in ("trunk", "primary", "secondary", "tertiary", "motorway")
            and tags.get("surface") not in ("unpaved", "dirt", "ground", "gravel")
        )
        line = f["geom"][1][0] if f["geom"][0] == "Polygon" else f["geom"][1]  # a roundabout can come as a ring
        pts = [fr(*p) for p in line]
        for a, b in zip(pts, pts[1:], strict=False):
            c = clip_segment(a, b, B)
            if not c or math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) < 0.5:
                continue
            seg = {"a": c[0], "b": c[1], "w": w, "paved": paved, "hw": hw, "name": tags.get("name")}
            segs.append(seg)
            if seg["name"]:
                L = math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1])
                names.append((seg["name"], (c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2, L * w))

    props: list[dict[str, Any]] = []

    def P(kind: str, x: float, z: float, w: float, d: float, h: float, **kw: Any) -> dict[str, Any]:
        p = {"kind": kind, "x": round(x, 2), "z": round(z, 2), "w": round(w, 2), "d": round(d, 2), "h": h, **kw}
        props.append(p)
        return p

    # bigger roads drawn on top of smaller ones where they meet (h lifts the surface a few mm)
    for seg in sorted(segs, key=lambda s: ROAD_RANK.index(s["hw"])):
        (ax, az), (bx, bz) = seg["a"], seg["b"]
        L = math.hypot(bx - ax, bz - az) + seg["w"] * 0.5  # overlap at bends
        ang = math.atan2(bz - az, bx - ax)
        if ang > math.pi / 2:
            ang -= math.pi
        if ang <= -math.pi / 2:
            ang += math.pi
        rank = ROAD_RANK.index(seg["hw"])
        kw: dict[str, Any] = {"dir": "x"}
        if abs(ang) > 0.004:
            kw["ry"] = round(-ang, 4)
        if seg["name"]:
            kw["name"] = seg["name"]
        P(
            "road" if seg["paved"] else "laterite",
            (ax + bx) / 2,
            (az + bz) / 2,
            L,
            seg["w"],
            round(0.02 + rank * 0.003, 3),
            **kw,
        )

    # 3) buildings, snapped into the kit
    roads_of = segs
    boxes: list[dict[str, Any]] = []
    pois: list[tuple[dict[str, Any], float, float]] = []
    for f in feats:
        t = f["tags"]
        if f["geom"][0] == "Point":
            x, z = fr(*f["geom"][1])
            if abs(x) < B and abs(z) < B:
                pois.append((t, x, z))
            continue
        if f["geom"][0] != "Polygon" or "building" not in t or t.get("building") in ("construction", "roof", "ruins"):
            continue
        ring = [fr(*p) for p in f["geom"][1][0]]
        cx, cz, L, W, ang = min_rect(ring)
        if L < 2.5 or W < 2.0:
            continue
        res = wrap90(ang)
        along_x = abs(math.cos(ang - res)) > 0.5  # long side lies along x once turned straight
        w, d = (L, W) if along_x else (W, L)
        if abs(res) > math.radians(25):  # well off the grid: keep the area, square it up
            w = d = math.sqrt(L * W) * 0.95
        box = [cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2]
        # inside the play area (trim at the fence, with room to walk along it)
        lim = B - 1.6
        box = [max(box[0], -lim), max(box[1], -lim), min(box[2], lim), min(box[3], lim)]
        if box[2] - box[0] < 2.5 or box[3] - box[1] < 2.5:
            continue
        levels = t.get("building:levels")
        boxes.append(
            {"box": box, "tags": t, "levels": int(levels) if levels and levels.isdigit() else None, "id": f["id"]}
        )

    def overlaps_road(bx: list[float], pad: float = 0.6) -> bool:
        return any(seg_rect_overlap((bx[0], bx[1], bx[2], bx[3]), s, pad) for s in roads_of)

    # keep buildings off the roads: trim the side that pokes into the road, else drop the building
    kept: list[dict[str, Any]] = []
    stats = {"footprints": len(boxes), "on a road": 0, "overlapping": 0}
    for b in sorted(boxes, key=lambda b: -(b["box"][2] - b["box"][0]) * (b["box"][3] - b["box"][1])):
        bx = list(b["box"])
        for _ in range(12):
            if not overlaps_road(bx):
                break
            best = None
            for side in range(4):
                trial = list(bx)
                trial[side] += 0.5 if side < 2 else -0.5
                if trial[2] - trial[0] < 2.5 or trial[3] - trial[1] < 2.5:
                    continue
                score = sum(seg_rect_overlap(tuple(trial), s, 0.6) for s in roads_of)  # type: ignore[arg-type]
                if best is None or score < best[0]:
                    best = (score, trial)
            if best is None:
                break
            bx = best[1]
        if overlaps_road(bx):
            stats["on a road"] += 1
            continue
        # and off each other: trim, or close tiny gaps so nobody gets wedged in a slot
        ok = True
        for k in kept:
            o = k["box"]
            gx = max(o[0] - bx[2], bx[0] - o[2])
            gz = max(o[1] - bx[3], bx[1] - o[3])
            if gx < 0 and gz < 0:  # overlap: push the smaller one back along the shallower axis
                if -gx < -gz:
                    if bx[0] < o[0]:
                        bx[2] = o[0]
                    else:
                        bx[0] = o[2]
                else:
                    if bx[1] < o[1]:
                        bx[3] = o[1]
                    else:
                        bx[1] = o[3]
            elif 0 <= gx < SOLID_MIN_GAP and gz < 0:  # a slot too narrow to walk through: shut it
                if bx[0] >= o[2]:
                    bx[0] = o[2]
                else:
                    bx[2] = o[0]
            elif 0 <= gz < SOLID_MIN_GAP and gx < 0:
                if bx[1] >= o[3]:
                    bx[1] = o[3]
                else:
                    bx[3] = o[1]
            if bx[2] - bx[0] < 2.5 or bx[3] - bx[1] < 2.5:
                ok = False
                break
        if ok:
            kept.append({**b, "box": bx})
        else:
            stats["overlapping"] += 1

    print(f"  buildings: {stats}, kept {len(kept)}", file=sys.stderr)

    def nearest_road(x: float, z: float) -> tuple[float, dict[str, Any] | None, tuple[float, float]]:
        best: tuple[float, dict[str, Any] | None, tuple[float, float]] = (1e9, None, (0.0, 0.0))
        for s in roads_of:
            (ax, az), (bx, bz) = s["a"], s["b"]
            dx, dz = bx - ax, bz - az
            t = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz or 1e-9)))
            px, pz = ax + t * dx, az + t * dz
            d = math.hypot(x - px, z - pz) - s["w"] / 2
            if d < best[0]:
                best = (d, s, (px, pz))
        return best

    # name the buildings that points of interest sit in
    labels: dict[int, tuple[str, str]] = {}
    for t, x, z in pois:
        am = t.get("amenity") or ("shop" if t.get("shop") else None)
        if am is None:
            continue
        for i, k in enumerate(kept):
            bx = k["box"]
            if bx[0] - 3 <= x <= bx[2] + 3 and bx[1] - 3 <= z <= bx[3] + 3:
                if am == "place_of_worship":
                    rel = t.get("religion")
                    labels[i] = ("mosque", "MOSQUE") if rel == "muslim" else ("church", "CHURCH")
                elif am == "shop":
                    labels[i] = ("shop", rng.choice(SHOP_WORDS))
                elif am in AMENITY_LABEL and AMENITY_LABEL[am]:
                    labels[i] = (
                        "shop"
                        if am not in ("school", "hospital", "clinic", "police", "post_office", "cinema")
                        else "flat",
                        AMENITY_LABEL[am],
                    )
                break

    for i, k in enumerate(kept):
        bx = k["box"]
        x, z, w, d = (bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2, bx[2] - bx[0], bx[3] - bx[1]
        t = k["tags"]
        area = w * d
        dist, seg, at = nearest_road(x, z)
        # face the nearest road
        fx, fz = at[0] - x, at[1] - z
        face = ("e" if fx > 0 else "w") if abs(fx) > abs(fz) else ("s" if fz > 0 else "n")
        kind, text = labels.get(i, (None, None))
        bt = t.get("building")
        landmark = place.get("landmarks", {}).get(t.get("name") or "")
        if landmark:
            kind, text = "flat", landmark
        if kind is None:
            if bt in ("church", "chapel", "cathedral"):
                kind, text = "church", "CHURCH"
            elif bt == "mosque":
                kind, text = "mosque", "MOSQUE"
            elif bt in ("retail", "commercial", "kiosk") or (
                dist < 4
                and area < 70
                and seg
                and seg["hw"] in ("trunk", "primary", "secondary", "tertiary")
                and rng.random() < 0.6
            ):
                kind, text = "shop", rng.choice(SHOP_WORDS)
            elif (k["levels"] or 0) >= 3 or area > 380:
                kind = "flat"
            elif (k["levels"] or 0) == 2 or (area > 170 and rng.random() < 0.35):
                kind = "duplex"
            else:
                kind = "house"
        floors = k["levels"] or {"flat": 3, "duplex": 2}.get(kind, 1)
        h = {
            "house": 3.2,
            "duplex": 6.4,
            "flat": min(3.1 * max(floors, 3) + 0.2, 13.0),
            "shop": 3.8,
            "church": 6.5,
            "mosque": 4.5,
        }[kind]
        kw: dict[str, Any] = {"color": rng.choice(HOUSE_COLORS)}
        if kind == "shop":
            kw["color"] = rng.choice(SHOP_COLORS)
        if kind in ("church", "mosque"):
            kw["color"] = "#f4efe4" if kind == "church" else "#e7efe4"
        if kind in ("house", "flat", "duplex", "shop", "mosque") and face != "s":
            kw["face"] = face
        if kind == "church" and face != "s":
            # the church kit always faces south; keep its footprint and let the door be where it is
            pass
        if text:
            kw["text"] = text
        P(kind, x, z, round(w, 2), round(d, 2), h, osm=k["id"], **kw)

    solids = [
        (p["x"] - p["w"] / 2, p["z"] - p["d"] / 2, p["x"] + p["w"] / 2, p["z"] + p["d"] / 2)
        for p in props
        if p["kind"] not in ("road", "laterite")
    ]

    # 4) an occupancy grid (1 m): solid, road or free
    N = int(2 * B)

    def cell(x: float, z: float) -> tuple[int, int]:
        return int(math.floor(x + B)), int(math.floor(z + B))

    occ = [[0] * N for _ in range(N)]  # 0 free, 1 road, 2 solid

    def mark_box(b: tuple[float, float, float, float], v: int) -> None:
        i0, j0 = cell(b[0], b[1])
        i1, j1 = cell(b[2] - 1e-6, b[3] - 1e-6)
        for i in range(max(0, i0), min(N, i1 + 1)):
            for j in range(max(0, j0), min(N, j1 + 1)):
                occ[j][i] = max(occ[j][i], v)

    for i in range(N):
        for j in range(N):
            x, z = i - B + 0.5, j - B + 0.5
            if any(seg_rect_overlap((x - 0.5, z - 0.5, x + 0.5, z + 0.5), s, 0.3) for s in roads_of):
                occ[j][i] = 1
    for b in solids:
        mark_box(b, 2)
    # the fence and a walkway inside it
    for k in range(N):
        for e in (0, N - 1):
            occ[e][k] = max(occ[e][k], 2)
            occ[k][e] = max(occ[k][e], 2)

    def clearance(solid_only: bool) -> list[list[float]]:
        """Distance (m) from each cell to the nearest blocked cell (two-pass chamfer)."""
        INF = 1e9
        blocked = (lambda v: v == 2) if solid_only else (lambda v: v >= 1)
        dist = [[0.0 if blocked(occ[j][i]) else INF for i in range(N)] for j in range(N)]
        for j in range(N):
            for i in range(N):
                v = dist[j][i]
                if i > 0:
                    v = min(v, dist[j][i - 1] + 1)
                if j > 0:
                    v = min(v, dist[j - 1][i] + 1)
                    if i > 0:
                        v = min(v, dist[j - 1][i - 1] + 1.414)
                    if i < N - 1:
                        v = min(v, dist[j - 1][i + 1] + 1.414)
                dist[j][i] = v
        for j in range(N - 1, -1, -1):
            for i in range(N - 1, -1, -1):
                v = dist[j][i]
                if i < N - 1:
                    v = min(v, dist[j][i + 1] + 1)
                if j < N - 1:
                    v = min(v, dist[j + 1][i] + 1)
                    if i < N - 1:
                        v = min(v, dist[j + 1][i + 1] + 1.414)
                    if i > 0:
                        v = min(v, dist[j + 1][i - 1] + 1.414)
                dist[j][i] = v
        return dist

    # 5) the bus stop: beside the busiest road, near the middle
    main_segs = sorted(
        roads_of, key=lambda s: (-ROAD_RANK.index(s["hw"]), -math.hypot(s["b"][0] - s["a"][0], s["b"][1] - s["a"][1]))
    )
    stop: tuple[float, float, float, float] | None = None
    shelter: dict[str, Any] | None = None
    for s in main_segs[:12]:
        (ax, az), (bx_, bz_) = s["a"], s["b"]
        dx, dz = bx_ - ax, bz_ - az
        L = math.hypot(dx, dz)
        if L < 10:
            continue
        ux, uz = dx / L, dz / L
        horizontal = abs(ux) >= abs(uz)
        for t in sorted((0.5, 0.35, 0.65, 0.2, 0.8), key=lambda t: abs((ax + t * dx) ** 2 + (az + t * dz) ** 2)):
            px, pz = ax + t * dx, az + t * dz
            for side in (1, -1):
                nx, nz = -uz * side, ux * side
                off = s["w"] / 2 + 1.9
                cx, cz = px + nx * off, pz + nz * off
                zr = (cx - 4, cz - 1.6, cx + 4, cz + 1.6) if horizontal else (cx - 1.6, cz - 4, cx + 1.6, cz + 4)
                if max(abs(zr[0]), abs(zr[2]), abs(zr[1]), abs(zr[3])) > B - 2:
                    continue
                if any(seg_rect_overlap(zr, r, 0.0) for r in roads_of):
                    continue
                stop = zr
                shelter = {"x": cx + nx * 0.6, "z": cz + nz * 0.6, "horizontal": horizontal}
                break
            if stop:
                break
        if stop:
            break
    if stop is None:  # no road in a good spot: by the south fence
        stop = (-4.0, B - 6.0, 4.0, B - 2.8)
        shelter = {"x": 0.0, "z": B - 4.0, "horizontal": True}
    assert shelter is not None
    # clear the stop (and room to stand round it) of buildings
    pad_stop = (stop[0] - 1.2, stop[1] - 1.2, stop[2] + 1.2, stop[3] + 1.2)

    def drop_solids_in(r: tuple[float, float, float, float]) -> None:
        keep = []
        for p in props:
            if p["kind"] in ("road", "laterite"):
                keep.append(p)
                continue
            if (
                p["x"] + p["w"] / 2 > r[0]
                and p["x"] - p["w"] / 2 < r[2]
                and p["z"] + p["d"] / 2 > r[1]
                and p["z"] - p["d"] / 2 < r[3]
            ):
                continue
            keep.append(p)
        props[:] = keep

    drop_solids_in(pad_stop)
    if shelter["horizontal"]:
        P("bus_shelter", shelter["x"], shelter["z"], 6, 1.6, 2.8, text=f"{place['sign']} BUS STOP")
    else:
        P("bus_shelter", shelter["x"], shelter["z"], 1.6, 6, 2.8, text=f"{place['sign']} BUS STOP")

    # 6) safe houses: three 8 x 8 sheds, spread out, off the roads (clearing a plot if the area is packed)
    def rebuild_occ() -> None:
        for j in range(N):
            for i in range(N):
                if occ[j][i] == 2:
                    occ[j][i] = 0
        for k in range(N):
            for e in (0, N - 1):
                occ[e][k] = 2
                occ[k][e] = 2
        for p in props:
            if p["kind"] in ("road", "laterite", "bus_shelter"):
                continue
            mark_box((p["x"] - p["w"] / 2, p["z"] - p["d"] / 2, p["x"] + p["w"] / 2, p["z"] + p["d"] / 2), 2)

    rebuild_occ()
    safe_houses = []
    sx, sz = (stop[0] + stop[2]) / 2, (stop[1] + stop[3]) / 2
    taken: list[tuple[float, float]] = [(sx, sz)]
    quads = [(-1, -1), (1, -1), (-1, 1), (1, 1)]
    rng.shuffle(quads)
    for qx, qz in quads:
        if len(safe_houses) == 3:
            break
        best = None
        for gx in range(8, int(B) - 6, 3):
            for gz in range(8, int(B) - 6, 3):
                x, z = qx * gx, qz * gz
                r = (x - 5, z - 5, x + 5, z + 5)
                if any(seg_rect_overlap(r, s, 0.4) for s in roads_of):
                    continue
                if min(math.hypot(x - a, z - b) for a, b in taken) < 30:
                    continue
                cost = 0.0
                for p in props:
                    if p["kind"] in ("road", "laterite"):
                        continue
                    ox = min(p["x"] + p["w"] / 2, r[2]) - max(p["x"] - p["w"] / 2, r[0])
                    oz = min(p["z"] + p["d"] / 2, r[3]) - max(p["z"] - p["d"] / 2, r[1])
                    if ox > 0 and oz > 0:
                        cost += p["w"] * p["d"]  # the whole building goes
                # stay near a road (a shed people can find), but not on it
                dist, _, _ = nearest_road(x, z)
                cost += max(0.0, dist - 8) * 6
                if best is None or cost < best[0]:
                    best = (cost, x, z)
        if best is None:
            continue
        _, x, z = best
        drop_solids_in((x - 5, z - 5, x + 5, z + 5))
        # the door faces the nearest road
        _, _, at = nearest_road(x, z)
        fx, fz = at[0] - x, at[1] - z
        door = ("e" if fx > 0 else "w") if abs(fx) > abs(fz) else ("s" if fz > 0 else "n")
        name = place["safe"][len(safe_houses)]
        sid = name.lower().replace("'", "").replace(" ", "_")
        P("room", x, z, 8, 8, 3, door=door, color=rng.choice(["#d9c6a5", "#b9875a", "#cbb48f"]), id=sid)
        safe_houses.append(
            {
                "id": sid,
                "name": name,
                "rect": [round(x - 3.6, 2), round(z - 3.6, 2), round(x + 3.6, 2), round(z + 3.6, 2)],
            }
        )
        taken.append((x, z))
    assert len(safe_houses) == 3, place["id"]

    # 7) the gather circle (spawn): the most open spot near the middle, roads count as open
    rebuild_occ()
    for p in props:  # keep the bus stop free too
        if p["kind"] == "bus_shelter":
            mark_box((p["x"] - p["w"] / 2, p["z"] - p["d"] / 2, p["x"] + p["w"] / 2, p["z"] + p["d"] / 2), 2)
    open_ = clearance(solid_only=True)
    cands = []
    for j in range(N):
        for i in range(N):
            x, z = i - B + 0.5, j - B + 0.5
            c = open_[j][i]
            if c >= 6.5:
                cands.append((math.hypot(x - sx, z - sz) * 0.6 + math.hypot(x, z) * 0.4 - c * 2, x, z, c))
    if not cands:  # packed area: clear a square in the middle
        drop_solids_in((-7.0, -7.0, 7.0, 7.0))
        rebuild_occ()
        open_ = clearance(solid_only=True)
        cands = [(0.0, 0.5, 0.5, 7.0)]
    cands.sort()
    _, gx, gz, _ = cands[0]
    spawn = [round(gx, 1), round(gz, 1)]
    # found area: a clear strip (up to 6 caught players stand in a row), away from the circle
    found = None
    for j in range(N):
        for i in range(N):
            x, z = i - B + 0.5, j - B + 0.5
            if open_[j][i] >= 5.2 and math.hypot(x - gx, z - gz) > 22:
                ok = all(open_[j][min(N - 1, max(0, i + k))] >= 2.0 for k in range(-5, 6))
                if ok:
                    score = math.hypot(x - gx, z - gz) * 0.2 + math.hypot(x, z) * 0.1 - open_[j][i]
                    if found is None or score < found[0]:
                        found = (score, x, z)
    if found is None:
        found = (0, gx + (8 if gx < 0 else -8), gz)
    found_area = [round(found[1], 1), round(found[2], 1)]

    # 8) hiding props: tanks and generators in yards, parked cars, kiosks and stalls by the road, trees
    rebuild_occ()
    keep_clear = [(gx, gz, 7.5), (found_area[0], found_area[1], 5.0)] + [
        ((s["rect"][0] + s["rect"][2]) / 2, (s["rect"][1] + s["rect"][3]) / 2, 6.5) for s in safe_houses
    ]
    keep_clear.append((sx, sz, 6.0))
    free = clearance(solid_only=False)
    yard: list[tuple[float, float]] = []
    kerb: list[tuple[float, float]] = []
    for j in range(2, N - 2):
        for i in range(2, N - 2):
            x, z = i - B + 0.5, j - B + 0.5
            if any(math.hypot(x - a, z - b) < r for a, b, r in keep_clear):
                continue
            if free[j][i] >= 2.2 and occ[j][i] == 0:
                near_road = any(
                    occ[jj][ii] == 1
                    for jj in range(max(0, j - 3), min(N, j + 4))
                    for ii in range(max(0, i - 3), min(N, i + 4))
                )
                (kerb if near_road else yard).append((x, z))
    rng.shuffle(yard)
    rng.shuffle(kerb)
    placed: list[tuple[float, float]] = []

    def spaced(x: float, z: float, r: float) -> bool:
        return all(math.hypot(x - a, z - b) >= r for a, b in placed)

    n_yard = 0
    budget = max(30, min(56, len(yard) // 90))  # open, sparse places get more cover
    for x, z in yard:
        if n_yard >= budget or not spaced(x, z, 7.5 if budget < 40 else 6.5):
            continue
        k = rng.random()
        if k < 0.32:
            P("tank", x, z, 1.6, 1.6, 2.6, color=rng.choice(["#1d1a16", "#2f6db5", "#d94f3d"]))
        elif k < 0.55:
            P("generator", x, z, 1.4, 1.0, 1.1)
        elif k < 0.72:
            P(
                rng.choice(["tree", "palm", "big_tree"] if free[int(z + B)][int(x + B)] > 4.5 else ["tree", "palm"]),
                x,
                z,
                2.4,
                2.4,
                rng.choice([6.5, 7.5, 8.5]),
            )
        elif k < 0.85:
            P("wall", x, z, rng.choice([4.0, 5.0, 6.0]), 0.35, 2.2, color=rng.choice(["#d9c6a5", "#cbb48f", "#c9a27a"]))
        else:
            P("container", x, z, 2.4, 5.8, 2.6, color=rng.choice(["#2f6db5", "#a23b3b", "#2f9e57"]))
        placed.append((x, z))
        n_yard += 1
    n_kerb = 0
    for x, z in kerb:
        if n_kerb >= 18 or not spaced(x, z, 8):
            continue
        _, seg, at = nearest_road(x, z)
        if seg is None:
            continue
        horizontal = abs(seg["b"][0] - seg["a"][0]) >= abs(seg["b"][1] - seg["a"][1])
        k = rng.random()
        if k < 0.35:
            c = rng.choice(["#22313f", "#f3efe6", "#a23b3b", "#7a828c", "#2f6db5"])
            P("car", x, z, *((4.2, 2.0) if horizontal else (2.0, 4.2)), 1.5, color=c)
        elif k < 0.5:
            P("danfo" if rng.random() < 0.6 else "keke", x, z, *((5.2, 2.2) if horizontal else (2.2, 5.2)), 2.4)
        elif k < 0.7:
            P(
                "kiosk",
                x,
                z,
                2.6,
                2.6,
                2.7,
                color=rng.choice(SHOP_COLORS),
                text=rng.choice(["POS", "RECHARGE CARD", "PURE WATER", "SUYA"]),
            )
        elif k < 0.85:
            P(
                "stall",
                x,
                z,
                3,
                2,
                2.5,
                color=rng.choice(SHOP_COLORS),
                text=rng.choice(["AMALA", "PEPPER", "TOMATO", "BOLE", "PROVISIONS", "YAM"]),
            )
        else:
            P("umbrella", x, z, 1.4, 1.4, 2.3, color=rng.choice(["#2f6db5", "#d94f3d", "#f2b705"]), text="POS")
        placed.append((x, z))
        n_kerb += 1

    # 9) nowhere sealed off: where a row of buildings shuts part of the area away, open an alley through the
    # smallest building in the way (checked with the game's own nav grid, exactly as players and NPCs move)
    def reach_of(ps: list[dict[str, Any]]) -> tuple[set[tuple[int, int]], NavGrid]:
        boxes = [Box(*c) for p in ps if (c := _collider(p))]
        nav = NavGrid([-B, -B, B, B], boxes, 0.35)
        start = nav.nearest_walkable(nav.cell_of(gx, gz))
        assert start is not None
        seen, todo = {start}, [start]
        while todo:
            i, j = todo.pop()
            for c in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if c not in seen and nav.ok(c):
                    seen.add(c)
                    todo.append(c)
        return seen, nav

    for _ in range(12):
        seen, nav = reach_of(props)
        total = sum(1 for col in nav.walkable for ok in col if ok)
        if len(seen) >= 0.985 * total:
            break
        # buildings touching both the reachable part and a shut-away part
        shut = {(i, j) for i in range(nav.w) for j in range(nav.h) if nav.walkable[i][j] and (i, j) not in seen}
        best = None
        for p in props:
            if not p.get("osm") and p["kind"] not in ("wall", "container"):
                continue
            x0, z0, x1, z1 = (
                p["x"] - p["w"] / 2 - 1.5,
                p["z"] - p["d"] / 2 - 1.5,
                p["x"] + p["w"] / 2 + 1.5,
                p["z"] + p["d"] / 2 + 1.5,
            )
            cells = [nav.cell_of(x, z) for x in (x0, (x0 + x1) / 2, x1) for z in (z0, (z0 + z1) / 2, z1)]
            ring = {
                (i, j)
                for i in range(nav.cell_of(x0, z0)[0], nav.cell_of(x1, z1)[0] + 1)
                for j in range(nav.cell_of(x0, z0)[1], nav.cell_of(x1, z1)[1] + 1)
            }
            if not cells or not (ring & seen) or not (ring & shut):
                continue
            area = p["w"] * p["d"]
            if best is None or area < best[0]:
                best = (area, p)
        if best is None:
            break
        print(f"  opening an alley: removed {best[1]['kind']} at ({best[1]['x']}, {best[1]['z']})", file=sys.stderr)
        props.remove(best[1])

    # place sign by the gather circle, and the perimeter fence (the district carries on past it)
    P("sign", gx, gz - 6.8 if gz > -B + 10 else gz + 6.8, 4.6, 0.3, 3.2, text=place["sign"])
    for side in (-1, 1):
        P("fence", 0, side * (B + 0.6), 2 * B + 2, 0.3, 2.2, color="#a0663f")
        P("fence", side * (B + 0.6), 0, 0.3, 2 * B + 2, 2.2, color="#a0663f")

    # 10) districts: the play area in five parts, named after the biggest street in each
    def biggest(rect: tuple[float, float, float, float], fallback: str) -> str:
        score: dict[str, float] = {}
        for nm, x, z, a in names:
            if rect[0] <= x <= rect[2] and rect[1] <= z <= rect[3]:
                score[nm] = score.get(nm, 0) + a
        return max(score, key=lambda k: score[k]) if score else fallback

    m = 14.0
    sections = [
        {"id": "centre", "name": f"{place['name']} Junction", "rect": [-m, -m, m, m]},
        {"id": "nw", "name": biggest((-B, -B, 0, 0), f"{place['name']} North"), "rect": [-B, -B, 0, 0]},
        {"id": "ne", "name": biggest((0, -B, B, 0), f"Upper {place['name']}"), "rect": [0, -B, B, 0]},
        {"id": "sw", "name": biggest((-B, 0, 0, B), f"{place['name']} Side Streets"), "rect": [-B, 0, 0, B]},
        {"id": "se", "name": biggest((0, 0, B, B), f"Lower {place['name']}"), "rect": [0, 0, B, B]},
    ]
    seen: set[str] = set()
    for s in sections:  # two parts on one long street: keep the name once
        if s["name"] in seen:
            s["name"] = f"{s['name']} ({s['id'].upper()})"
        seen.add(s["name"])

    return {
        "id": place["id"],
        "name": place["name"],
        "kind": "arena",
        "city": "ibadan",
        "town": True,
        "venue": {"name": place["blurb"], "lat": place["lat"], "lng": place["lng"]},
        "source": {
            "data": f"© OpenStreetMap contributors (ODbL), {source}",
            "terrain": "Terrarium tiles (AWS open data: SRTM and others)",
            "rot_deg": round(math.degrees(rot), 1),
        },
        "bounds": [-B, -B, B, B],
        "ground": place["ground"],
        "spawn": spawn,
        "arrival": spawn,
        "found_area": found_area,
        "terrain": terrain(place, rot),
        "props": props,
        "sections": sections,
        "safe_houses": safe_houses,
        "zones": [
            {
                "id": "bus_stop",
                "kind": "bus_stop",
                "name": f"{place['name']} Bus Stop",
                "rect": [round(v, 2) for v in stop],
            }
        ],
    }


def main() -> None:
    only = set(sys.argv[1:])
    for place in PLACES:
        if only and place["id"] not in only:
            continue
        data = build(place)
        out = MAPS / f"{place['id']}.json"
        out.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), "utf-8")
        kinds: dict[str, int] = {}
        for p in data["props"]:
            kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
        print(f"wrote {out.name}: {len(data['props'])} props {kinds}", file=sys.stderr)


if __name__ == "__main__":
    main()
