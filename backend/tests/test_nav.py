import pytest

from app.content import get_maps
from app.engine.geometry import Box, BoxIndex, collides
from app.engine.nav import NavGrid, hide_spots


def test_box_index_returns_nearby_boxes_only():
    near, far = Box(0, 0, 1, 1, 2), Box(50, 50, 51, 51, 2)
    idx = BoxIndex([near, far])
    assert idx.query(0.5, 0.5, 2, 2) == [near]
    assert set(map(id, idx.query(-5, -5, 60, 60))) == {id(near), id(far)}


def test_path_goes_around_a_wall():
    wall = Box(-0.5, -10, 0.5, 10, 3)
    grid = NavGrid([-20, -20, 20, 20], [wall], 0.35)
    path = grid.find_path(-5, 0, 5, 0)
    assert path and abs(path[-1][0] - 5) < 1 and abs(path[-1][1]) < 1
    pts = [(-5.0, 0.0), *path]
    for (ax, az), (bx, bz) in zip(pts, pts[1:], strict=False):
        assert grid.clear_line(ax, az, bx, bz)
    assert max(abs(z) for _, z in path) > 9  # had to detour round the end of the wall


@pytest.mark.parametrize("arena", ["arena_park", "arena_abuja", "arena_ibadan"])
def test_arena_nav_and_hide_spots(arena):
    m = get_maps()[arena]
    assert len(m.sections) == 5 and len(m.safe_houses) == 3
    assert m.raw.get("city") and m.raw.get("venue")
    for sh in m.safe_houses.values():
        x0, z0, x1, z1 = sh["rect"]
        assert m.nav.find_path(*m.spawn, (x0 + x1) / 2, (z0 + z1) / 2), sh["id"]
    grid = NavGrid(m.bounds, m.boxes, 0.35)
    spots = hide_spots(grid, m.boxes)
    assert len(spots) > 20
    assert not any(collides(x, z, 0.35, m.boxes) for x, z in spots)
    sx, sz = m.spawn
    reachable = [s for s in spots[:10] if grid.find_path(sx, sz, *s)]
    assert len(reachable) >= 8


def test_hub_homes_and_zones_are_reachable():
    m = get_maps()["hub_plaza"]
    assert len(m.homes) >= 10
    for h in m.homes:
        assert not collides(*h["spawn"], 0.35, m.boxes), h["id"]
        assert m.nav.find_path(*h["spawn"], *m.arrival, max_nodes=40000), h["id"]
    for z in m.zones.values():
        x0, z0, x1, z1 = z["rect"]
        assert m.nav.find_path(*m.arrival, (x0 + x1) / 2, (z0 + z1) / 2, max_nodes=40000), z["id"]
    assert m.home_for("abc") == m.home_for("abc")
