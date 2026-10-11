"""LagosLife mini version: sign-in, ads paid in LagosLife (approve first), webhook, match results."""

import base64
import hashlib
import hmac
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import vatar
from app.main import create_app
from app.settings import get_settings

JPEG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"0" * 2000).decode()
SHOP = {"map_id": "hub_plaza", "x": 14.0, "y": 1.5, "z": 26.0, "nx": 1, "nz": 0}
ADMIN = {"X-Admin-Token": "admin-secret-123"}


class FakeLagosLife:
    """Just enough of https://lagoslife.app/api/games/v1 for the tests."""

    def __init__(self):
        self.sessions = {
            "vtr1.tolu-session": {"playerId": "p_tolu", "name": "Tolu", "mode": "live"},
            "vtr1.ada-session": {"playerId": "p_ada", "name": "Ada", "mode": "live"},
        }
        self.purchases = {}
        self.matches = {}
        self.delivered = []
        self.results = []

    async def call(self, method, path, body=None):
        if path == "/session/verify":
            s = self.sessions.get(body["session"])
            return (200, {**s, "gameId": "g1", "exp": 0}) if s else (401, {"error": "invalid_token"})
        if path.startswith("/purchases/") and path.endswith("/deliver"):
            pid = path.split("/")[2]
            self.purchases[pid]["status"] = "delivered"
            self.delivered.append(pid)
            return 200, {"id": pid, "status": "delivered"}
        if path.startswith("/purchases/"):
            p = self.purchases.get(path.split("/")[2])
            return (200, dict(p)) if p and p["status"] != "pending" else (404, {"error": "not_found"})
        if path.startswith("/matches/"):
            m = self.matches.get(path.split("/")[2])
            return (200, dict(m)) if m else (404, {"error": "not_found"})
        return 404, {}

    async def post_signed(self, url, body, ts, sig):
        self.results.append((url, json.loads(body), ts, sig))
        return 200, "{}"


@pytest.fixture
def ll(monkeypatch):
    fake = FakeLagosLife()
    monkeypatch.setattr(vatar, "call", fake.call)
    monkeypatch.setattr(vatar, "post_signed", fake.post_signed)
    return fake


@pytest.fixture
def c(tmp_path, monkeypatch, ll):
    monkeypatch.setenv("VATAR_SECRET", "vtr_live_dummy")
    monkeypatch.setenv("VATAR_WEBHOOK_SECRET", "vtr_whsec_live_dummy")
    monkeypatch.setenv("VATAR_RESULTS_SECRET", "results-secret")
    monkeypatch.setenv("ADMIN_TOKEN", "admin-secret-123")
    get_settings.cache_clear()
    with TestClient(create_app(f"sqlite+aiosqlite:///{tmp_path}/ll.db", run_tick=False)) as client:
        yield client
    get_settings.cache_clear()


def sign_in(c, session="vtr1.tolu-session"):
    r = c.post("/api/vatar/session", json={"session": session})
    assert r.status_code == 200, r.text
    return r.json()


def auth(s):
    return {"Authorization": f"Bearer {s['token']}"}


def test_sign_in_makes_one_mini_account_without_password_or_email(c, ll):
    a = sign_in(c)
    b = sign_in(c)
    assert a["player_id"] == b["player_id"] and a["username"].startswith("ll_")
    me = c.get("/api/me", headers=auth(b)).json()
    assert me["nickname"] == "Tolu" and me["email"] is None and not me["must_change_password"]
    assert a["player_id"] in c.app.state.world.mini
    # nobody knows a mini account's password, so it can't be used on our own site
    assert c.post("/api/auth/login", json={"login": a["username"], "password": "Suya-Night-42"}).status_code == 401
    # a renamed LagosLife player keeps the same account
    ll.sessions["vtr1.tolu-session"]["name"] = "Tolu B"
    assert sign_in(c)["nickname"] == "Tolu B"
    assert c.post("/api/vatar/session", json={"session": "vtr1.forged-token"}).status_code == 401


def test_ad_is_approved_first_then_paid_in_lagoslife(c, ll):
    s = sign_in(c)
    r = c.post("/api/ads", json={**SHOP, "size": "m", "title": "Tolu Phones", "image": JPEG}, headers=auth(s))
    assert r.status_code == 200, r.text
    ad = r.json()
    assert ad["status"] == "review" and ad["product"] == "ad_m" and "pay_url" not in ad
    assert c.get("/api/ads/map/hub_plaza").json()["taken"]  # the spot is held while we review it

    assert c.post(f"/api/admin/ads/{ad['id']}/approve", headers=ADMIN).json()["status"] == "approved"
    mine = c.get("/api/ads/mine", headers=auth(s)).json()["ads"]
    assert mine[0]["status"] == "approved" and mine[0]["provider"] == "vatar"

    # paying with someone else's purchase, or too little, does nothing
    ll.purchases["pu_other"] = {"id": "pu_other", "productId": "ad_m", "playerId": "p_ada", "amount": 10000,
                                "currency": "NGN", "status": "paid"}  # fmt: skip
    claim = {"session": "vtr1.tolu-session", "ad_id": ad["id"]}
    assert c.post("/api/vatar/ads/claim", json={**claim, "purchase_id": "pu_other"}, headers=auth(s)).status_code == 404
    ll.purchases["pu_cheap"] = {"id": "pu_cheap", "productId": "ad_m", "playerId": "p_tolu", "amount": 100,
                                "currency": "NGN", "status": "paid"}  # fmt: skip
    assert c.post("/api/vatar/ads/claim", json={**claim, "purchase_id": "pu_cheap"}, headers=auth(s)).status_code == 409

    ll.purchases["pu_1"] = {"id": "pu_1", "productId": "ad_m", "playerId": "p_tolu", "amount": 10000,
                            "currency": "NGN", "status": "paid"}  # fmt: skip
    r = c.post("/api/vatar/ads/claim", json={**claim, "purchase_id": "pu_1"}, headers=auth(s))
    assert r.status_code == 200 and r.json()["status"] == "live"
    assert ll.delivered == ["pu_1"]
    assert [a["id"] for a in c.get("/api/ads/map/hub_plaza").json()["live"]] == [ad["id"]]
    # claiming the same purchase again is harmless
    assert c.post("/api/vatar/ads/claim", json={**claim, "purchase_id": "pu_1"}, headers=auth(s)).status_code == 200


