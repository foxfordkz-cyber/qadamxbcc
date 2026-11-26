"""Synthetic ATM instructions. No ledger debit or dispense command is issued."""

from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from redis.asyncio import Redis
from redis.exceptions import RedisError, WatchError

from app.db.base import utcnow
from app.mobile_gateway.app import IdentityDep
from app.mobile_gateway.protection import client


class CashRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    amount_kzt: int = Field(strict=True, ge=1, le=1_000_000)
    caller_requested_cash: bool


class CashInstruction(CashRequest):
    state: Literal["ready", "cooling_off", "cancelled", "completed"]
    until: datetime | None = None


async def cash_action(
    redis: Redis,
    owner: UUID,
    command: Literal["start", "cancel", "confirm"],
    operation_id: UUID,
    body: CashRequest | None,
    now: datetime,
) -> CashInstruction:
    prefix = f"bcc:mobile:atm:{{{owner}}}:"
    current, record = prefix + "active", prefix + str(operation_id)
    for _ in range(5):
        try:
            async with redis.pipeline() as pipe:
                await pipe.watch(current, record)
                raw = await pipe.get(record)
                active = await pipe.get(current)
                active_id = active.decode() if isinstance(active, bytes) else active
                result = CashInstruction.model_validate_json(raw) if raw else None
                if command == "start":
                    if body is None or body.id != operation_id:
                        raise HTTPException(422, "invalid_cash_instruction")
                    if result:
                        if (result.amount_kzt, result.caller_requested_cash) != (
                            body.amount_kzt,
                            body.caller_requested_cash,
                        ):
                            raise HTTPException(409, "cash_instruction_conflict")
                        return result
                    if active_id and active_id != str(operation_id):
                        raise HTTPException(409, "cash_instruction_active")
                    result = CashInstruction(
                        **body.model_dump(),
                        state="cooling_off" if body.caller_requested_cash else "ready",
                        until=now + timedelta(minutes=15) if body.caller_requested_cash else None,
                    )
                else:
                    if result is None:
                        raise HTTPException(404, "cash_instruction_missing")
                    target: Literal["cancelled", "completed"] = (
                        "cancelled" if command == "cancel" else "completed"
                    )
                    if result.state == target:
                        return result
                    if active_id != str(operation_id) or result.state in {"cancelled", "completed"}:
                        raise HTTPException(409, "cash_instruction_closed")
                    if command == "confirm" and result.until and now < result.until:
                        raise HTTPException(409, "cash_window_open")
                    result.state = target
                pipe.multi()  # type: ignore[no-untyped-call]  # redis-py has no signature here.
                pipe.set(record, result.model_dump_json(), ex=86400)
                if result.state in {"ready", "cooling_off"}:
                    pipe.set(current, str(operation_id), ex=86400)
                else:
                    pipe.delete(current)
                await pipe.execute()
                return result
        except WatchError:
            continue
        except RedisError as exc:
            raise HTTPException(503, "cash_temporarily_unavailable") from exc
    raise HTTPException(409, "cash_instruction_busy")


def install_cash_window(app: FastAPI) -> None:
    base = "/mobile/v1/wallet/cash"

    @app.get(base)
    async def current(principal: IdentityDep, request: Request) -> CashInstruction | None:
        owner = client(principal)
        redis: Redis = request.app.state.resources.redis
        prefix = f"bcc:mobile:atm:{{{owner}}}:"
        try:
            active = await redis.get(prefix + "active")
            if not active:
                return None
            raw = await redis.get(
                prefix + (active.decode() if isinstance(active, bytes) else active)
            )
        except RedisError as exc:
            raise HTTPException(503, "cash_temporarily_unavailable") from exc
        return CashInstruction.model_validate_json(raw) if raw else None

    @app.post(base)
    async def start(body: CashRequest, principal: IdentityDep, request: Request) -> CashInstruction:
        return await cash_action(
            request.app.state.resources.redis, client(principal), "start", body.id, body, utcnow()
        )

    @app.post(base + "/{operation_id}/{action}")
    async def resolve(
        operation_id: UUID,
        action: Literal["cancel", "confirm"],
        principal: IdentityDep,
        request: Request,
    ) -> CashInstruction:
        return await cash_action(
            request.app.state.resources.redis,
            client(principal),
            action,
            operation_id,
            None,
            utcnow(),
        )
