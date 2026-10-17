"""Ibadan places built from OpenStreetMap (tools/build_ibadan_osm.py) are real, playable arenas."""

from collections import deque

import pytest

from app.content import get_config, get_maps
from app.engine.geometry import collides

OSM_PLACES = ["arena_iwo_road", "arena_gate", "arena_bashorun", "arena_oke_mapo", "arena_airport_road"]


def _reachable(m) -> set[tuple[int, int]]:
    """Every nav cell you can walk to from the gather circle."""
    nav = m.nav
    start = nav.nearest_walkable(nav.cell_of(*m.spawn))
    assert start is not None, f"{m.id}: the gather circle is inside something solid"
    seen = {start}
    q = deque([start])
    while q:
        i, j = q.popleft()
        for c in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
            if c not in seen and nav.ok(c):
                seen.add(c)
                q.append(c)
    return seen


@pytest.mark.parametrize("arena", OSM_PLACES)
def test_osm_place_is_a_playable_arena(arena: str) -> None:
    m = get_maps()[arena]
    cfg = get_config()
    ibadan = next(c for c in cfg.cities if c.id == "ibadan")
    assert arena in ibadan.arenas and arena not in ibadan.event_arenas  # matched, like any arena
    assert cfg.city_of(arena) is ibadan
    assert m.raw["source"]["data"].startswith("© OpenStreetMap contributors")
    t = m.raw["terrain"]
    assert len(t["h"]) == t["n"] ** 2 and t["r"] > m.bounds[2]  # the hills round the place

    # buildings from OSM, and plenty of places to hide
    assert sum(1 for p in m.raw["props"] if p.get("osm")) >= 8
    assert len(m.hide_spots) >= 80

    reach = _reachable(m)
    nav = m.nav
    walkable = sum(1 for col in nav.walkable for ok in col if ok)
    assert len(reach) >= 0.97 * walkable  # no sealed-off pockets to get stuck in

    # gather circle: open ground for everyone to stand in
    gx, gz = m.spawn
    assert not collides(gx, gz, 4.5, m.boxes)

    # three safe houses you can walk into
    assert len(m.safe_houses) == 3
    for s in m.safe_houses.values():
        r = s["rect"]
        inside = nav.nearest_walkable(nav.cell_of((r[0] + r[2]) / 2, (r[1] + r[3]) / 2), max_r=2)
        assert inside in reach, f"{arena}: can't get into {s['name']}"

    # the bus stop and the found area are reachable too
    stop = m.zones["bus_stop"]["rect"]
    assert nav.nearest_walkable(nav.cell_of((stop[0] + stop[2]) / 2, (stop[1] + stop[3]) / 2), max_r=2) in reach
    fx, fz = m.found_area
    for k in range(6):  # caught players stand in a row here
        assert not collides(fx + (k - 2.5) * 1.5, fz, 0.4, m.boxes)


def test_agodi_is_home_and_akobo_is_never_matched() -> None:
    from app.realtime.world import IBADAN_HOME

    ibadan = next(c for c in get_config().cities if c.id == "ibadan")
    assert IBADAN_HOME == "arena_ibadan" and get_maps()[IBADAN_HOME].raw["venue"]["name"].startswith("Agodi")
    assert "arena_akobo" not in ibadan.arenas and "arena_akobo" in ibadan.event_arenas
