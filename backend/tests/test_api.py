import msgpack
from fastapi.testclient import TestClient

from app.main import create_app


def test_guest_flow_and_websocket(tmp_path):
    app = create_app(f"sqlite+aiosqlite:///{tmp_path}/api.db", run_tick=False)
    with TestClient(app) as client:
        assert client.get("/health").json()["ok"]
        assert client.post("/api/auth/guest", json={"nickname": "fuck", "home_area": "Yaba"}).status_code == 422
        assert client.post("/api/auth/guest", json={"nickname": "Ade", "home_area": "Paris"}).status_code == 422
        r = client.post("/api/auth/guest", json={"nickname": "Ade <b>", "home_area": "Yaba"}).json()
        h = {"Authorization": f"Bearer {r['token']}"}
        me = client.get("/api/me", headers=h).json()
        assert me["nickname"] == "Ade b" and me["balance"] == 20000 + me["daily_bonus"]
        assert client.get("/api/me").status_code == 401
        assert (
            client.post(
                "/api/auth/refresh", json={"player_id": r["player_id"], "device_secret": r["device_secret"]}
            ).status_code
            == 200
        )
        assert (
            client.post("/api/auth/refresh", json={"player_id": r["player_id"], "device_secret": "x" * 30}).status_code
            == 401
        )
        content = client.get("/api/content").json()
        assert "arena_park" in content["maps"] and content["config"]["scoring"]["hider_not_found"] == 7500
        assert client.get("/api/leaderboards?kind=hider&period=all").json()["rows"] == []
        wallet = client.get("/api/wallet", headers=h).json()
        assert wallet["balance"] == sum(e["amount"] for e in wallet["entries"])
        assert "not real money" in wallet["disclaimer"]

        with client.websocket_connect(f"/ws?token={r['token']}") as ws:
            hello = msgpack.unpackb(ws.receive_bytes())
            assert hello["t"] == "hello" and hello["me"]["nick"] == "Ade b"
            ws.send_bytes(msgpack.packb({"t": "ping"}))
            seen = {msgpack.unpackb(ws.receive_bytes())["t"] for _ in range(4)}
            assert "pong" in seen or "wallet" in seen


def test_ws_rejects_bad_token(tmp_path):
    app = create_app(f"sqlite+aiosqlite:///{tmp_path}/api.db", run_tick=False)
    with TestClient(app) as client:
        try:
            with client.websocket_connect("/ws?token=nope") as ws:
                ws.receive_bytes()
            raise AssertionError("should have closed")
        except Exception as e:  # noqa: BLE001
            assert "4001" in str(e) or "WebSocketDisconnect" in type(e).__name__
