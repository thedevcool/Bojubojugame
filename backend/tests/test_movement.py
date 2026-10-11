"""Server movement validation must not rubber-band honest players on jittery networks."""

import random

from app.content import get_config, get_maps
from app.realtime.world import World
from tests.conftest import make_player
from tests.test_group_flow import Client, Clock, send


async def setup(db):
    clock = Clock()
    world = World(get_config(), get_maps(), db.sessions, clock=clock, rng=random.Random(1))
    pid = await make_player(db, "walker")
    c = Client()
    s = await world.connect(pid, "walker", c)
    s.place(0.0, -40.0, clock.t, notify=False)  # open road in the hub
    return world, clock, s, c


async def test_bunched_packets_are_accepted(db):
    """A phone at 30 fps sends a running move every 0.1 s; pairs arrive together after lag spikes."""
    world, clock, s, c = await setup(db)
    x, seq = 0.0, 0
    for _ in range(6):  # stays under the per-socket mv rate limit (real-time based)
        clock.t += 0.2  # two packets' worth of real time passes...
        for _ in range(2):  # ...then both arrive at the same instant
            x += 6.0 * 0.1
            seq += 1
            await send(world, s, t="mv", x=round(x, 2), z=-40.0, ry=0, c=False, r=True, st=False, s=seq)
    assert c.last("corr") is None
    assert abs(s.x - x) < 0.02


async def test_speed_hack_still_rejected(db):
    world, clock, s, c = await setup(db)
    x = 0.0
    for i in range(30):
        clock.t += 1 / 12
        x += 1.5  # 18 m/s
        await send(world, s, t="mv", x=round(x, 2), z=-40.0, ry=0, c=False, r=True, st=False, s=i + 1)
    assert c.last("corr") is not None
    assert s.x < 10
