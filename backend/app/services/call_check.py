"""«Is the bank calling me?» — check a live call against the bank's outbound call log.

Prototype boundary: the outbound call log is simulated in Redis. In a bank it is the
contact-centre telephony log, written by the dialler when an employee calls a client.
The app only learns that a call is active (CXCallObserver / AudioManager), never the
number or the audio; the client asks, and the bank answers from its own log.

A check is stored for a short time so the transfer that follows can prove the client
asked and the bank said it was not calling. Only that negative answer feeds scoring:
a confirmed bank call never lowers risk, because a scammer can stay on another line.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Final

from redis.asyncio import Redis

OUTBOUND_CALL_TTL_S: Final = 10 * 60
CHECK_TTL_S: Final = 30 * 60
_CALL_KEY: Final = "bcc:outbound-call:{customer}"
_CHECK_KEY: Final = "bcc:call-check:{check}"


@dataclass(frozen=True, slots=True)
class OutboundCall:
    employee_name: str
    department: str
    started_at: str


@dataclass(frozen=True, slots=True)
class CallCheck:
    check_id: str
    customer_id: str
    verified: bool
    checked_at: str
    employee_name: str | None = None
    department: str | None = None


class CallCheckService:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def start_bank_call(
        self, customer_id: uuid.UUID, *, employee_name: str, department: str
    ) -> OutboundCall:
        """Demo control: write a genuine outbound call into the simulated log."""
        call = OutboundCall(employee_name, department, datetime.now(UTC).isoformat())
        await self._redis.set(
            _CALL_KEY.format(customer=customer_id),
            json.dumps(asdict(call)),
            ex=OUTBOUND_CALL_TTL_S,
        )
        return call

    async def end_bank_call(self, customer_id: uuid.UUID) -> None:
        await self._redis.delete(_CALL_KEY.format(customer=customer_id))

    async def check(self, customer_id: uuid.UUID) -> CallCheck:
        raw = await self._redis.get(_CALL_KEY.format(customer=customer_id))
        call = OutboundCall(**json.loads(raw)) if raw else None
        result = CallCheck(
            check_id=str(uuid.uuid4()),
            customer_id=str(customer_id),
            verified=call is not None,
            checked_at=datetime.now(UTC).isoformat(),
            employee_name=call.employee_name if call else None,
            department=call.department if call else None,
        )
        await self._redis.set(
            _CHECK_KEY.format(check=result.check_id), json.dumps(asdict(result)), ex=CHECK_TTL_S
        )
        return result

    async def denied_for(self, check_id: uuid.UUID | None, customer_id: uuid.UUID) -> bool:
        """True only for a live check by this customer where the bank was not calling."""
        if check_id is None:
            return False
        raw = await self._redis.get(_CHECK_KEY.format(check=check_id))
        if not raw:
            return False
        stored = CallCheck(**json.loads(raw))
        return stored.customer_id == str(customer_id) and not stored.verified
