import msgpack
from fastapi.testclient import TestClient

from app.content import get_config
from app.main import create_app


def test_content_health_and_websocket(tmp_path):
    app = create_app(f"sqlite+aiosqlite:///{tmp_path}/api.db", run_tick=False)
    with TestClient(app) as client:
        assert client.get("/health").json()["ok"]
        bad = {"username": "fuck", "password": "Good-Pass-1", "home_area": "Yaba"}
        assert client.post("/api/auth/register", json=bad).status_code == 422
        bad = {"username": "Ade", "password": "Good-Pass-1", "home_area": "Paris"}
        assert client.post("/api/auth/register", json=bad).status_code == 422
        r = client.post("/api/auth/register", json={"username": "Ade", "password": "Good-Pass-1", "home_area": "Yaba"})
        r = r.json()
        h = {"Authorization": f"Bearer {r['token']}"}
        me = client.get("/api/me", headers=h).json()
        start = get_config().economy.starting_balance
        assert me["username"] == "Ade" and me["balance"] == start + me["daily_bonus"] + me["topup"]
        assert client.get("/api/me").status_code == 401
        content = client.get("/api/content").json()
        assert "arena_park" in content["maps"]
        assert content["config"]["scoring"]["hider_not_found"] == get_config().scoring.hider_not_found
        assert client.get("/api/leaderboards?kind=hider&period=all").json()["rows"] == []
        wallet = client.get("/api/wallet", headers=h).json()
        assert wallet["balance"] == sum(e["amount"] for e in wallet["entries"])
        assert "not real money" in wallet["disclaimer"]
        with client.websocket_connect(f"/ws?token={r['token']}") as ws:
            hello = msgpack.unpackb(ws.receive_bytes())
            assert hello["t"] == "hello" and hello["me"]["nick"] == "Ade"
            # wait for the end of the connect handshake (wallet) before closing, like a real client
            while msgpack.unpackb(ws.receive_bytes())["t"] != "wallet":
                pass


def test_ws_rejects_bad_token(tmp_path):
    app = create_app(f"sqlite+aiosqlite:///{tmp_path}/api.db", run_tick=False)
    with TestClient(app) as client:
        try:
            with client.websocket_connect("/ws?token=nope") as ws:
                ws.receive_bytes()
            raise AssertionError("should have closed")
        except Exception as e:  # noqa: BLE001
            assert "4001" in str(e) or "WebSocketDisconnect" in type(e).__name__


def test_route_endpoint_falls_back_when_offline(tmp_path, monkeypatch):
    import app.routes as routes

    async def boom(*a, **k):
        raise RuntimeError("offline")

    monkeypatch.setattr(routes.httpx.AsyncClient, "get", boom)
    app = create_app(f"sqlite+aiosqlite:///{tmp_path}/api.db", run_tick=False)
    with TestClient(app) as client:
        r = client.get("/api/route?home=Yaba&arena=arena_park&mode=danfo").json()
        assert r["source"] == "arc" and len(r["coords"]) > 10
        assert r["coords"][0] == [3.3711, 6.5095] and r["to"]["name"].startswith("Freedom Park")
        f = client.get("/api/route?home=Lekki&arena=arena_abuja&mode=flight").json()
        assert f["source"] == "arc" and abs(f["coords"][-1][1] - 9.0703) < 1e-3
        assert client.get("/api/route?home=Paris&arena=arena_park").status_code == 404


async def test_route_cache_is_used(db):
    from app.db import RouteCache
    from app.routes import get_route

    async with db.sessions() as s, s.begin():
        s.add(RouteCache(key="road:Yaba:arena_park", coords=[[3.37, 6.5], [3.39, 6.45]]))
    coords, source = await get_route(db.sessions, (3.37, 6.5), (3.39, 6.45), "road:Yaba:arena_park", "road")
    assert source == "cache" and coords == [[3.37, 6.5], [3.39, 6.45]]
