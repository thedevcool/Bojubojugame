"""End-to-end group state machine with a fake clock (no sockets)."""

import random

import msgpack

from app.content import get_config, get_maps
from app.engine.geometry import collides
from app.realtime import protocol as P
from app.realtime.world import World
from tests.conftest import make_player


def zone_point(zone_id):
    """A standable point inside a hub zone (maps are data and may move)."""
    m = get_maps()["hub_plaza"]
    x0, z0, x1, z1 = m.zones[zone_id]["rect"]
    for i in range(1, 10):
        for j in range(1, 10):
            x, z = x0 + (x1 - x0) * i / 10, z0 + (z1 - z0) * j / 10
            if not collides(x, z, 0.35, m.boxes):
                return x, z
    raise AssertionError(zone_id)


START = 5_000_000  # enough naira to cover the (big) round penalties


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


async def gather_all(world, clock, g):
    """Everyone gets off the bus and walks into the circle; the dice only start then."""
    assert g.phase == "gather"
    clock.t = max([clock.t, *g.arrive_at.values()]) + 0.1
    await world.tick()
    assert g.phase == "gather"  # still at the bus stop, not in the circle yet
    for i, p in enumerate(g.active):
        world.sessions[p].x, world.sessions[p].z = g.arena.spawn_point(i)
    clock.t += 0.1
    await world.tick()


