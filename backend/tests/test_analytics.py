import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import msgpack
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import auth
from app.db import Ad, AnalyticsVisit, Game, Player, RoundStat
from app.main import create_app
from app.settings import Settings


def test_admin_analytics_is_protected_and_reports_server_metrics(tmp_path, monkeypatch):
    monkeypatch.setattr("app.analytics.get_settings", lambda: Settings(admin_token="admin-test-token"))
    app = create_app(f"sqlite+aiosqlite:///{tmp_path}/analytics.db", run_tick=False)
    with TestClient(app) as client:
        assert client.get("/api/admin/analytics").status_code == 401
        assert client.get("/api/admin/analytics", headers={"X-Admin-Token": "wrong"}).status_code == 401

        now = datetime.now(UTC)

        async def seed() -> str:
            async with app.state.db.sessions() as session, session.begin():
                player = Player(nickname="Ade", home_area="Yaba", device_secret_hash="test")
                session.add(player)
                await session.flush()
                session.add_all(
                    [
                        AnalyticsVisit(
                            player_id=player.id,
                            started_at=now - timedelta(hours=2),
                            ended_at=now - timedelta(hours=1),
                            duration_seconds=3600,
                        ),
                        AnalyticsVisit(player_id=player.id, started_at=now - timedelta(minutes=2)),
                        Game(
                            id="complete-game", code="DONE", creator_id=player.id, arena_id="arena_park", ended_at=now
                        ),
                        Game(id="active-game", code="LIVE", creator_id=player.id, arena_id="arena_park"),
                        RoundStat(game_id="complete-game", round_no=1, player_id=player.id, role="seeker", finds=3),
                        RoundStat(
                            game_id="complete-game", round_no=1, player_id=player.id, role="hider", not_found=True
                        ),
                    ]
                )
                session.add_all(
                    [
                        Ad(
                            player_id=player.id,
                            map_id="hub_plaza",
                            x=1,
                            y=1,
                            z=1,
                            nx=1,
                            nz=0,
                            w=1,
                            h=1,
                            size="s",
                            price=5000,
                            title="Verified payment",
                            email="ade@example.com",
                            reference="verified-payment",
                            provider="paystack",
                            status="live",
                            paystack_verified=True,
                            image=b"image",
                            image_type="image/jpeg",
                            paid_at=now,
                        ),
                        Ad(
                            player_id=player.id,
                            map_id="hub_plaza",
                            x=2,
                            y=1,
                            z=1,
                            nx=1,
                            nz=0,
                            w=1,
                            h=1,
                            size="s",
                            price=3000,
                            title="Refunded payment",
                            email="ade@example.com",
                            reference="refunded-payment",
                            provider="paystack",
                            status="refunded",
                            paystack_verified=True,
                            image=b"image",
                            image_type="image/jpeg",
                            paid_at=now,
                        ),
                        Ad(
                            player_id=player.id,
                            map_id="hub_plaza",
                            x=3,
                            y=1,
                            z=1,
                            nx=1,
                            nz=0,
                            w=1,
                            h=1,
                            size="s",
                            price=8000,
                            title="Test mode payment",
                            email="ade@example.com",
                            reference="fake-payment",
                            provider="paystack",
                            status="review",
                            paystack_verified=False,
                            image=b"image",
                            image_type="image/jpeg",
                            paid_at=now,
                        ),
                    ]
                )
                return player.id

        player_id = asyncio.run(seed())
        app.state.world.sessions[player_id] = SimpleNamespace(pid=player_id, connected=True, bot=False)
        app.state.world.groups["LIVE"] = SimpleNamespace(phase="seek", humans=[player_id])

        response = client.get("/api/admin/analytics?days=7", headers={"X-Admin-Token": "admin-test-token"})
        assert response.status_code == 200
        data = response.json()
        assert data["totals"] == {
            "players": 1,
            "active_players": 1,
            "new_players": 1,
            "visits": 2,
            "active_visits": 1,
            "plays": 2,
            "completed_plays": 1,
            "current_plays": 1,
            "players_in_current_plays": 1,
        }
        assert len(data["activity"]) == 7
        assert sum(day["visits"] for day in data["activity"]) == 2
        assert data["leaderboards"]["seekers"][0]["score"] == 3
        assert data["leaderboards"]["hiders"][0]["score"] == 1
        assert data["leaderboards"]["playtime"][0]["seconds"] >= 3600
        assert data["arenas"][0]["plays"] == 2
        assert data["ad_revenue"] == {
            "currency": "NGN",
            "confirmed_transactions": 2,
            "gross_collected": 8000,
            "refunded": 3000,
            "net_after_refunds": 5000,
            "note": "Verified Paystack charges only; historical and test-mode payments are excluded.",
        }
        admin = {"X-Admin-Token": "admin-test-token"}
        assert client.get("/api/admin/players").status_code == 401
        directory = client.get("/api/admin/players?q=Ade&limit=1", headers=admin)
        assert directory.status_code == 200
        assert directory.json()["total"] == 1
        assert directory.json()["players"][0]["id"] == player_id
        details = client.get(f"/api/admin/players/{player_id}", headers=admin)
        assert details.status_code == 200
        detail_data = details.json()
        assert detail_data["profile"]["nickname"] == "Ade"
        assert detail_data["activity"]["visits"] == 2
        assert detail_data["gameplay"]["games_played"] == 1
        assert detail_data["ad_payments"]["paystack_confirmed_total"] == 5000
        assert detail_data["ad_payments"]["paystack_refunded_total"] == 3000
        assert "password_hash" not in detail_data["profile"]
        assert "device_secret_hash" not in detail_data["profile"]
        assert (
            client.get("/api/admin/analytics?days=3", headers={"X-Admin-Token": "admin-test-token"}).status_code == 422
        )


def test_websocket_visits_are_recorded_and_closed_when_admin_refreshes(tmp_path, monkeypatch):
    monkeypatch.setattr("app.analytics.get_settings", lambda: Settings(admin_token="admin-test-token"))
    app = create_app(f"sqlite+aiosqlite:///{tmp_path}/visit.db", run_tick=False)
    with TestClient(app) as client:

        async def seed_player() -> str:
            async with app.state.db.sessions() as session, session.begin():
                player = Player(nickname="Bisi", home_area="Yaba", device_secret_hash="test")
                session.add(player)
                await session.flush()
                return player.id

        player_id = asyncio.run(seed_player())
        token = auth.issue_token(player_id)
        with client.websocket_connect(f"/ws?token={token}") as websocket:
            while msgpack.unpackb(websocket.receive_bytes())["t"] != "wallet":
                continue

        response = client.get("/api/admin/analytics", headers={"X-Admin-Token": "admin-test-token"})
        assert response.status_code == 200
        assert response.json()["totals"]["visits"] == 1
        assert response.json()["totals"]["active_visits"] == 0

        async def stored_visit() -> AnalyticsVisit:
            async with app.state.db.sessions() as session:
                return await session.scalar(select(AnalyticsVisit).where(AnalyticsVisit.player_id == player_id))

        visit = asyncio.run(stored_visit())
        assert visit.ended_at is not None and visit.duration_seconds >= 0
