import sqlite3

from fastapi.testclient import TestClient

from app.main import create_app


def _client(tmp_path, name="login.db"):
    return TestClient(create_app(f"sqlite+aiosqlite:///{tmp_path}/{name}", run_tick=False))


def test_pin_login_on_a_new_phone(tmp_path):
    with _client(tmp_path) as c:
        r = c.post("/api/auth/guest", json={"nickname": "Tolu", "home_area": "Yaba"}).json()
        h = {"Authorization": f"Bearer {r['token']}"}
        me = c.get("/api/me", headers=h).json()
        assert me["boju_id"].startswith("Tolu#") and len(me["boju_id"]) == 9 and me["has_pin"] is False
        # can't log in before a PIN is set
        assert c.post("/api/auth/login", json={"boju_id": me["boju_id"], "pin": "123456"}).status_code == 401
        assert c.post("/api/auth/pin", json={"pin": "12345"}, headers=h).status_code == 422
        assert c.post("/api/auth/pin", json={"pin": "246810"}, headers=h).json()["boju_id"] == me["boju_id"]
        assert c.get("/api/me", headers=h).json()["has_pin"] is True
        # changing the PIN needs the current one
        assert c.post("/api/auth/pin", json={"pin": "111111"}, headers=h).status_code == 403
        # new phone: Boju ID is case-insensitive on the nickname
        new = c.post("/api/auth/login", json={"boju_id": me["boju_id"].lower(), "pin": "246810"}).json()
        assert new["player_id"] == r["player_id"] and new["device_secret"] != r["device_secret"]
        # both phones stay logged in
        for secret in (r["device_secret"], new["device_secret"]):
            assert (
                c.post("/api/auth/refresh", json={"player_id": r["player_id"], "device_secret": secret}).status_code
                == 200
            )
        assert c.get("/api/me", headers={"Authorization": f"Bearer {new['token']}"}).json()["balance"] == me["balance"]


def test_wrong_pins_lock_the_account(tmp_path):
    with _client(tmp_path) as c:
        r = c.post("/api/auth/guest", json={"nickname": "Ada", "home_area": "Ikeja"}).json()
        h = {"Authorization": f"Bearer {r['token']}"}
        bid = c.post("/api/auth/pin", json={"pin": "135790"}, headers=h).json()["boju_id"]
        codes = []
        for _ in range(5):
            codes.append(c.post("/api/auth/login", json={"boju_id": bid, "pin": "000000"}).status_code)
        assert codes == [401] * 5
        locked = c.post("/api/auth/login", json={"boju_id": bid, "pin": "135790"})
        assert locked.status_code in (429,) and "Try again" in locked.json()["detail"]


def test_same_nickname_gets_different_tags(tmp_path):
    with _client(tmp_path) as c:
        ids = set()
        for _ in range(3):
            r = c.post("/api/auth/guest", json={"nickname": "Femi", "home_area": "Yaba"}).json()
            ids.add(c.get("/api/me", headers={"Authorization": f"Bearer {r['token']}"}).json()["boju_id"])
        assert len(ids) == 3


def test_old_database_gets_new_columns(tmp_path):
    """A live DB created before logins existed is upgraded in place on boot."""
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE players (id VARCHAR(32) PRIMARY KEY, nickname VARCHAR(24), home_area VARCHAR(40), "
        "device_secret_hash VARCHAR(128), avatar JSON, hunger FLOAT, hunger_at DATETIME, created_at DATETIME)"
    )
    con.execute(
        "INSERT INTO players VALUES "
        "('p1', 'Oldie', 'Yaba', 'x', '[0,0,0]', 80, '2026-10-01 00:00:00', '2026-10-01 00:00:00')"
    )
    con.commit()
    con.close()
    from app import auth

    with TestClient(create_app(f"sqlite+aiosqlite:///{path}", run_tick=False)) as c:
        h = {"Authorization": f"Bearer {auth.issue_token('p1')}"}
        me = c.get("/api/me", headers=h).json()
        assert me["nickname"] == "Oldie" and me["boju_id"].startswith("Oldie#") and me["has_pin"] is False
    cols = {row[1] for row in sqlite3.connect(path).execute("PRAGMA table_info(players)")}
    assert {"tag", "pin_hash", "failed_logins", "locked_until"} <= cols
