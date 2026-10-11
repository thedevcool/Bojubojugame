from datetime import datetime

import msgpack
import pytest
from fastapi.testclient import TestClient

from app.content import get_maps
from app.main import create_app

PW = "Jollof-2026"


@pytest.fixture
def c(tmp_path):
    with TestClient(create_app(f"sqlite+aiosqlite:///{tmp_path}/life.db", run_tick=False)) as client:
        yield client


def reg(c, name):
    r = c.post("/api/auth/register", json={"username": name, "password": PW, "home_area": "Yaba"}).json()
    return r, {"Authorization": f"Bearer {r['token']}"}


def drain(ws):
    while msgpack.unpackb(ws.receive_bytes())["t"] != "wallet":
        pass


def test_phone_then_house_then_spawn_at_home(c):
    r, h = reg(c, "Newbie")
    hub = get_maps()["hub_plaza"]
    world = c.app.state.world
    me0 = c.get("/api/me", headers=h).json()
    assert me0["phone_id"] is None and me0["home_id"] is None
    with c.websocket_connect(f"/ws?token={r['token']}") as ws:
        hello = msgpack.unpackb(ws.receive_bytes())
        assert hello["home"] is None
        drain(ws)
        s = world.sessions[r["player_id"]]
        assert (round(s.x, 1), round(s.z, 1)) == tuple(round(v, 1) for v in hub.newcomer)  # beside the phone shop
        # renting needs a phone
        assert (
            c.post("/api/home/rent", json={"home_id": hub.homes[0]["id"], "key": "rent-key-1"}, headers=h).status_code
            == 409
        )
        # phone only at the shop
        s.x, s.z = 0.0, -40.0
        assert c.post("/api/shop/phone", json={"phone_id": "pro", "key": "phone-key-1"}, headers=h).status_code == 409
        x0, z0, x1, z1 = hub.zones["phone_shop"]["rect"]
        s.x, s.z = (x0 + x1) / 2, (z0 + z1) / 2
        assert c.post("/api/shop/phone", json={"phone_id": "pro", "key": "phone-key-1"}, headers=h).json()["ok"]
        homes = c.get("/api/homes", headers=h).json()
        target = homes["homes"][2]
        res = c.post("/api/home/rent", json={"home_id": target["id"], "key": "rent-key-1"}, headers=h).json()
        first_until = datetime.fromisoformat(res["rent_until"])
        while (m := msgpack.unpackb(ws.receive_bytes()))["t"] != "home":
            pass
        assert m["home"]["id"] == target["id"]
        res2 = c.post("/api/home/rent", json={"home_id": target["id"], "key": "rent-key-2"}, headers=h).json()
        assert (datetime.fromisoformat(res2["rent_until"]) - first_until).days == 7  # renewing extends
    me = c.get("/api/me", headers=h).json()
    assert me["phone_id"] == "pro" and me["home_id"] == target["id"]
    spent = me0["balance"] - me["balance"]
    assert spent == 450000 + 2 * target["rent"]
    assert c.get("/api/homes", headers=h).json()["homes"][2]["tenants"] == 1
    # next login: you wake up inside your house
    world.sessions.clear()
    with c.websocket_connect(f"/ws?token={r['token']}") as ws:
        assert msgpack.unpackb(ws.receive_bytes())["home"]["id"] == target["id"]
        drain(ws)
        s = world.sessions[r["player_id"]]
        home = hub.home_by_id(target["id"])
        assert (s.x, s.z) == tuple(home["spawn"])


def test_friends_and_direct_messages(c):
    a, ha = reg(c, "Ada")
    b, hb = reg(c, "Bayo")
    e, he = reg(c, "Eke")
    assert c.post("/api/dm/" + b["player_id"], json={"text": "hi"}, headers=ha).status_code == 403  # strangers
    assert c.post("/api/friends/request", json={"username": "bayo"}, headers=ha).json()["status"] == "pending"
    assert c.get("/api/friends", headers=hb).json()["incoming"][0]["username"] == "Ada"
    assert c.post("/api/friends/respond", json={"player_id": a["player_id"], "accept": True}, headers=hb).json()["ok"]
    assert c.get("/api/friends", headers=ha).json()["friends"][0]["username"] == "Bayo"
    sent = c.post("/api/dm/" + b["player_id"], json={"text": "Boju later? Join my game: ABC123"}, headers=ha).json()
    assert sent["mine"]
    assert c.get("/api/friends", headers=hb).json()["friends"][0]["unread"] == 1
    hist = c.get("/api/dm/" + a["player_id"], headers=hb).json()["messages"]
    assert hist[0]["text"].endswith("ABC123") and hist[0]["mine"] is False
    assert c.get("/api/friends", headers=hb).json()["friends"][0]["unread"] == 0  # opening marks read
    assert c.post("/api/dm/" + b["player_id"], json={"text": "visit www.scam.com"}, headers=ha).status_code == 422
    # both ask each other -> instantly friends
    c.post("/api/friends/request", json={"username": "Eke"}, headers=hb)
    assert c.post("/api/friends/request", json={"username": "Bayo"}, headers=he).json()["status"] == "accepted"
    c.post("/api/friends/remove", json={"player_id": a["player_id"]}, headers=hb)
    assert c.post("/api/dm/" + b["player_id"], json={"text": "hello?"}, headers=ha).status_code == 403


def test_player_card_shows_points_and_relation(c):
    (a, ha), (b, hb) = reg(c, "card_a"), reg(c, "card_b")
    r = c.get(f"/api/players/{b['player_id']}/card", headers=ha)
    assert r.status_code == 200
    card = r.json()
    assert card["username"] == "card_b" and card["points"] == 0 and card["relation"] == "none"
    c.post("/api/friends/request", json={"username": "card_b"}, headers=ha)
    assert c.get(f"/api/players/{b['player_id']}/card", headers=ha).json()["relation"] == "requested"
    assert c.get(f"/api/players/{a['player_id']}/card", headers=hb).json()["relation"] == "incoming"
    assert c.get("/api/players/nope/card", headers=ha).status_code == 404
