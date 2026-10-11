"""End-to-end group state machine with a fake clock (no sockets)."""

import random

import msgpack

from app.content import get_config, get_maps
from app.realtime import protocol as P
from app.realtime.world import World
from tests.conftest import make_player


class Clock:
    t = 1_000_000.0

    def __call__(self):
        return self.t


class Client:
    def __init__(self):
        self.msgs = []

    def __call__(self, data: bytes):
        self.msgs.append(msgpack.unpackb(data))

    def last(self, t):
        return next((m for m in reversed(self.msgs) if m["t"] == t), None)


async def send(world, sess, **msg):
    await world.handle(sess, P.encode(msg))


async def advance(world, clock, seconds):
    end = clock.t + seconds
    while clock.t < end:
        clock.t += 0.1
        await world.tick()


async def until(world, clock, g, phase, limit=400):
    start = clock.t
    while g.phase != phase:
        assert clock.t - start < limit, f"stuck in {g.phase}"
        clock.t += 0.1
        await world.tick()
    return clock.t - start


async def setup(db, n=3):
    clock = Clock()
    world = World(get_config(), get_maps(), db.sessions, clock=clock, rng=random.Random(42))
    players = []
    for i in range(n):
        pid = await make_player(db, f"P{i}")
        await world.economy.post(pid, 20000, "start", f"start:{pid}")
        c = Client()
        s = await world.connect(pid, f"P{i}", c)
        players.append((s, c))
    return world, clock, players


async def test_full_game(db):
    world, clock, players = await setup(db, 3)
    (a, ca), (b, cb), (c, cc) = players
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse")
    code = ca.last("g_state")["code"]
    for s in (b, c):
        await send(world, s, t="g_join", code=code)
    await send(world, b, t="g_start")
    assert cb.last("err")["msg"] == "Only the creator can start"
    await send(world, a, t="g_start")
    g = a.group
    assert g.phase == "travel"

    # A walks to the bus stop and boards a keke; B and C get auto-boarded on a danfo.
    await send(world, a, t="g_board", fare="keke")
    assert ca.last("err")["msg"] == "Walk to the bus stop first"
    a.x, a.z = -6, -3
    await send(world, a, t="g_board", fare="keke")
    assert a.room is g.arena and ca.last("ride")
    await advance(world, clock, get_config().game.travel_window_s + 0.5)
    assert g.phase == "dice" and all(s.room is g.arena for s in (a, b, c))
    assert await world.economy.balance(b.pid) == 20000 - get_config().cheapest_fare.price

    await send(world, a, t="g_pick", n=1)
    await send(world, b, t="g_pick", n=1)
    assert cb.last("err")["msg"] == "That number is taken"
    await send(world, b, t="g_pick", n=2)
    await send(world, c, t="g_pick", n=3)
    await advance(world, clock, 0.2)
    assert g.phase == "reveal" and ca.last("g_dice")
    await advance(world, clock, 6)
    assert g.phase == "hide"
    r = g.round
    seeker = world.sessions[r.seeker]
    hiders = [world.sessions[h] for h in r.hiders]
    assert seeker.frozen

    # Chat is locked during the round; the seeker can't see hiders while counting.
    client_of = {a.pid: ca, b.pid: cb, c.pid: cc}
    await send(world, hiders[0], t="chat", text="I dey behind the tree")
    assert "locked" in client_of[hiders[0].pid].last("err")["msg"]
    hiders[0].x, hiders[0].z = -1, -30
    hiders[1].x, hiders[1].z = 30, 30  # inside the gate house (safe house)
    assert not g.can_see(seeker, hiders[0])

    await advance(world, clock, 15.1)
    assert g.phase == "seek" and not seeker.frozen
    seeker.x, seeker.z = -3, -30
    assert g.can_see(seeker, hiders[0])
    await advance(world, clock, 1)
    assert hiders[1].pid in r.in_safe
    await send(world, seeker, t="g_tag")
    assert r.found_order == [hiders[0].pid]
    assert hiders[0].spectator

    # Safe-house time runs out (20 s), then the round ends at search time.
    await advance(world, clock, 21)
    assert hiders[1].pid not in r.in_safe
    waited = await until(world, clock, g, "result")
    assert 60 < waited < 70  # 90 s search minus the 22 s already played
    deltas = g.last_result["deltas"]
    assert deltas[seeker.pid] == 5000 and deltas[hiders[0].pid] == 0 and deltas[hiders[1].pid] == 7500
    assert seeker.pid in g.retired

    # Final round between the remaining two; first found seeks next.
    await until(world, clock, g, "reveal")
    assert g.pending_seeker == hiders[0].pid
    await until(world, clock, g, "hide")
    assert g.round.is_final and g.round.seeker == hiders[0].pid
    await until(world, clock, g, "result")
    assert g.last_result["deltas"][hiders[0].pid] == -2500
    await until(world, clock, g, "over")
    assert g.final_results
    assert any(m["t"] == "g_over" for m in ca.msgs)

    # Wallet always matches ledger.
    for s in (a, b, c):
        wallet = [m for m in players[[a, b, c].index(s)][1].msgs if m["t"] == "wallet"][-1]
        assert wallet["balance"] == await world.economy.balance(s.pid)


async def test_seeker_disconnect_skips_round(db):
    world, clock, players = await setup(db, 3)
    (a, ca), (b, _), (c, _) = players
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse")
    for s in (b, c):
        await send(world, s, t="g_join", code=ca.last("g_state")["code"])
    await send(world, a, t="g_start")
    g = a.group
    await advance(world, clock, 61)
    await advance(world, clock, 16)
    assert g.phase in ("reveal", "hide")
    await advance(world, clock, 6)
    seeker = world.sessions[g.round.seeker]
    world.disconnect(seeker, seeker.sender)
    await advance(world, clock, 16)
    assert g.phase == "result" and g.last_result["skipped"] and g.last_result["deltas"] == {}
    await advance(world, clock, 10.1)
    assert g.phase in ("dice", "reveal") and seeker.pid not in g.dice_pool


async def test_hungry_player_cannot_start(db):
    world, clock, players = await setup(db, 2)
    (a, ca), (b, cb) = players
    await world.economy.change_hunger(b.pid, -100)
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse")
    await send(world, b, t="g_join", code=ca.last("g_state")["code"])
    await send(world, a, t="g_start")
    assert "hungry" in ca.last("err")["msg"]
    # Buying food requires being at the food spot.
    await send(world, b, t="buy", item="suya", key="abcdefgh1")
    assert "Walk to" in cb.last("err")["msg"]
    b.x, b.z = 11, 6.5
    await send(world, b, t="buy", item="suya", key="abcdefgh1")
    assert cb.last("wallet")["hunger"] >= 20


async def test_movement_validation(db):
    world, clock, players = await setup(db, 1)
    ((a, ca),) = players
    x0, z0 = a.x, a.z
    clock.t += 0.1
    await send(world, a, t="mv", x=x0 + 10, z=z0, ry=0, s=1)
    assert (a.x, a.z) == (x0, z0) and ca.last("corr")
    clock.t += 0.1
    await send(world, a, t="mv", x=x0 + 0.3, z=z0, ry=0, s=2)
    assert a.x == x0 + 0.3
