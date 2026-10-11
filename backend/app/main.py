from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select, text
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app import auth
from app.accounts import Me, make_router
from app.content import get_config, get_maps
from app.db import Database, Device, Game, LedgerEntry, Player, Report, RoundStat
from app.life import make_router as make_life_router
from app.realtime.protocol import BadMessage
from app.realtime.rooms import writer
from app.realtime.world import World
from app.routes import get_route
from app.safety import KeyedLimiter, TextRejected, clean_chat
from app.settings import get_settings

log = logging.getLogger("boju")
STARTED = time.time()


def client_ip(request: Request) -> str:
    return request.headers.get("fly-client-ip") or (request.client.host if request.client else "unknown")


class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        resp.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
        if get_settings().env == "prod":
            resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return resp


class RateLimit(BaseHTTPMiddleware):
    def __init__(self, app: Any) -> None:
        super().__init__(app)
        self.general = KeyedLimiter(rate=5, burst=30)
        self.auth = KeyedLimiter(rate=0.2, burst=5)
        self.login = KeyedLimiter(rate=0.5, burst=10)  # per IP; each account also locks after 5 bad PINs

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        ip = client_ip(request)
        path = request.url.path
        if path.startswith(("/api/auth/login", "/api/auth/forgot", "/api/auth/reset")):
            limiter = self.login
        elif path.startswith("/api/auth/register"):
            limiter = self.auth
        else:
            limiter = self.general
        if path.startswith("/api") and not limiter.allow(ip):
            return JSONResponse({"detail": "Too many requests — slow down small"}, status_code=429)
        return await call_next(request)


class RefreshIn(BaseModel):
    player_id: str = Field(max_length=32)
    device_secret: str = Field(min_length=20, max_length=80)


class ReportIn(BaseModel):
    target_id: str = Field(max_length=32)
    reason: str = Field(min_length=3, max_length=300)
    context: str | None = Field(default=None, max_length=64)


