"""Room-and-parlour houses, starter furniture, the furniture shop and decorate-mode layouts."""

from app import houses
from app.content import get_config, get_maps
from app.engine.geometry import collides
from tests.test_life import _give_phone, c, drain, reg  # noqa: F401  (fixture re-export)

CATALOG = get_config().furniture_by_id()


def test_every_house_has_its_rooms():
    for h in get_maps()["hub_plaza"].homes:
        lay = houses.layout(h["lw"], h["ld"], h["style"])
        assert len(lay.rooms) == (3 if h["style"] == "duplex" else 2)


def test_layout_rules_catch_walls_doors_and_overlaps():
    lay = houses.layout(11, 10, "bungalow")
    P = houses.Placement
    assert "walls" in houses.check_layout(lay, [P(1, "sofa", 5.3, 0, 0)], CATALOG)  # through the side wall
    assert "doorway" in houses.check_layout(lay, [P(1, "armchair", 0, 4.0, 0)], CATALOG)  # front door
    assert "wall" in houses.check_layout(lay, [P(1, "wardrobe", -3, -1.0, 0)], CATALOG)  # in the partition
    assert "on top" in houses.check_layout(lay, [P(1, "armchair", 0, 2, 0), P(2, "armchair", 0.3, 2, 0)], CATALOG)
    # rugs and ceiling fans can sit under other things
    assert houses.check_layout(lay, [P(1, "rug", 0, 2, 0), P(2, "center_table", 0, 2, 0)], CATALOG) is None


def test_houses_come_empty_and_bought_furniture_is_solid(c):  # noqa: F811
    acc, h = reg(c, "decor_a")
    _give_phone(c, acc["player_id"])
    hub = get_maps()["hub_plaza"]
    home = hub.homes[3]
    assert c.post("/api/home/rent", json={"home_id": home["id"], "key": "rent-dec-01"}, headers=h).status_code == 200
    assert c.get("/api/furniture", headers=h).json()["items"] == []  # nothing free: you buy your furniture
    world = c.app.state.world
    # the shop only sells to people standing in it
    with c.websocket_connect(f"/ws?token={acc['token']}") as ws:
        drain(ws)
        s = world.sessions[acc["player_id"]]
        r = c.post("/api/shop/furniture", json={"item": "sofa", "key": "furn-key-00"}, headers=h)
        assert r.status_code == 409
        x0, z0, x1, z1 = hub.zones["furniture_shop"]["rect"]
        s.x, s.z = (x0 + x1) / 2, (z0 + z1) / 2
        r = c.post("/api/shop/furniture", json={"item": "sofa", "key": "furn-key-01"}, headers=h)
        assert r.status_code == 200 and not r.json()["item"]["placed"]
    items = c.get("/api/furniture", headers=h).json()["items"]
    sofa = items[0]
    placed = c.post(
        "/api/home/layout", json={"items": [{**sofa, "lx": -4.7, "lz": 3.0, "rot": 1, "placed": True}]}, headers=h
    )
    assert placed.status_code == 200, placed.text
    assert world.furniture[home["id"]] and world.furniture_boxes[home["id"]]
    b = world.furniture_boxes[home["id"]][0]
    assert collides(
        (b.min_x + b.max_x) / 2, (b.min_z + b.max_z) / 2, 0.35, world.furniture_near(b.min_x, b.min_z, b.max_x, b.max_z)
    )

    # decorate: move the sofa somewhere legal, then try an illegal spot (whole layout is rejected)
    sofa = next(i for i in items if i["item"] == "sofa")
    ok = c.post(
        "/api/home/layout", json={"items": [{**sofa, "lx": -4.7, "lz": 3.0, "rot": 1, "placed": True}]}, headers=h
    )
    assert ok.status_code == 200, ok.text
    bad = c.post(
        "/api/home/layout", json={"items": [{**sofa, "lx": 0.0, "lz": 3.9, "rot": 0, "placed": True}]}, headers=h
    )
    assert bad.status_code == 422 and "doorway" in bad.json()["detail"]
    stored = c.post("/api/home/layout", json={"items": [{**sofa, "placed": False}]}, headers=h).json()
    assert all(i["id"] != sofa["id"] for i in stored["items"])

    other, oh = reg(c, "decor_b")
    assert c.post("/api/home/layout", json={"items": [{**sofa, "placed": True}]}, headers=oh).status_code == 409