def scatter(world, g):
    """Hiders run off during the hide phase (standing next to Boju gets you caught at once)."""
    spots = [(-20, -30), (25, -25), (-30, 20), (30, 5), (-10, -38)]
    for h, (x, z) in zip(g.round.hiders, spots, strict=False):
        world.sessions[h].x, world.sessions[h].z = x, z


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
        await world.economy.post(pid, START, "start", f"start:{pid}")
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

    # Starting the game takes everyone to the motor park; walking away means you can't board.
    stop = get_maps()["hub_plaza"].zones["bus_stop"]["rect"]
    assert all(stop[0] <= s.x <= stop[2] + 1 and stop[1] - 1 <= s.z <= stop[3] + 1 for s in (a, b, c))
    assert ca.last("tp")
    a.x, a.z = 0.0, -40.0
    await send(world, a, t="g_board", fare="keke")
    assert ca.last("err")["msg"] == "Walk to the bus stop first"
    a.x, a.z = zone_point("bus_stop")
    # A boards a keke; B and C get auto-boarded on a danfo.
    await send(world, a, t="g_board", fare="keke")
    assert a.room is g.arena and ca.last("ride")
    await advance(world, clock, get_config().game.travel_window_s + 0.5)
    assert g.phase == "gather" and all(s.room is g.arena for s in (a, b, c))
    await gather_all(world, clock, g)
    assert g.phase == "dice"
    assert await world.economy.balance(b.pid) == START - get_config().cheapest_fare.price

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
    assert r.found_order == [hiders[0].pid]  # caught just by reaching them — no button
    assert ca.last("g_tag")["auto"]
    assert hiders[0].spectator

    # Safe-house time runs out (20 s), then the round ends at search time.
    await advance(world, clock, 21)
    assert hiders[1].pid not in r.in_safe
    waited = await until(world, clock, g, "result")
    assert 60 < waited < 70  # 90 s search minus the 22 s already played
    deltas = g.last_result["deltas"]
    sc = get_config().scoring
    assert deltas[seeker.pid] == sc.seeker_find_one and deltas[hiders[0].pid] == 0
    assert deltas[hiders[1].pid] == sc.hider_not_found
    # the reveal tour: where the unfound hider was, and how close Boju came (seeker ~33 m away at (-3,-30))
    spots = g.last_result["hidden_at"]
    assert [x["id"] for x in spots] == [hiders[1].pid] and (spots[0]["x"], spots[0]["z"]) == (hiders[1].x, hiders[1].z)
    assert spots[0]["closest"] is not None and spots[0]["closest"] > 30
    assert g.phase_end - clock.t > get_config().game.result_s  # the result phase makes room for the tour
    assert seeker.pid in g.retired

    # Final round between the remaining two; first found seeks next.
    await until(world, clock, g, "reveal")
    assert g.pending_seeker == hiders[0].pid
    await until(world, clock, g, "hide")
    assert g.round.is_final and g.round.seeker == hiders[0].pid
    scatter(world, g)
    await until(world, clock, g, "result")
    assert g.last_result["deltas"][hiders[0].pid] == -sc.seeker_none_penalty
    await until(world, clock, g, "over")
    assert g.final_results
    assert any(m["t"] == "g_over" for m in ca.msgs)
    # whoever watched the last round from the stands (outside the field) is back inside to explore
    bx0, bz0, bx1, bz1 = g.map.bounds
    assert all(bx0 < s.x < bx1 and bz0 < s.z < bz1 and not s.spectator for s in (a, b, c))

    # Stay & explore: still in the arena and free to walk. Then ride home.
    assert a.room is g.arena and not a.frozen
    await send(world, a, t="g_return")
    assert a.group is None and a.room is not g.arena and ca.last("ride")["dir"] == "home"

    # Wallet always matches ledger.
    for s in (a, b, c):
        wallet = [m for m in players[[a, b, c].index(s)][1].msgs if m["t"] == "wallet"][-1]
        assert wallet["balance"] == await world.economy.balance(s.pid)

    # Play again is a rematch request: C says no -> nothing happens, B is told.
    await send(world, b, t="g_rematch")
    assert cb.last("rematch_wait")["n"] == 1 and cc.last("rematch_ask")["nick"] == b.nick
    await send(world, c, t="g_rematch", answer="no")
    await advance(world, clock, 0.2)
    assert b.group is g and c.group is g and cc.last("rematch_end")
    assert "no rematch" in cb.last("toast")["msg"]
    # Asked again, nobody answers in time -> still no rematch.
    await send(world, b, t="g_rematch")
    await advance(world, clock, 31)
    assert b.group is g and "no rematch" in cb.last("toast")["msg"]
    # Asked again and C accepts (tapping Play again counts as yes): a new private game, same settings,
    # no NPCs, and it starts straight away once everyone answered.
    await send(world, b, t="g_rematch")
    await send(world, c, t="g_rematch")
    ng = b.group
    assert ng is not g and c.group is ng and not ng.public and ng.settings == g.settings and not ng.bots
    assert "accepted" in cb.last("toast")["msg"]
    await advance(world, clock, 0.2)
    assert ng.phase == "travel"
    await send(world, a, t="g_rematch")
    assert ca.last("err")["msg"] == "Finish this game first"  # A already rode home


async def test_offline_boju_stand_in_stays_put(db):
    """Boju minimises the app mid-round: their stand-in stays exactly where they were (no moving, no finding),
    the round runs out normally, and they carry on when back."""
    world, clock, players = await setup(db, 3)
    (a, ca), (b, _), (c, _) = players
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse")
    for s in (b, c):
        await send(world, s, t="g_join", code=ca.last("g_state")["code"])
    await send(world, a, t="g_start")
    g = a.group
    await advance(world, clock, 61)
    await gather_all(world, clock, g)
    await until(world, clock, g, "hide")
    scatter(world, g)
    seeker = world.sessions[g.round.seeker]
    sender = seeker.sender
    world.disconnect(seeker, sender)
    await until(world, clock, g, "seek")
    spot = (seeker.x, seeker.z)
    await advance(world, clock, 30)
    assert (seeker.x, seeker.z) == spot and g.phase == "seek" and not g.round.skipped
    await world.connect(seeker.pid, seeker.nick, sender)
    await advance(world, clock, 0.2)
    assert seeker.pid in g.active and g.phase == "seek"


