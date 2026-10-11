import sqlite3

import msgpack
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import auth
from app.content import get_config
from app.main import create_app

PW = "Jollof-2026"


@pytest.fixture
def c(tmp_path):
    with TestClient(create_app(f"sqlite+aiosqlite:///{tmp_path}/acc.db", run_tick=False)) as client:
        yield client


def reg(c, username="Tolu", password=PW, email=None):
    return c.post(
        "/api/auth/register", json={"username": username, "password": password, "email": email, "home_area": "Yaba"}
    )


def bearer(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_no_way_to_create_an_account_without_a_password(c):
    assert c.post("/api/auth/guest", json={"nickname": "Sneaky", "home_area": "Yaba"}).status_code in (404, 405)
    assert c.post("/api/auth/register", json={"username": "Sneaky", "home_area": "Yaba"}).status_code == 422
    assert reg(c, "Sneaky", password="").status_code == 422
    assert reg(c, "Sneaky", password="short").status_code == 422
    assert reg(c, "Sneaky", password="password").status_code == 422
    assert reg(c, "Sneaky", password="sneaky1234").status_code == 422  # contains the username


def test_register_login_and_unique_usernames(c):
    r = reg(c, email="Tolu@Example.com").json()
    assert r["username"] == "Tolu" and r["must_change_password"] is False
    me = c.get("/api/me", headers=bearer(r["token"])).json()
    assert me["email"] == "tolu@example.com" and me["balance"] >= get_config().economy.starting_balance
    assert reg(c, "tolu").status_code == 409  # case-insensitive
    assert reg(c, "Ada", email="tolu@example.com").status_code == 409
    # log in on another phone with username OR email; both phones stay signed in
    for login in ("TOLU", "tolu@example.com"):
        new = c.post("/api/auth/login", json={"login": login, "password": PW}).json()
        assert new["player_id"] == r["player_id"]
        ok = c.post("/api/auth/refresh", json={"player_id": r["player_id"], "device_secret": new["device_secret"]})
        assert ok.status_code == 200
    old = c.post("/api/auth/refresh", json={"player_id": r["player_id"], "device_secret": r["device_secret"]})
    assert old.status_code == 200
    assert c.post("/api/auth/login", json={"login": "Tolu", "password": "wrong-pass"}).status_code == 401


def test_lockout_after_five_wrong_passwords(c):
    reg(c, "Ada")
    codes = [c.post("/api/auth/login", json={"login": "Ada", "password": "nope-nope"}).status_code for _ in range(5)]
    assert codes == [401] * 5
    locked = c.post("/api/auth/login", json={"login": "Ada", "password": PW})
    assert locked.status_code == 429 and "Try again" in locked.json()["detail"]


def test_change_password_and_email(c):
    r = reg(c, "Femi").json()
    h = bearer(r["token"])
    assert (
        c.post(
            "/api/auth/password", json={"current_password": "bad", "new_password": "Suya-Night-1"}, headers=h
        ).status_code
        == 403
    )
    assert c.post(
        "/api/auth/password", json={"current_password": PW, "new_password": "Suya-Night-1"}, headers=h
    ).json()["ok"]
    assert c.post("/api/auth/login", json={"login": "Femi", "password": "Suya-Night-1"}).status_code == 200
    assert c.post("/api/auth/email", json={"email": "femi@x.ng", "password": "wrong"}, headers=h).status_code == 403
    assert (
        c.post("/api/auth/email", json={"email": "femi@x.ng", "password": "Suya-Night-1"}, headers=h).json()["email"]
        == "femi@x.ng"
    )


def test_forgot_and_reset_by_email(c, monkeypatch):
    sent = []

    async def fake_send(to, subject, body):
        sent.append((to, body))
        return True

    monkeypatch.setattr("app.accounts.send_email", fake_send)
    r = reg(c, "Kemi", email="kemi@x.ng").json()
    reg(c, "NoMail")
    # same answer whether or not the account exists / has an email
    answers = {c.post("/api/auth/forgot", json={"login": x}).json()["message"] for x in ("kemi", "NoMail", "ghost")}
    assert len(answers) == 1 and len(sent) == 1 and sent[0][0] == "kemi@x.ng"
    token = sent[0][1].split("token=")[1].split()[0]
    assert c.post("/api/auth/reset", json={"token": token, "new_password": "short"}).status_code == 422
    assert c.post("/api/auth/reset", json={"token": token, "new_password": "Amala-Ewedu-9"}).json()["ok"]
    assert c.post("/api/auth/reset", json={"token": token, "new_password": "Amala-Ewedu-10"}).status_code == 400
    assert c.post("/api/auth/login", json={"login": "kemi@x.ng", "password": "Amala-Ewedu-9"}).status_code == 200
    # the reset signed out the old phone
    old = c.post("/api/auth/refresh", json={"player_id": r["player_id"], "device_secret": r["device_secret"]})
    assert old.status_code == 401


def test_legacy_player_must_change_123456_before_playing(tmp_path):
    """The one pre-password account: username from nickname, password 123456, forced change."""
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE players (id VARCHAR(32) PRIMARY KEY, nickname VARCHAR(24), home_area VARCHAR(40), "
        "device_secret_hash VARCHAR(128), avatar JSON, hunger FLOAT, hunger_at DATETIME, created_at DATETIME)"
    )
    con.execute(
        "INSERT INTO players VALUES "
        "('p1', 'Big Tunde', 'Yaba', 'x', '[0,0,0]', 80, '2026-10-01 00:00:00', '2026-10-01 00:00:00')"
    )
    con.commit()
    con.close()
    with TestClient(create_app(f"sqlite+aiosqlite:///{path}", run_tick=False)) as c:
        r = c.post("/api/auth/login", json={"login": "big_tunde", "password": auth.LEGACY_TEMP_PASSWORD}).json()
        assert r["must_change_password"] is True and r["username"] == "big_tunde"
        h = bearer(r["token"])
        assert c.get("/api/me", headers=h).json()["must_change_password"] is True
        # blocked from the game and every other API until the password changes
        assert c.get("/api/wallet", headers=h).status_code == 403
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect(f"/ws?token={r['token']}") as ws:
                ws.receive_bytes()
        assert (
            c.post(
                "/api/auth/password", json={"current_password": "123456", "new_password": "123456"}, headers=h
            ).status_code
            == 422
        )
        done = c.post(
            "/api/auth/password", json={"current_password": "123456", "new_password": "Tunde-Strong-77"}, headers=h
        ).json()
        h2 = bearer(done["token"])
        assert c.get("/api/wallet", headers=h2).status_code == 200
        with c.websocket_connect(f"/ws?token={done['token']}") as ws:
            assert msgpack.unpackb(ws.receive_bytes())["t"] == "hello"
            while msgpack.unpackb(ws.receive_bytes())["t"] != "wallet":
                pass
        assert c.post("/api/auth/login", json={"login": "big_tunde", "password": "123456"}).status_code == 401