def create_app(database_url: str | None = None, *, run_tick: bool = True) -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    cfg = get_config()
    maps = get_maps()
    db = Database(database_url or settings.async_database_url)
    world = World(cfg, maps, db.sessions)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await db.create_all()
        await world.load_home_owners()
        task = asyncio.create_task(world.run()) if run_tick else None
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await db.engine.dispose()

    app = FastAPI(title="Boju Boju API", lifespan=lifespan, docs_url=None if settings.env == "prod" else "/docs")
    app.state.world = world
    app.state.db = db
    app.add_middleware(RateLimit)
    app.add_middleware(SecurityHeaders)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.frontend_origin.split(",") if o.strip()],
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )

    # ------------------------------------------------------------ routes
    @app.get("/health")
    async def health() -> dict[str, Any]:
        ok = True
        try:
            async with db.sessions() as s:
                await s.execute(text("SELECT 1"))
        except Exception:  # noqa: BLE001
            ok = False
        return {
            "ok": ok,
            "uptime_s": int(time.time() - STARTED),
            "groups": len(world.groups),
            "online": sum(1 for s in world.sessions.values() if s.connected),
        }

    @app.get("/api/content")
    async def content() -> dict[str, Any]:
        return {"config": cfg.model_dump(), "maps": {k: m.raw for k, m in maps.items()}}

    @app.post("/api/auth/refresh")
    async def refresh(body: RefreshIn) -> dict[str, Any]:
        async with db.sessions() as s:
            p = await s.get(Player, body.player_id)
            known = p is not None and (
                auth.secret_matches(body.device_secret, p.device_secret_hash)
                or await s.scalar(
                    select(Device.id).where(
                        Device.player_id == p.id, Device.secret_hash == auth.hash_secret(body.device_secret)
                    )
                )
                is not None
            )
        if p is None or not known:
            raise HTTPException(401, "Unknown player")
        return {"token": auth.issue_token(p.id, must_change=p.must_change_password)}

    app.include_router(make_router(db, world, cfg))
    app.include_router(make_life_router(db, world, cfg))

    @app.get("/api/wallet")
    async def wallet(pid: Me) -> dict[str, Any]:
        async with db.sessions() as s:
            rows = (
                await s.scalars(
                    select(LedgerEntry).where(LedgerEntry.player_id == pid).order_by(LedgerEntry.id.desc()).limit(30)
                )
            ).all()
        return {
            "balance": await world.economy.balance(pid),
            "disclaimer": cfg.money_disclaimer,
            "entries": [
                {"amount": r.amount, "reason": r.reason, "ref": r.ref, "at": r.created_at.isoformat()} for r in rows
            ],
        }

    @app.get("/api/leaderboards")
    async def leaderboards(
        kind: Literal["seeker", "hider"] = "seeker",
        period: Literal["weekly", "all"] = "weekly",
        game_id: Annotated[str | None, Query(max_length=32)] = None,
    ) -> dict[str, Any]:
        metric = func.sum(RoundStat.finds) if kind == "seeker" else func.sum(case((RoundStat.not_found, 1), else_=0))
        q = (
            select(Player.id, Player.nickname, Player.home_area, metric.label("score"))
            .join(Player, Player.id == RoundStat.player_id)
            .where(RoundStat.role == kind)
            .group_by(Player.id, Player.nickname, Player.home_area)
            .order_by(metric.desc())
            .limit(50)
        )
        if period == "weekly":
            q = q.where(RoundStat.created_at >= datetime.now(UTC) - timedelta(days=7))
        if game_id:
            q = q.where(RoundStat.game_id == game_id)
        async with db.sessions() as s:
            rows = (await s.execute(q)).all()
        return {
            "kind": kind,
            "period": period,
            "rows": [
                {"id": r.id, "nickname": r.nickname, "home_area": r.home_area, "score": int(r.score or 0)}
                for r in rows
                if (r.score or 0) > 0
            ],
        }

    @app.get("/api/route")
    async def route(
        home: Annotated[str, Query(max_length=40)],
        arena: Annotated[str, Query(max_length=40)],
        mode: Annotated[str, Query(max_length=20)] = "danfo",
    ) -> dict[str, Any]:
        city = cfg.city_of(arena)
        arena_map = maps.get(arena)
        start = cfg.home_coords.get(home)
        if city is None or arena_map is None or start is None:
            raise HTTPException(404, "Unknown route")
        venue = arena_map.raw.get("venue") or {"name": city.name, "lat": city.lat, "lng": city.lng}
        origin = (start[1], start[0])
        dest = (float(venue["lng"]), float(venue["lat"]))
        kind = "flight" if mode == "flight" else "road"
        coords, source = await get_route(db.sessions, origin, dest, f"{kind}:{home}:{arena}", kind)
        return {
            "from": {"name": f"{home}, Lagos", "lng": origin[0], "lat": origin[1]},
            "to": {"name": venue["name"], "lng": dest[0], "lat": dest[1]},
            "mode": mode,
            "source": source,
            "coords": coords,
        }

    @app.get("/api/games/{game_id}/summary")
    async def game_summary(game_id: str) -> dict[str, Any]:
        if len(game_id) > 32:
            raise HTTPException(404, "Not found")
        async with db.sessions() as s:
            g = await s.get(Game, game_id)
        if g is None or not g.results:
            raise HTTPException(404, "Game not finished")
        arena = maps.get(g.arena_id)
        return {
            "id": g.id,
            "arena": arena.raw["name"] if arena else g.arena_id,
            "ended_at": g.ended_at.isoformat() if g.ended_at else None,
            "standings": [
                {k: v for k, v in row.items() if k in ("nick", "earned", "finds", "survived")}
                for row in g.results.get("standings", [])
            ],
        }

    @app.post("/api/report")
    async def report(body: ReportIn, pid: Me) -> dict[str, Any]:
        try:
            reason = clean_chat(body.reason, 300)
        except TextRejected as e:
            raise HTTPException(422, str(e)) from None
        async with db.sessions() as s, s.begin():
            if await s.get(Player, body.target_id) is None:
                raise HTTPException(404, "Unknown player")
            s.add(Report(reporter_id=pid, target_id=body.target_id, reason=reason, context=body.context))
        log.info("report_filed by=%s target=%s", pid, body.target_id)
        return {"ok": True}

    # ------------------------------------------------------------ websocket
    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket, token: str = "") -> None:
        origin = ws.headers.get("origin")
        allowed = [o.strip() for o in settings.frontend_origin.split(",")]
        if settings.env == "prod" and origin not in allowed:
            await ws.close(code=4003)
            return
        pid = auth.verify_token(token)
        if pid is None:
            await ws.close(code=4001)
            return
        async with db.sessions() as s:
            p = await s.get(Player, pid)
        if p is None:
            await ws.close(code=4001)
            return
        await ws.accept()
        queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=512)

        def sender(data: bytes) -> None:
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()  # drop the oldest frame (usually a stale snapshot)
            queue.put_nowait(data)

        out_task = asyncio.create_task(writer(queue, ws.send_bytes))
        session = await world.connect(
            pid, p.nickname, sender, avatar=list(p.avatar or [0, 0, 0]), home_id=p.home_id, car=p.car_id
        )
        strikes = 0
        try:
            while True:
                data = await ws.receive_bytes()
                try:
                    await world.handle(session, data)
                except BadMessage:
                    strikes += 1
                    if strikes > 20:
                        await ws.close(code=4008)
                        break
        except (WebSocketDisconnect, RuntimeError):
            pass
        except Exception:
            log.exception("ws error pid=%s", pid)
        finally:
            world.disconnect(session, sender)
            out_task.cancel()
            # never let a half-finished send to a dead socket keep this handler alive
            await asyncio.wait({out_task}, timeout=1.0)

    return app


app = create_app()
