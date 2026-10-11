from app.content import get_config, get_maps
from app.engine.geometry import Box, collides, has_line_of_sight, in_bounds, validate_move

WALL = Box(-1, -5, 1, 5, 3.0)
HEDGE = Box(-1, -5, 1, 5, 1.1)
MV = get_config().movement


def mv(fx, fz, tx, tz, dt=0.1, speed=3.2, boxes=(WALL,)):
    return validate_move(
        from_x=fx,
        from_z=fz,
        to_x=tx,
        to_z=tz,
        dt=dt,
        max_speed=speed,
        tolerance=1.35,
        radius=0.35,
        bounds=[-50, -50, 50, 50],
        boxes=list(boxes),
    )


def test_normal_step_ok():
    assert mv(-5, 0, -4.7, 0).ok


def test_speed_hack_rejected():
    assert mv(-5, 0, -3, 0).reason == "speed"


def test_cannot_end_inside_wall_or_tunnel():
    assert mv(-1.5, 0, -1.2, 0).reason == "solid"
    assert mv(-1.5, 0, 1.5, 0, dt=1.0, speed=6).reason == "wall"


def test_bounds():
    assert mv(49.4, 0, 49.8, 0).reason == "bounds"
    assert not in_bounds([-1, -1, 1, 1], 0.9, 0, 0.35)


def test_nan_rejected():
    assert mv(0, 10, float("nan"), 10).reason == "nan"


def test_line_of_sight_and_crouching_behind_hedge():
    assert not has_line_of_sight(-5, 0, 5, 0, 1.7, [WALL])
    assert has_line_of_sight(-5, 0, 5, 0, 1.7, [HEDGE])  # standing: seen over hedge
    assert not has_line_of_sight(-5, 0, 5, 0, 0.9, [HEDGE])  # crouched: hidden
    assert has_line_of_sight(-5, 10, 5, 10, 1.7, [WALL])


def free_cells(m, rect):
    x0, z0, x1, z1 = rect
    pts = [(x0 + (x1 - x0) * i / 6, z0 + (z1 - z0) * j / 6) for i in range(1, 6) for j in range(1, 6)]
    return sum(not collides(x, z, MV.player_radius, m.boxes) for x, z in pts)


def test_maps_are_playable():
    for m in get_maps().values():
        assert in_bounds(m.bounds, *m.spawn, MV.player_radius)
        assert not collides(*m.spawn, MV.player_radius, m.boxes), m.id
        for area in [*m.safe_houses.values(), *m.zones.values()]:
            assert free_cells(m, area["rect"]) >= 4, area["id"]
    arena = get_maps()["arena_park"]
    assert len(arena.sections) == 5
