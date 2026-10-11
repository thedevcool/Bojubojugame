"""WebSocket wire protocol: msgpack maps with a ``t`` type key.

Keep in sync with frontend/src/lib/protocol.ts.
"""

from __future__ import annotations

from typing import Any, Literal

import msgpack
from pydantic import BaseModel, ConfigDict, Field, ValidationError


class _In(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Move(_In):
    t: Literal["mv"]
    x: float = Field(ge=-1000, le=1000)
    z: float = Field(ge=-1000, le=1000)
    ry: float = Field(ge=-10, le=10)
    c: bool = False  # crouch
    r: bool = False  # run
    st: bool = False  # sitting
    ly: bool = False  # lying down (sleeping on a bed)
    s: int = Field(ge=0, le=2**31)


class GroupCreate(_In):
    t: Literal["g_create"]
    arena: str = Field(max_length=40)
    hide: int
    search: int
    safe: str = Field(max_length=40)
    bots: int = Field(default=0, ge=0, le=5)


class GroupSettings(_In):
    t: Literal["g_settings"]
    arena: str | None = Field(default=None, max_length=40)
    hide: int | None = None
    search: int | None = None
    safe: str | None = Field(default=None, max_length=40)


class GroupJoin(_In):
    t: Literal["g_join"]
    code: str = Field(min_length=4, max_length=8)


class Bare(_In):
    t: Literal["g_leave", "g_start", "g_tag", "ping", "g_add_bot", "g_return"]


class RemoveBot(_In):
    t: Literal["g_remove_bot"]
    id: str = Field(max_length=40)


class Invite(_In):
    t: Literal["g_invite"]
    to: str = Field(max_length=40)


class Knock(_In):
    t: Literal["knock"]
    home: str = Field(max_length=40)


class KnockAnswer(_In):
    t: Literal["knock_answer"]
    to: str = Field(max_length=40)
    ok: bool


class Board(_In):
    t: Literal["g_board"]
    fare: str = Field(max_length=20)


class Pick(_In):
    t: Literal["g_pick"]
    n: int = Field(ge=1, le=6)


class Emote(_In):
    t: Literal["emote"]
    id: str = Field(max_length=32)


class Chat(_In):
    t: Literal["chat"]
    text: str = Field(max_length=600)
    ch: Literal["group", "near"] = "group"


class Buy(_In):
    t: Literal["buy"]
    item: str = Field(max_length=40)
    key: str = Field(min_length=8, max_length=64)


INBOUND: dict[str, type[_In]] = {
    "mv": Move,
    "g_create": GroupCreate,
    "g_settings": GroupSettings,
    "g_join": GroupJoin,
    "g_leave": Bare,
    "g_start": Bare,
    "g_tag": Bare,
    "ping": Bare,
    "g_add_bot": Bare,
    "g_return": Bare,
    "g_remove_bot": RemoveBot,
    "g_board": Board,
    "g_invite": Invite,
    "knock": Knock,
    "knock_answer": KnockAnswer,
    "g_pick": Pick,
    "emote": Emote,
    "chat": Chat,
    "buy": Buy,
}


class BadMessage(ValueError):
    pass


def decode(data: bytes) -> _In:
    try:
        raw = msgpack.unpackb(data, raw=False, strict_map_key=True)
    except Exception as e:  # noqa: BLE001 - any decode failure is a bad frame
        raise BadMessage("undecodable") from e
    if not isinstance(raw, dict) or not isinstance(raw.get("t"), str):
        raise BadMessage("no type")
    model = INBOUND.get(raw["t"])
    if model is None:
        raise BadMessage("unknown type")
    try:
        return model.model_validate(raw)
    except ValidationError as e:
        raise BadMessage("invalid") from e


def encode(msg: dict[str, Any]) -> bytes:
    return msgpack.packb(msg, use_bin_type=True)
