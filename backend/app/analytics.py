"""Admin-only product and game analytics assembled from server-owned records."""

from __future__ import annotations

import hmac
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Path, Query
from sqlalchemy import case, func, select

from app.db import Ad, AnalyticsVisit, Database, Device, Friendship, FurnitureItem, Game, Player, Report, RoundStat
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
            paystack_revenue = (
                await session.execute(
                    select(
                        func.count(Ad.id).label("transactions"),
                        func.coalesce(func.sum(Ad.price), 0).label("gross"),
                        func.coalesce(func.sum(case((Ad.status == "refunded", Ad.price), else_=0)), 0).label(
                            "refunded"
                        ),
                    ).where(Ad.provider == "paystack", Ad.paystack_verified.is_(True))
                )
            ).one()
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
            "ad_revenue": {
                "currency": "NGN",
                "confirmed_transactions": int(paystack_revenue.transactions),
                "gross_collected": int(paystack_revenue.gross),
                "refunded": int(paystack_revenue.refunded),
                "net_after_refunds": int(paystack_revenue.gross - paystack_revenue.refunded),
                "note": "Verified Paystack charges only; historical and test-mode payments are excluded.",
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

    @router.get("/admin/players")
    async def admin_players(
        x_admin_token: Annotated[str, Header()] = "",
        q: Annotated[str, Query(max_length=80)] = "",
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    ) -> dict[str, Any]:
        """Searchable, paginated player directory. Never returns credential material."""
        require_admin(x_admin_token)
        connected = {p.pid for p in world.sessions.values() if p.connected and not p.bot}
        async with db.sessions() as session:
            query = select(Player)
            if q.strip():
                pattern = f"%{q.strip()}%"
                query = query.where(
                    Player.nickname.ilike(pattern) | Player.username.ilike(pattern) | Player.email.ilike(pattern)
                )
            total = int(await session.scalar(select(func.count()).select_from(query.subquery())) or 0)
            players = (
                await session.scalars(query.order_by(Player.created_at.desc(), Player.id).limit(limit).offset(offset))
            ).all()
            ids = [player.id for player in players]
            visit_rows = (
                (
                    await session.execute(
                        select(
                            AnalyticsVisit.player_id,
                            func.count(AnalyticsVisit.id).label("visits"),
                            func.sum(AnalyticsVisit.duration_seconds).label("seconds"),
                        )
                        .where(AnalyticsVisit.player_id.in_(ids))
                        .group_by(AnalyticsVisit.player_id)
                    )
                ).all()
                if ids
                else []
            )
            game_rows = (
                (
                    await session.execute(
                        select(RoundStat.player_id, func.count(func.distinct(RoundStat.game_id)).label("games"))
                        .where(RoundStat.player_id.in_(ids))
                        .group_by(RoundStat.player_id)
                    )
                ).all()
                if ids
                else []
            )
        visits = {row.player_id: (int(row.visits), int(row.seconds or 0)) for row in visit_rows}
        games = {row.player_id: int(row.games) for row in game_rows}
        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "players": [
                {
                    "id": player.id,
                    "nickname": player.nickname,
                    "username": player.username,
                    "home_area": player.home_area,
                    "created_at": _aware(player.created_at).isoformat(),
                    "online": player.id in connected,
                    "visits": visits.get(player.id, (0, 0))[0],
                    "time_spent_seconds": visits.get(player.id, (0, 0))[1],
                    "games_played": games.get(player.id, 0),
                }
                for player in players
            ],
        }

    @router.get("/admin/players/{player_id}")
    async def admin_player_detail(
        player_id: Annotated[str, Path(max_length=32)],
        x_admin_token: Annotated[str, Header()] = "",
    ) -> dict[str, Any]:
        """Admin support view with account, activity, game, and ad payment details."""
        require_admin(x_admin_token)
        connected = {p.pid for p in world.sessions.values() if p.connected and not p.bot}
        now = datetime.now(UTC)
        async with db.sessions() as session:
            player = await session.get(Player, player_id)
            if player is None:
                raise HTTPException(404, "Player not found")
            visit_rows = (
                await session.scalars(
                    select(AnalyticsVisit)
                    .where(AnalyticsVisit.player_id == player_id)
                    .order_by(AnalyticsVisit.started_at.desc())
                )
            ).all()
            rounds = (
                await session.scalars(
                    select(RoundStat).where(RoundStat.player_id == player_id).order_by(RoundStat.created_at.desc())
                )
            ).all()
            ads = (
                await session.execute(
                    select(
                        Ad.id,
                        Ad.title,
                        Ad.status,
                        Ad.price,
                        Ad.provider,
                        Ad.paystack_verified,
                        Ad.paid_at,
                        Ad.created_at,
                    )
                    .where(Ad.player_id == player_id)
                    .order_by(Ad.created_at.desc())
                )
            ).all()
            device_count = int(
                await session.scalar(select(func.count()).select_from(Device).where(Device.player_id == player_id)) or 0
            )
            furniture_count = int(
                await session.scalar(
                    select(func.count()).select_from(FurnitureItem).where(FurnitureItem.player_id == player_id)
                )
                or 0
            )
            friendships = int(
                await session.scalar(
                    select(func.count())
                    .select_from(Friendship)
                    .where(
                        ((Friendship.a_id == player_id) | (Friendship.b_id == player_id))
                        & (Friendship.status == "accepted")
                    )
                )
                or 0
            )
            reports_received = int(
                await session.scalar(select(func.count()).select_from(Report).where(Report.target_id == player_id)) or 0
            )
        active = player_id in connected
        total_seconds = sum(
            max(0, int((now - _aware(visit.started_at)).total_seconds()))
            if visit.ended_at is None and active
            else max(0, int(visit.duration_seconds or 0))
            for visit in visit_rows
        )
        seeker_rounds = [row for row in rounds if row.role == "seeker"]
        hider_rounds = [row for row in rounds if row.role == "hider"]
        verified_ads = [ad for ad in ads if ad.provider == "paystack" and ad.paystack_verified]
        return {
            "profile": {
                "id": player.id,
                "nickname": player.nickname,
                "username": player.username,
                "email": player.email,
                "home_area": player.home_area,
                "avatar": player.avatar,
                "created_at": _aware(player.created_at).isoformat(),
                "online": active,
                "login_method": "LagosLife" if player.vatar_id else "Boju account",
                "must_change_password": player.must_change_password,
                "locked_until": _aware(player.locked_until).isoformat() if player.locked_until else None,
                "phone_id": player.phone_id,
                "car_id": player.car_id,
                "home_id": player.home_id,
                "rent_until": _aware(player.rent_until).isoformat() if player.rent_until else None,
                "hunger": player.hunger,
            },
            "activity": {
                "visits": len(visit_rows),
                "time_spent_seconds": total_seconds,
                "last_visit_at": _aware(visit_rows[0].started_at).isoformat() if visit_rows else None,
                "registered_devices": device_count + 1,
                "friends": friendships,
                "furniture_items": furniture_count,
                "reports_received": reports_received,
            },
            "gameplay": {
                "games_played": len({row.game_id for row in rounds}),
                "rounds_played": len(rounds),
                "seeker_rounds": len(seeker_rounds),
                "finds": sum(row.finds for row in seeker_rounds),
                "hider_rounds": len(hider_rounds),
                "survived_hider_rounds": sum(1 for row in hider_rounds if row.not_found),
                "in_game_naira_earned": sum(row.earned for row in rounds),
            },
            "ad_payments": {
                "paystack_confirmed_total": sum(ad.price for ad in verified_ads if ad.status != "refunded"),
                "paystack_refunded_total": sum(ad.price for ad in verified_ads if ad.status == "refunded"),
                "transactions": [
                    {
                        "id": ad.id,
                        "title": ad.title,
                        "status": ad.status,
                        "amount": ad.price,
                        "provider": ad.provider,
                        "paystack_verified": ad.paystack_verified,
                        "paid_at": _aware(ad.paid_at).isoformat() if ad.paid_at else None,
                        "created_at": _aware(ad.created_at).isoformat(),
                    }
                    for ad in ads
                ],
            },
        }

    return router