async def test_offline_hider_keeps_their_spot(db):
    """The hider closes the app mid-round: they stay hidden right there, and Boju can still find them."""
    world, clock, players = await setup(db, 3)
    (a, ca), (b, _), (c, _) = players
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse")
    for s in (b, c):
        await send(world, s, t="g_join", code=ca.last("g_state")["code"])
    await send(world, a, t="g_start")
    g = a.group
    await advance(world, clock, 61)
    await gather_all(world, clock, g)
    await until(world, clock, g, "hide")
    scatter(world, g)
    hider = world.sessions[g.round.hiders[0]]
    spot = (hider.x, hider.z)
    world.disconnect(hider, hider.sender)
    await advance(world, clock, 40)
    assert g.phase == "seek" and g.round.state[hider.pid] == "hiding" and (hider.x, hider.z) == spot
    boju = world.sessions[g.round.seeker]
    boju.x, boju.z = hider.x + 0.5, hider.z
    await advance(world, clock, 0.3)
    assert g.round.state[hider.pid] == "found"


async def test_away_too_long_two_players_the_other_wins(db, monkeypatch):
    """Two players; one is gone past the limit (30 minutes; 60 s here, as a game rarely lasts 30 minutes): taken
    out of the game, it ends, the one who stayed wins, and the one who was away is told when they come back."""
    from app.realtime import group as group_mod

    monkeypatch.setattr(group_mod, "AWAY_LIMIT_S", 60.0)
    world, clock, players = await setup(db, 2)
    (a, ca), (b, cb) = players
    await send(world, a, t="g_create", arena="arena_park", hide=30, search=180, safe="gatehouse")
    await send(world, b, t="g_join", code=ca.last("g_state")["code"])
    await send(world, a, t="g_start")
    g = a.group
    await advance(world, clock, 61)
    await gather_all(world, clock, g)
    await until(world, clock, g, "hide")
    scatter(world, g)
    code = g.code
    world.disconnect(b, b.sender)
    await advance(world, clock, 50)
    assert g.phase != "over" and b.pid not in g.left  # away a while: still in, as their stand-in
    await advance(world, clock, 15)
    assert g.phase == "over" and b.pid in g.left
    assert g.final_results[0]["id"] == a.pid
    s = await world.connect(b.pid, b.nick, cb)
    assert any(m["t"] == "toast" and code in m["msg"] for m in cb.msgs[-8:]) and s.group is None


async def test_retired_boju_goes_to_the_stands(db):
    world, clock, players = await setup(db, 3)
    (a, ca), (b, _), (c, _) = players
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse")
    for s in (b, c):
        await send(world, s, t="g_join", code=ca.last("g_state")["code"])
    await send(world, a, t="g_start")
    g = a.group
    await advance(world, clock, 61)
    await gather_all(world, clock, g)
    await until(world, clock, g, "seek")
    scatter(world, g)
    boju = world.sessions[g.round.seeker]
    target = world.sessions[g.round.hiders[0]]
    boju.x, boju.z = target.x + 0.5, target.z
    await until(world, clock, g, "result")
    assert boju.pid in g.retired and boju.frozen and boju.spectator
    fx, fz = g.map.found_area
    assert abs(boju.z - fz) < 0.01  # in the stands, not standing where they were seeking


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


