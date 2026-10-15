"""Admin-only product and game analytics assembled from server-owned records."""

from __future__ import annotations

import hmac
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Query
from sqlalchemy import case, func, select

from app.db import AnalyticsVisit, Database, Game, Player, RoundStat
from app.realtime.world import World
from app.settings import get_settings


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


async def close_abandoned_visits(db: Database) -> None:
    """Close sessions left open by a process restart; in-memory sockets no longer exist."""
    now = datetime.now(UTC)
    async with db.sessions() as session, session.begin():
        rows = (await session.scalars(select(AnalyticsVisit).where(AnalyticsVisit.ended_at.is_(None)))).all()
        for visit in rows:
            visit.ended_at = now
            visit.duration_seconds = max(0, int((now - _aware(visit.started_at)).total_seconds()))


def make_router(db: Database, world: World, maps: dict[str, Any]) -> APIRouter:
    router = APIRouter(prefix="/api")

    def require_admin(token: str) -> None:
        expected = get_settings().admin_token
        if not expected or not hmac.compare_digest(token, expected):
            raise HTTPException(401, "Admin only")

    @router.get("/admin/analytics")
    async def admin_analytics(
        days: Annotated[int, Query(ge=7, le=90)] = 14,
        x_admin_token: Annotated[str, Header()] = "",
    ) -> dict[str, Any]:
        require_admin(x_admin_token)
        now = datetime.now(UTC)
        start = datetime.combine(now.date() - timedelta(days=days - 1), datetime.min.time(), tzinfo=UTC)
        connected_player_ids = {player.pid for player in world.sessions.values() if player.connected and not player.bot}
        async with db.sessions() as session:
            unclosed_visits = (
                await session.scalars(select(AnalyticsVisit).where(AnalyticsVisit.ended_at.is_(None)))
            ).all()
            for visit in unclosed_visits:
                if visit.player_id not in connected_player_ids:
                    visit.ended_at = now
                    visit.duration_seconds = max(0, int((now - _aware(visit.started_at)).total_seconds()))
            if unclosed_visits:
                await session.commit()
            total_players = int(await session.scalar(select(func.count()).select_from(Player)) or 0)
            total_visits = int(await session.scalar(select(func.count()).select_from(AnalyticsVisit)) or 0)
            total_plays = int(await session.scalar(select(func.count()).select_from(Game)) or 0)
            completed_plays = int(
                await session.scalar(select(func.count()).select_from(Game).where(Game.ended_at.is_not(None))) or 0
            )
            new_players = int(
                await session.scalar(select(func.count()).select_from(Player).where(Player.created_at >= start)) or 0
            )
            recent_visits = (
                await session.scalars(select(AnalyticsVisit).where(AnalyticsVisit.started_at >= start))
            ).all()
            recent_players = (await session.scalars(select(Player.created_at).where(Player.created_at >= start))).all()
            recent_games = (await session.scalars(select(Game.created_at).where(Game.created_at >= start))).all()
            open_visit_rows = (
                await session.scalars(
                    select(AnalyticsVisit).where(
                        AnalyticsVisit.ended_at.is_(None), AnalyticsVisit.player_id.in_(connected_player_ids)
                    )
                )
            ).all()
            recent_games_by_arena = (
                await session.execute(
                    select(Game.arena_id, func.count().label("plays"))
                    .group_by(Game.arena_id)
                    .order_by(func.count().desc())
                    .limit(8)
                )
            ).all()
            seeker_metric = func.sum(RoundStat.finds)
            hider_metric = func.sum(case((RoundStat.not_found.is_(True), 1), else_=0))
            seekers = (
                await session.execute(
                    select(Player.id, Player.nickname, seeker_metric.label("score"))
                    .join(RoundStat, RoundStat.player_id == Player.id)
                    .where(RoundStat.role == "seeker")
                    .group_by(Player.id, Player.nickname)
                    .order_by(seeker_metric.desc())
                    .limit(5)
                )
            ).all()
            hiders = (
                await session.execute(
                    select(Player.id, Player.nickname, hider_metric.label("score"))
                    .join(RoundStat, RoundStat.player_id == Player.id)
                    .where(RoundStat.role == "hider")
                    .group_by(Player.id, Player.nickname)
                    .order_by(hider_metric.desc())
                    .limit(5)
                )
            ).all()
            playtime_rows = (
                await session.execute(
                    select(
                        Player.id,
                        Player.nickname,
                        Player.home_area,
                        func.count(AnalyticsVisit.id).label("visits"),
                        func.sum(AnalyticsVisit.duration_seconds).label("seconds"),
                    )
                    .join(AnalyticsVisit, AnalyticsVisit.player_id == Player.id)
                    .group_by(Player.id, Player.nickname, Player.home_area)
                )
            ).all()

        active_players = len(connected_player_ids)
        live_games = [group for group in world.groups.values() if group.phase != "over"]
        live_game_players = sum(
            1
            for group in live_games
            for player_id in group.humans
            if (player := world.sessions.get(player_id)) is not None and player.connected
        )

        buckets: dict[date, dict[str, int]] = {}
        for offset in range(days):
            day = start.date() + timedelta(days=offset)
            buckets[day] = {"visits": 0, "new_players": 0, "plays": 0}
        for visit in recent_visits:
            day = _aware(visit.started_at).date()
            if day in buckets:
                buckets[day]["visits"] += 1
        for created_at in recent_players:
            day = _aware(created_at).date()
            if day in buckets:
                buckets[day]["new_players"] += 1
        for created_at in recent_games:
            day = _aware(created_at).date()
            if day in buckets:
                buckets[day]["plays"] += 1

        seconds_by_player: dict[str, int] = {}
        open_visits = len(open_visit_rows)
        for row in playtime_rows:
            seconds_by_player[row.id] = max(int(row.seconds or 0), 0)
        for visit in open_visit_rows:
            seconds = max(0, int((now - _aware(visit.started_at)).total_seconds()))
            seconds_by_player[visit.player_id] = seconds_by_player.get(visit.player_id, 0) + seconds
        playtime = [
            {
                "id": row.id,
                "nickname": row.nickname,
                "home_area": row.home_area,
                "seconds": seconds_by_player.get(row.id, 0),
                "visits": int(row.visits),
            }
            for row in playtime_rows
        ]
        playtime.sort(key=lambda row: (row["seconds"], row["visits"]), reverse=True)

        return {
            "generated_at": now.isoformat(),
            "period_days": days,
            "totals": {
                "players": total_players,
                "active_players": active_players,
                "new_players": new_players,
                "visits": total_visits,
                "active_visits": open_visits,
                "plays": total_plays,
                "completed_plays": completed_plays,
                "current_plays": len(live_games),
                "players_in_current_plays": live_game_players,
            },
            "activity": [{"date": day.isoformat(), **values} for day, values in buckets.items()],
            "leaderboards": {
                "seekers": [{"id": row.id, "nickname": row.nickname, "score": int(row.score or 0)} for row in seekers],
                "hiders": [{"id": row.id, "nickname": row.nickname, "score": int(row.score or 0)} for row in hiders],
                "playtime": playtime[:10],
            },
            "arenas": [
                {
                    "id": row.arena_id,
                    "name": maps[row.arena_id].raw.get("name", row.arena_id) if row.arena_id in maps else row.arena_id,
                    "plays": int(row.plays),
                }
                for row in recent_games_by_arena
            ],
        }

    return router
