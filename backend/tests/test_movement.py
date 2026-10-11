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


async def test_newcomers_do_not_spawn_inside_each_other(db):
    clock = Clock()
    world = World(get_config(), get_maps(), db.sessions, clock=clock, rng=random.Random(1))
    spots = []
    for i in range(6):
        pid = await make_player(db, f"new{i}")
        s = await world.connect(pid, f"new{i}", Client())
        spots.append((s.x, s.z))
    for i, (x, z) in enumerate(spots):
        for ox, oz in spots[i + 1 :]:
            assert ((x - ox) ** 2 + (z - oz) ** 2) ** 0.5 > 0.85


async def test_invite_any_online_player_to_lobby(db):
    world, clock, s, c = await setup(db)
    pid2 = await make_player(db, "guest")
    c2 = Client()
    await world.connect(pid2, "guest", c2)
    await send(world, s, t="g_invite", to=pid2)
    assert c.last("err")  # no lobby yet
    await send(world, s, t="g_create", arena="arena_park", hide=30, search=180, safe="", bots=0)
    await send(world, s, t="g_invite", to=pid2)
    inv = c2.last("invite")
    assert inv and inv["code"] == s.group.code and inv["nick"] == "walker"


async def walk(world, clock, s, to_x, to_z, steps=40):
    """Walk in small, legal steps; returns True if we got there."""
    for _ in range(steps):
        dx, dz = to_x - s.x, to_z - s.z
        d = (dx * dx + dz * dz) ** 0.5
        if d < 0.05:
            return True
        k = min(1.0, 0.28 / d)
        clock.t += 0.1
        nx, nz = round(s.x + dx * k, 2), round(s.z + dz * k, 2)
        await send(world, s, t="mv", x=nx, z=nz, ry=0, c=False, r=False, st=False, s=1)
    return False


async def test_visitors_must_knock_and_owner_must_be_online(db):
    world, clock, owner, oc = await setup(db)
    home = get_maps()["hub_plaza"].homes[0]
    world.set_home(owner.pid, home["id"])
    vid = await make_player(db, "visitor")
    vc = Client()
    v = await world.connect(vid, "visitor", vc)
    v.place(*home["door"], clock.t, notify=False)
    inside = home["spawn"]
    # the door is locked
    assert not await walk(world, clock, v, *inside, steps=20)
    assert world.home_at(v.x, v.z) is None and vc.last("corr")
    # knock -> owner sees it -> lets you in
    v.place(*home["door"], clock.t, notify=False)
    await send(world, v, t="knock", home=home["id"])
    assert oc.last("knock")["from"] == vid
    await send(world, owner, t="knock_answer", to=vid, ok=True)
    assert vc.last("door")["open"]
    v.limits.clear()  # the per-socket mv rate limit runs on real time; this test fakes time
    assert await walk(world, clock, v, *inside)
    # owner goes offline: the visitor is walked back out
    world.disconnect(owner, owner.sender)
    assert world.home_at(v.x, v.z) is None
    # knocking on an offline owner's door gets no answer
    await send(world, v, t="knock", home=home["id"])
    assert "not online" in vc.last("err")["msg"]
