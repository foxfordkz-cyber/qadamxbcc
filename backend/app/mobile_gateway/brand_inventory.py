"""Passive review of user-supplied indicators. No target is contacted."""

import ipaddress
import re
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.mobile_gateway.app import IdentityDep

KEY = "bcc:mobile:brand-inventory:v1"
RETENTION = 30 * 86400
# www.bcc.kz links its chat and official application deep links.
OFFICIAL_DOMAINS = (
    "bcc.kz",
    "centercredit.kz",
    "bcclife.kz",
    "bcc-invest.kz",
    "bcc-kz.onelink.me",
    "bcc-business-mobile.onelink.me",
    "junior-bank.onelink.me",
)
OFFICIAL_HANDLES = {"bankcentercredit_bot", "bcckz", "bcc_kz", "bcc_kz_news", "bcc_kz_bot"}


class Observation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    indicator: str = Field(min_length=3, max_length=253)
    basis: Literal["claims_bank", "asks_for_code"]


class Lead(BaseModel):
    indicator: str
    basis: Literal["claims_bank", "asks_for_code"]
    observed_at: datetime


def canonical(value: str) -> str:
    value = value.strip().lower()
    if value.startswith(("https://t.me/", "t.me/")):
        value = "@" + value.rsplit("t.me/", 1)[1]
    if value.startswith("@"):
        if not re.fullmatch(r"@[a-z][a-z0-9_]{4,31}", value):
            raise ValueError("invalid")
        if value[1:] in OFFICIAL_HANDLES:
            raise ValueError("official")
        return value
    if any(c.isspace() for c in value) or any(c in value for c in "\\@?#"):
        raise ValueError("invalid")
    parsed = urlsplit(value if "://" in value else "//" + value)
    if (
        parsed.scheme not in ("", "https", "http")
        or parsed.port is not None
        or parsed.path not in ("", "/")
    ):
        raise ValueError("invalid")
    domain = (parsed.hostname or "").rstrip(".").encode("idna").decode("ascii")
    parts = domain.split(".")
    if (
        len(domain) > 253
        or len(parts) < 2
        or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in parts)
        or not re.fullmatch(r"[a-z][a-z0-9-]{1,62}", parts[-1])
    ):
        raise ValueError("invalid")
    try:
        ipaddress.ip_address(domain)
    except ValueError:
        pass
    else:
        raise ValueError("invalid")
    if domain in ("t.me", "telegram.me") or any(
        domain == d or domain.endswith("." + d) for d in OFFICIAL_DOMAINS
    ):
        raise ValueError("official")
    return domain


async def inventory(redis: Redis, at: datetime, observed: Observation | None = None) -> list[Lead]:
    try:
        async with redis.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(KEY, "-inf", at.timestamp() - RETENTION)
            if observed:
                try:
                    entry = canonical(observed.indicator)
                except (ValueError, UnicodeError) as exc:
                    raise HTTPException(
                        422, "official_indicator" if str(exc) == "official" else "invalid_indicator"
                    ) from exc
                pipe.zadd(KEY, {entry + "|" + observed.basis: at.timestamp()}, nx=True)
                pipe.zremrangebyrank(KEY, 0, -101)
                pipe.expire(KEY, RETENTION)
            pipe.zrevrange(KEY, 0, 99, withscores=True)
            rows = (await pipe.execute())[-1]
    except RedisError as exc:
        raise HTTPException(503, "inventory_unavailable") from exc
    items = []
    for member, score in rows:
        indicator, basis = (member.decode() if isinstance(member, bytes) else member).split("|", 1)
        if basis not in ("claims_bank", "asks_for_code"):
            continue
        items.append(
            Lead(
                indicator=indicator,
                basis="claims_bank" if basis == "claims_bank" else "asks_for_code",
                observed_at=datetime.fromtimestamp(score, UTC),
            )
        )
    return items


def install_brand_inventory(app: FastAPI) -> None:
    base = "/mobile/v1/wallet/brand-reports"

    @app.get(base)
    async def recent(principal: IdentityDep, request: Request) -> list[Lead]:
        if principal.role != "admin":
            raise HTTPException(403, "soc_required")
        return await inventory(request.app.state.resources.redis, datetime.now(UTC))

    @app.post(base)
    async def add(body: Observation, principal: IdentityDep, request: Request) -> list[Lead]:
        if principal.role != "admin":
            raise HTTPException(403, "soc_required")
        return await inventory(request.app.state.resources.redis, datetime.now(UTC), body)
