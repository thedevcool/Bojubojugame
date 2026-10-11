"""Wall ads: placement rules, payment (fake mode) -> review -> live, webhook signatures, admin only."""

import base64
import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import get_settings

JPEG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"0" * 2000).decode()
SHOP = {"map_id": "hub_plaza", "x": 14.0, "y": 1.5, "z": 26.0, "nx": 1, "nz": 0}  # back wall of Tini Tech


@pytest.fixture
def c(tmp_path, monkeypatch):
    monkeypatch.setenv("ADS_FAKE_PAYMENTS", "true")
    monkeypatch.setenv("ADMIN_TOKEN", "admin-secret-123")
    monkeypatch.setenv("PAYSTACK_SECRET_KEY", "sk_test_dummy")
    get_settings.cache_clear()
    with TestClient(create_app(f"sqlite+aiosqlite:///{tmp_path}/ads.db", run_tick=False)) as client:
        yield client
    get_settings.cache_clear()


def reg(c, name):
    r = c.post("/api/auth/register", json={"username": name, "password": "Suya-Night-42", "home_area": "Yaba"}).json()
    return {"Authorization": f"Bearer {r['token']}"}


def ad(c, h, **kw):
    body = {**SHOP, "size": "m", "title": "Mama Put Ventures", "email": "boss@example.com", "image": JPEG, **kw}
    return c.post("/api/ads", json=body, headers=h)


def test_place_pay_review_go_live_and_no_overlaps(c):
    h = reg(c, "adbuyer")
    assert c.get("/api/ads/config").json()["sizes"][0]["price"] == 5000
    # not on a player's house
    house = ad(c, h, x=-68.0, z=21.85, nx=0, nz=-1)
    assert house.status_code == 422 and "houses" in house.json()["detail"]
    # too big for this wall
    assert ad(c, h, size="xl", y=1.0).status_code == 422  # would poke into the ground
    r = ad(c, h)
    assert r.status_code == 200, r.text
    ref = r.json()["reference"]
    # the spot is held, even before payment: another ad can't cover it
    assert ad(c, h, z=26.5, size="s").status_code == 409
    assert ad(c, h, z=24.2, size="s").status_code == 200  # beside it is fine
    v = c.get(f"/api/ads/verify?reference={ref}", headers=h).json()
    assert v["status"] == "review"
    assert c.get("/api/ads/map/hub_plaza").json()["live"] == []  # waits for approval
    # admin only
    assert c.get("/api/admin/ads").status_code == 401
    admin = {"X-Admin-Token": "admin-secret-123"}
    queue = c.get("/api/admin/ads", headers=admin).json()["ads"]
    ad_id = next(a["id"] for a in queue if a["status"] == "review" and a["size"] == "m")
    assert c.get(f"/api/ads/{ad_id}/image").status_code == 404  # not public until live
    assert c.get(f"/api/ads/{ad_id}/image", headers={"X-Admin-Token": "admin-secret-123"}).status_code == 200
    assert c.post(f"/api/admin/ads/{ad_id}/approve", headers=admin).json()["status"] == "live"
    live = c.get("/api/ads/map/hub_plaza").json()["live"]
    assert [a["id"] for a in live] == [ad_id]
    img = c.get(live[0]["image"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"


def test_bad_images_and_webhook_signature(c):
    h = reg(c, "adbuyer2")
    assert ad(c, h, image=base64.b64encode(b"<svg></svg>").decode()).status_code == 422
    assert ad(c, h, image="not base64!!").status_code == 422
    body = json.dumps({"event": "charge.success", "data": {"reference": "bojuad_x", "amount": 1, "currency": "NGN"}})
    assert c.post("/api/paystack/webhook", content=body, headers={"x-paystack-signature": "nope"}).status_code == 401
    sig = hmac.new(b"sk_test_dummy", body.encode(), hashlib.sha512).hexdigest()
    headers = {"x-paystack-signature": sig, "content-type": "application/json"}
    ok = c.post("/api/paystack/webhook", content=body, headers=headers)
    assert ok.status_code == 200