async def test_game_with_npc_players(db):
    from sqlalchemy import func, select

    from app.db import LedgerEntry, RoundStat

    world, clock, players = await setup(db, 1)
    ((a, ca),) = players
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse", bots=3)
    g = a.group
    assert len(g.members) == 4 and len(g.bots) == 3
    assert all(m["bot"] for m in ca.last("g_state")["members"][1:])
    await send(world, a, t="g_add_bot")
    await send(world, a, t="g_remove_bot", id=g.members[-1])
    assert len(g.members) == 4
    await send(world, a, t="g_start")
    assert all(world.sessions[b].room is g.arena for b in g.bots)  # NPCs board instantly
    a.x, a.z = zone_point("bus_stop")
    await send(world, a, t="g_board", fare="danfo")
    await until(world, clock, g, "reveal")
    assert set(g.picks) == set(g.members)  # NPCs picked their own numbers
    await until(world, clock, g, "seek")
    r = g.round
    spawn = get_maps()["arena_park"].spawn
    moved = [
        b
        for b in r.hiders
        if b in g.bots and abs(world.sessions[b].x - spawn[0]) + abs(world.sessions[b].z - spawn[1]) > 8
    ]
    assert moved, "NPC hiders should run off to hide"
    await until(world, clock, g, "over", limit=3000)
    assert g.final_results and g.rounds_played >= 1
    total_finds = sum(row["finds"] for row in g.final_results)
    assert total_finds >= 1, "somebody should get found across the game"
    async with world.db() as s:
        bot_rows = await s.scalar(
            select(func.count()).select_from(LedgerEntry).where(LedgerEntry.player_id.like("bot_%"))
        )
        stat_players = set((await s.scalars(select(RoundStat.player_id))).all())
    assert bot_rows == 0 and stat_players <= {a.pid}
    assert ca.last("wallet")["balance"] == await world.economy.balance(a.pid)
    # Leaving after the game drops the group and its NPCs.
    await send(world, a, t="g_leave")
    await advance(world, clock, 1)
    assert not any(p.startswith("bot_") for p in world.sessions)


async def test_interstate_fares_and_ride_mode(db):
    world, clock, players = await setup(db, 2)
    (a, ca), (b, _) = players
    await send(world, a, t="g_create", arena="arena_abuja", hide=15, search=90, safe="pavilion")
    await send(world, b, t="g_join", code=ca.last("g_state")["code"])
    await send(world, a, t="g_start")
    a.x, a.z = zone_point("bus_stop")
    await send(world, a, t="g_board", fare="danfo")
    assert ca.last("err")["msg"] == "Unknown ride"  # no danfo to Abuja
    await send(world, a, t="g_board", fare="bus")
    assert ca.last("ride")["mode"] == "bus" and ca.last("ride")["arena"] == "arena_abuja"
    assert await world.economy.balance(a.pid) == START - 15000


async def test_gather_times_out_and_walks_stragglers_in(db):
    world, clock, players = await setup(db, 2)
    (a, ca), (b, _) = players
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse")
    await send(world, b, t="g_join", code=ca.last("g_state")["code"])
    await send(world, a, t="g_start")
    g = a.group
    await advance(world, clock, 61)
    assert g.phase == "gather" and ca.last("g_state")["gather"]["r"] > 0
    await advance(world, clock, g.phase_end - clock.t + 0.2)
    assert g.phase == "dice"
    assert all(g.in_circle(p, clock.t) for p in g.active)


