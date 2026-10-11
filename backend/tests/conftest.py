import os

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-1234")

import pytest_asyncio

from app.db import Database, Player


@pytest_asyncio.fixture
async def db(tmp_path):
    d = Database(f"sqlite+aiosqlite:///{tmp_path}/t.db")
    await d.create_all()
    yield d
    await d.engine.dispose()


async def make_player(db: Database, nick: str, hunger: float = 80.0) -> str:
    async with db.sessions() as s, s.begin():
        p = Player(nickname=nick, home_area="Yaba", device_secret_hash="x", hunger=hunger)
        s.add(p)
        await s.flush()
        return p.id