def test_rejecting_an_unpaid_lagoslife_ad_needs_no_refund(c, ll):
    s = sign_in(c)
    ad = c.post("/api/ads", json={**SHOP, "size": "s", "title": "Ada Hair", "image": JPEG}, headers=auth(s)).json()
    assert c.post(f"/api/admin/ads/{ad['id']}/reject", headers=ADMIN).json()["status"] == "rejected"
    assert c.get("/api/ads/map/hub_plaza").json()["taken"] == []


def test_webhook_needs_signature_and_settles_the_purchase(c, ll):
    s = sign_in(c)
    ad = c.post("/api/ads", json={**SHOP, "size": "s", "title": "Suya Spot", "image": JPEG}, headers=auth(s)).json()
    c.post(f"/api/admin/ads/{ad['id']}/approve", headers=ADMIN)
    ll.purchases["pu_w"] = {"id": "pu_w", "productId": "ad_s", "playerId": "p_tolu", "amount": 5000,
                            "currency": "NGN", "status": "paid"}  # fmt: skip
    raw = json.dumps({"id": "evt_1", "type": "purchase.paid", "data": {"purchaseId": "pu_w"}}).encode()
    assert c.post("/api/vatar/webhook", content=raw, headers={"X-Vatar-Signature": "sha256=nope"}).status_code == 401
    sig = "sha256=" + hmac.new(b"vtr_whsec_live_dummy", raw, hashlib.sha256).hexdigest()
    assert c.post("/api/vatar/webhook", content=raw, headers={"X-Vatar-Signature": sig}).status_code == 200
    assert c.get("/api/ads/mine", headers=auth(s)).json()["ads"][0]["status"] == "live"


def test_match_links_to_one_game_and_posts_a_signed_winner(c, ll):
    tolu, ada = sign_in(c), sign_in(c, "vtr1.ada-session")
    world = c.app.state.world
    ll.matches["m1"] = {"id": "m1", "status": "open", "mode": "live", "nonce": "n0nce",
                        "players": [{"playerId": "p_tolu"}, {"playerId": "p_ada"}]}  # fmt: skip
    body = {"session": "vtr1.tolu-session", "match_id": "m1"}
    # first in creates the lobby; the other waits for its code
    assert c.post("/api/vatar/match", json=body, headers=auth(tolu)).json() == {"group_code": None, "create": True}
    ada_body = {"session": "vtr1.ada-session", "match_id": "m1"}
    assert c.post("/api/vatar/match", json=ada_body, headers=auth(ada)).json()["create"] is False
    world.groups["ABCDEF"] = SimpleNamespace(code="ABCDEF", id="game1", creator=tolu["player_id"], public=True)
    r = c.post("/api/vatar/match", json={**body, "group_code": "ABCDEF"}, headers=auth(tolu)).json()
    assert r["group_code"] == "ABCDEF" and world.groups["ABCDEF"].public is False
    assert c.post("/api/vatar/match", json=ada_body, headers=auth(ada)).json()["group_code"] == "ABCDEF"
    # someone outside the match can't see it
    ll.sessions["vtr1.bayo-session"] = {"playerId": "p_bayo", "name": "Bayo", "mode": "live"}
    bayo = sign_in(c, "vtr1.bayo-session")
    outsider = {**body, "session": "vtr1.bayo-session"}
    assert c.post("/api/vatar/match", json=outsider, headers=auth(bayo)).status_code == 404

    ll.matches["m1"]["status"] = "playing"
    results = [
        {"id": ada["player_id"], "earned": 900, "finds": 2, "survived": 1},
        {"id": tolu["player_id"], "earned": 300, "finds": 1, "survived": 0},
    ]
    hook = world.game_over_hooks[-1]
    c.portal.call(hook.post_result, "game1", results)
    url, sent, ts, sig = ll.results[0]
    assert url.endswith("/api/games/v1/matches/m1/result") and sent == {"winner": "p_ada"}
    raw = json.dumps(sent, separators=(",", ":")).encode()
    msg = "\n".join(["POST", "/api/games/v1/matches/m1/result", ts, "n0nce", hashlib.sha256(raw).hexdigest()])
    assert sig == "v1=" + hmac.new(b"results-secret", msg.encode(), hashlib.sha256).hexdigest()
    c.portal.call(hook.post_result, "game1", results)  # settled once
    assert len(ll.results) == 1


def test_mini_players_never_get_a_paystack_link(c, ll):
    s = sign_in(c)
    products = {k: f"ad_{k}" for k in ("s", "m", "l", "xl")}
    assert c.get("/api/vatar/config").json() == {"enabled": True, "products": products}
    r = c.post("/api/ads", json={**SHOP, "size": "xl", "title": "Big Brand", "image": JPEG}, headers=auth(s)).json()
    assert "pay_url" not in r