async def test_live_games_list_and_spectator_map(db):
    world, clock, players = await setup(db, 3)
    (a, ca), (b, cb), (w, cw) = players
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse", bots=1)
    g = a.group
    row = g.summary()
    assert row["joinable"] and row["humans"] == 1 and row["bots"] == 1
    await send(world, b, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse", public=False)
    assert not b.group.summary()["joinable"]  # private: invite-only
    await send(world, b, t="g_leave")

    # w watches A's game from the hub, without moving
    await send(world, w, t="watch", code=g.code)
    await send(world, a, t="g_start")
    await advance(world, clock, 61)
    await gather_all(world, clock, g)
    await until(world, clock, g, "hide")
    scatter(world, g)
    await advance(world, clock, 0.4)
    snap = cw.last("wsnap")
    assert snap["code"] == g.code and snap["phase"] == "hide"
    shown = {p[0] for p in snap["players"]}
    assert g.round.seeker in shown and not any(h in shown for h in g.round.hiders)  # no peeking for Boju's friends
    assert w.room is not g.arena
    await send(world, w, t="watch", code=None)
    assert w.watching is None


async def test_closed_game_tells_players_and_reconnect_clears_it(db):
    """A finished game the server closes must not leave a stuck game-over screen on anyone's phone."""
    world, clock, players = await setup(db, 2)
    (a, ca), (b, cb) = players
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse")
    await send(world, b, t="g_join", code=ca.last("g_state")["code"])
    g = a.group
    # B's phone sleeps (disconnects) while the game is still on
    world.disconnect(b, b.sender)
    # the game ends; nobody is exploring the venue (both are in Lagos), so the server closes it
    g.phase, g.phase_end = "over", clock.t
    await advance(world, clock, 0.3)
    assert a.group is None and b.group is None and g.code not in world.groups
    assert ca.last("g_left") is not None  # A's phone is told straight away
    # B comes back: hello says "not in a game", so the phone drops the old game screens
    cb2 = Client()
    await world.connect(b.pid, b.nick, cb2)
    assert cb2.last("hello")["in_group"] is False


async def test_closing_the_app_keeps_you_where_you_were(db):
    """In Lagos too: close the app and you stay standing there; after 30 minutes you go offline, and coming back
    puts you on the same spot."""
    world, clock, players = await setup(db, 1)
    ((a, ca),) = players
    a.x, a.z = zone_point("suya")
    spot = (a.x, a.z)
    sender = a.sender
    world.disconnect(a, sender)
    await advance(world, clock, 120)
    assert a.pid in world.sessions and a.room is not None and (a.x, a.z) == spot  # still standing there
    await advance(world, clock, 30 * 60)
    assert a.pid not in world.sessions
    s = await world.connect(a.pid, a.nick, Client())
    assert abs(s.x - spot[0]) < 1.5 and abs(s.z - spot[1]) < 1.5


async def test_host_can_cancel_and_npc_lobby_closes(db):
    world, clock, players = await setup(db, 2)
    (a, ca), (b, cb) = players
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse")
    code = ca.last("g_state")["code"]
    await send(world, b, t="g_join", code=code)
    await send(world, b, t="g_cancel")  # not the host
    assert "Only the host" in cb.last("err")["msg"] and code in world.groups
    await send(world, a, t="g_cancel")
    assert code not in world.groups and a.group is None and b.group is None
    assert cb.last("g_left") is not None and any(m["t"] == "toast" and "cancelled" in m["msg"] for m in cb.msgs)
    # a lobby left with only NPCs closes at once
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse")
    code2 = ca.last("g_state")["code"]
    await send(world, a, t="g_add_bot")
    await send(world, a, t="g_leave")
    assert code2 not in world.groups


async def test_dice_never_picks_someone_who_left(db):
    world, clock, players = await setup(db, 3)
    (a, ca), (b, _), (c, _) = players
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse")
    for s in (b, c):
        await send(world, s, t="g_join", code=ca.last("g_state")["code"])
    await send(world, a, t="g_start")
    g = a.group
    await advance(world, clock, 61)
    await gather_all(world, clock, g)
    assert g.phase == "dice"
    await send(world, c, t="g_leave")
    await until(world, clock, g, "hide")
    assert g.round.seeker != c.pid and c.pid not in g.round.hiders


async def test_solo_game_pauses_and_resumes(db):
    """LagosLife rule 4: with only NPCs, the game's timers stop while the player's app is paused or closed."""
    world, clock, players = await setup(db, 1)
    ((a, ca),) = players
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse", bots=1)
    g = a.group
    await send(world, a, t="g_start")
    a.x, a.z = zone_point("bus_stop")
    await send(world, a, t="g_board", fare="danfo")
    await until(world, clock, g, "hide")
    left = g.phase_end - clock.t
    await send(world, a, t="g_pause")
    await advance(world, clock, 120)  # far longer than the hide time
    assert g.phase == "hide" and g.paused_at is not None
    await send(world, a, t="g_resume")
    await advance(world, clock, 0.2)
    assert g.paused_at is None and g.phase == "hide"
    assert abs((g.phase_end - clock.t) - left) < 0.5, "the countdown carries on from where it stopped"
    # Closing the app (socket gone) pauses too; coming back resumes.
    world.disconnect(a, a.sender)
    await advance(world, clock, 60)
    assert g.phase == "hide" and g.paused_at is not None
    s = await world.connect(a.pid, a.nick, Client())
    assert s.group is g
    await advance(world, clock, 0.2)
    assert g.paused_at is None and g.phase == "hide"


async def test_multiplayer_game_never_pauses(db):
    """Other people are playing: one player's pause must not stop their game (the stand-in holds your place)."""
    world, clock, players = await setup(db, 2)
    (a, _), (b, _) = players
    await send(world, a, t="g_create", arena="arena_park", hide=15, search=90, safe="gatehouse")
    g = a.group
    await send(world, b, t="g_join", code=g.code)
    await send(world, a, t="g_pause")
    assert not g.solo and g.paused_at is None


async def test_match_me_pairs_players_and_starts_itself(db):
    """Match me: the second player lands in the first one's waiting match; it starts by itself soon after."""
    world, clock, players = await setup(db, 3)
    (a, ca), (b, _), (c, _) = players
    await send(world, a, t="g_match")
    g = a.group
    assert g is not None and g.matchmade and g.phase == "lobby"
    await send(world, b, t="g_match")
    assert b.group is g and len(g.humans) == 2
    await advance(world, clock, 5)
    assert g.phase == "lobby"  # waits a moment for more players
    await send(world, c, t="g_match")
    assert c.group is g
    await advance(world, clock, 13)
    assert g.phase == "travel" and not g.bots


async def test_match_me_alone_plays_npcs(db):
    world, clock, players = await setup(db, 1)
    ((a, ca),) = players
    await send(world, a, t="g_match")
    g = a.group
    await advance(world, clock, 41)
    assert g.phase == "travel" and len(g.bots) == 2
    assert any(m["t"] == "toast" and "NPC" in m["msg"] for m in ca.msgs)


async def test_ibadan_players_live_at_agodi(db):
    world, clock, players = await setup(db, 1)
    ((a, ca),) = players
    world.set_city(a.pid, "ibadan")
    assert a.room is world.explore["arena_ibadan"]  # Agodi Gardens
    # a match from Ibadan is played in Ibadan, and boarding works from Ibadan's bus stop
    await send(world, a, t="g_match")
    ibadan = next(c for c in world.cfg.cities if c.id == "ibadan")
    assert a.group.settings["arena"] in ibadan.arenas  # never Akobo: that's for events
    assert a.group.settings["arena"] != "arena_akobo"


async def test_ibadan_matches_use_every_ibadan_place(db):
    """Match me from Ibadan plays at any of Ibadan's places (Agodi and the five OSM places), never Akobo."""
    world, clock, players = await setup(db, 1)
    ((a, _),) = players
    world.set_city(a.pid, "ibadan")
    seen = set()
    for _ in range(60):
        g = await world.match_me(a)
        seen.add(g.settings["arena"])
        world.leave_group(a, quiet=True)
    ibadan = next(c for c in world.cfg.cities if c.id == "ibadan")
    assert seen == set(ibadan.arenas) and "arena_akobo" not in seen


async def test_streaks_count_wins_and_hides(db):
    world, clock, players = await setup(db, 2)
    (a, _), (b, _) = players
    await world.bump_streaks({a.pid: {"hide": True, "win": True}, b.pid: {"hide": False}})
    await world.bump_streaks({a.pid: {"hide": True, "win": False}})
    sa, sb = await world.get_streaks(a.pid), await world.get_streaks(b.pid)
    assert sa["hide_streak"] == 2 and sa["win_streak"] == 0 and sa["best_win_streak"] == 1
    assert sb["hide_streak"] == 0
