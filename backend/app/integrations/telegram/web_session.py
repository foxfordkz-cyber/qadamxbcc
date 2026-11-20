"""Short-lived, revocable owner sessions limited to trusted contact routes."""

import hashlib
import re
import secrets
from uuid import UUID

from redis.asyncio import Redis

from app.integrations.config import IntegrationSettings

CODE_TTL = 180
SESSION_TTL = 900


def _key(kind: str, secret: str) -> str:
    digest = hashlib.sha256(secret.encode("ascii")).hexdigest()
    return f"bcc:circle-web:{kind}:{digest}"


def _owner(binding: bytes | str | None, cfg: IntegrationSettings) -> UUID | None:
    if not binding:
        return None
    try:
        data = binding.decode("ascii") if isinstance(binding, bytes) else binding
        chat, subject = data.split(":")
        chat_id = int(chat)
    except (ValueError, UnicodeError):
        return None
    owner = cfg.circle_web_owners.get(chat_id)
    if (
        cfg.telegram_mode == "test"
        and chat_id in cfg.telegram_allowed_chat_ids
        and str(owner) == subject
    ):
        return owner
    return None


async def issue_code(redis: Redis, cfg: IntegrationSettings, chat_id: int) -> str | None:
    subject = cfg.circle_web_owners.get(chat_id)
    if not subject or chat_id not in cfg.telegram_allowed_chat_ids or cfg.telegram_mode != "test":
        return None
    code = secrets.token_hex(8).upper()
    await redis.set(_key("code", code), f"{chat_id}:{subject}", ex=CODE_TTL)
    return code


async def exchange(redis: Redis, cfg: IntegrationSettings, code: str) -> str | None:
    if not re.fullmatch(r"[0-9A-F]{16}", code):
        return None
    binding = await redis.getdel(_key("code", code))
    if not binding or _owner(binding, cfg) is None:
        return None
    token = secrets.token_urlsafe(32)
    await redis.set(_key("session", token), binding, ex=SESSION_TTL)
    return token


async def session_owner(redis: Redis, cfg: IntegrationSettings, token: str) -> UUID | None:
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        return None
    return _owner(await redis.get(_key("session", token)), cfg)


async def end_session(redis: Redis, token: str) -> None:
    if re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        await redis.delete(_key("session", token))
