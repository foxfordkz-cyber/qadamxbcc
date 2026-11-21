"""Redis sliding-window velocity counters with bounded reads of sorted sets.

Attempts and settled funds use separate ZSETs. Attempt volume must never be used
as evidence that a recipient has cashed out: held and blocked payments do not move money.
A member is
``"{tx_id}:{counterparty_id}:{amount}"`` scored by the event's epoch seconds, so count,
distinct counterparties and volume for any window up to 24h are derived from a single
``ZRANGEBYSCORE ... WITHSCORES``.
Writing the same ``tx_id`` twice is idempotent. Inference reads at most 513 rows
per history. More than 512 active events requires external review/capacity handling;
the engine refuses to score rather than silently using a truncated window.
"""

from dataclasses import dataclass, field
from math import fsum

from redis.asyncio import Redis
from redis.asyncio.client import Pipeline

WINDOWS: dict[str, int] = {"10m": 600, "30m": 1800, "1h": 3600, "24h": 86400}
RETENTION_S = WINDOWS["24h"]
KEY_PREFIX = "bcc:vel"
MAX_HISTORY_ROWS = 512


class VelocityCapacityError(RuntimeError):
    """A complete risk history cannot be evaluated within the local scorer's capacity."""


@dataclass(frozen=True, slots=True)
class WindowStat:
    count: int = 0
    distinct: int = 0  # distinct counterparties (senders for "in", recipients for "out")
    volume: float = 0.0


@dataclass(frozen=True, slots=True)
class FlowStats:
    """Per-window stats for one direction (in/out) of one account."""

    windows: dict[str, WindowStat] = field(default_factory=dict)

    def count(self, window: str) -> int:
        return self.windows.get(window, WindowStat()).count

    def distinct(self, window: str) -> int:
        return self.windows.get(window, WindowStat()).distinct

    def volume(self, window: str) -> float:
        return self.windows.get(window, WindowStat()).volume


@dataclass(frozen=True, slots=True)
class SettledPayee:
    count: int = 0
    total: float = 0.0
    largest: float = 0.0


@dataclass(frozen=True, slots=True)
class VelocitySnapshot:
    sender_out: FlowStats
    sender_in: FlowStats
    recipient_in: FlowStats
    recipient_out: FlowStats
    settled_sender_out: FlowStats = field(default_factory=FlowStats)
    settled_sender_in: FlowStats = field(default_factory=FlowStats)
    settled_recipient_in: FlowStats = field(default_factory=FlowStats)
    settled_recipient_out: FlowStats = field(default_factory=FlowStats)
    settled_payee: SettledPayee = field(default_factory=SettledPayee)

    def as_dict(self) -> dict[str, dict[str, dict[str, float]]]:
        return {
            name: {
                w: {"count": s.count, "distinct": s.distinct, "volume": round(s.volume, 2)}
                for w, s in fs.windows.items()
            }
            for name, fs in (
                ("sender_out", self.sender_out),
                ("sender_in", self.sender_in),
                ("recipient_in", self.recipient_in),
                ("recipient_out", self.recipient_out),
                ("settled_sender_out", self.settled_sender_out),
                ("settled_sender_in", self.settled_sender_in),
                ("settled_recipient_in", self.settled_recipient_in),
                ("settled_recipient_out", self.settled_recipient_out),
            )
        }


def _key(direction: str, account_id: str) -> str:
    return f"{KEY_PREFIX}:{direction}:{account_id}"


def _decode(member: bytes | str) -> str:
    return member.decode() if isinstance(member, bytes) else member


def _settled_payee(
    rows: list[tuple[bytes | str, float]], recipient_id: str, tx_id: str | None
) -> SettledPayee:
    amounts = []
    for member, _ in rows:
        parts = _decode(member).split(":")
        if len(parts) == 3 and parts[1] == recipient_id and parts[0] != tx_id:
            try:
                amounts.append(float(parts[2]))
            except ValueError:
                continue
    return SettledPayee(len(amounts), fsum(amounts), max(amounts, default=0.0))


def _aggregate(rows: list[tuple[bytes | str, float]], now: float) -> FlowStats:
    # Redis returns ascending scores. As each window widens, visit only the older
    # rows it adds. Keep the left edge open, including when several scores tie there.
    cursor = len(rows) - 1
    amounts: list[float] = []
    counterparties: set[str] = set()
    windows: dict[str, WindowStat] = {}
    for name, span in WINDOWS.items():
        cutoff = now - span
        while cursor >= 0 and rows[cursor][1] > cutoff:
            member = rows[cursor][0]
            cursor -= 1
            parts = _decode(member).split(":")
            try:
                amount = float(parts[-1])
            except ValueError:
                continue
            # Legacy "{tx}:{amount}" entries count the tx as its own counterparty.
            counterparties.add(parts[1] if len(parts) == 3 else parts[0])
            amounts.append(amount)
        # Sum in the original Redis order to preserve historical rounding.
        windows[name] = WindowStat(len(amounts), len(counterparties), fsum(reversed(amounts)))
    return FlowStats(windows)


def _write_attempt(
    pipe: Pipeline, *, tx_id: str, sender_id: str, recipient_id: str, amount: float, ts: float
) -> None:
    for direction, account, counterparty in (
        ("out", sender_id, recipient_id),
        ("in", recipient_id, sender_id),
    ):
        key = _key(direction, account)
        pipe.zadd(key, {f"{tx_id}:{counterparty}:{amount:.2f}": ts})
        pipe.zremrangebyscore(key, "-inf", ts - RETENTION_S)
        pipe.expire(key, RETENTION_S + 3600)


class VelocityCounters:
    def __init__(self, redis: Redis, *, max_history_rows: int = MAX_HISTORY_ROWS) -> None:
        if not 1 <= max_history_rows <= MAX_HISTORY_ROWS:
            raise ValueError(f"max_history_rows must be between 1 and {MAX_HISTORY_ROWS}")
        self._redis = redis
        self.max_history_rows = max_history_rows

    async def record_attempt(
        self, *, tx_id: str, sender_id: str, recipient_id: str, amount: float, ts: float
    ) -> None:
        """Restore an attempt without a risk read; never truncate durable history."""
        pipe = self._redis.pipeline(transaction=True)
        _write_attempt(
            pipe, tx_id=tx_id, sender_id=sender_id, recipient_id=recipient_id, amount=amount, ts=ts
        )
        await pipe.execute()

    async def record_and_snapshot(
        self,
        *,
        tx_id: str,
        sender_id: str,
        recipient_id: str,
        amount: float,
        ts: float,
    ) -> VelocitySnapshot:
        """Atomically record an attempt and read its windows in one Redis transaction."""
        return await self._snapshot(
            tx_id=tx_id, sender_id=sender_id, recipient_id=recipient_id, amount=amount, ts=ts
        )

    async def snapshot(self, *, sender_id: str, recipient_id: str, ts: float) -> VelocitySnapshot:
        """Read current risk windows without adding or refreshing a transfer attempt."""
        return await self._snapshot(
            tx_id=None, sender_id=sender_id, recipient_id=recipient_id, amount=0, ts=ts
        )

    async def _snapshot(
        self, *, tx_id: str | None, sender_id: str, recipient_id: str, amount: float, ts: float
    ) -> VelocitySnapshot:
        out_s, in_s = _key("out", sender_id), _key("in", sender_id)
        in_r, out_r = _key("in", recipient_id), _key("out", recipient_id)
        floor = ts - RETENTION_S

        settled = (
            _key("settled:out", sender_id),
            _key("settled:in", sender_id),
            _key("settled:in", recipient_id),
            _key("settled:out", recipient_id),
        )
        keys = (out_s, in_s, in_r, out_r, *settled)
        # Admission checks return eight integers even for million-event accounts.
        # The final limited read below remains necessary: another request may add
        # events after this preflight, and this attempt itself may cross the limit.
        preflight = self._redis.pipeline(transaction=True)
        for key in keys:
            preflight.zcount(key, f"({floor}", ts)
        if any(count > self.max_history_rows for count in await preflight.execute()):
            raise VelocityCapacityError("Risk history exceeds the bounded scorer capacity")

        pipe = self._redis.pipeline(transaction=True)
        if tx_id is not None:
            _write_attempt(
                pipe,
                tx_id=tx_id,
                sender_id=sender_id,
                recipient_id=recipient_id,
                amount=amount,
                ts=ts,
            )
        for key in keys:
            pipe.zrangebyscore(
                key, f"({floor}", ts, start=0, num=self.max_history_rows + 1, withscores=True
            )
        res = await pipe.execute()
        rows = res[-8:]
        if any(len(history) > self.max_history_rows for history in rows):
            raise VelocityCapacityError("Risk history exceeds the bounded scorer capacity")
        return VelocitySnapshot(
            sender_out=_aggregate(rows[0], ts),
            sender_in=_aggregate(rows[1], ts),
            recipient_in=_aggregate(rows[2], ts),
            recipient_out=_aggregate(rows[3], ts),
            settled_sender_out=_aggregate(rows[4], ts),
            settled_sender_in=_aggregate(rows[5], ts),
            settled_recipient_in=_aggregate(rows[6], ts),
            settled_recipient_out=_aggregate(rows[7], ts),
            settled_payee=_settled_payee(rows[4], recipient_id, tx_id),
        )

    async def record_settled(
        self, *, tx_id: str, sender_id: str, recipient_id: str, amount: float, ts: float
    ) -> None:
        """Record only committed money movement, idempotently for the immutable transfer."""
        pipe = self._redis.pipeline(transaction=True)
        for direction, account, counterparty in (
            ("out", sender_id, recipient_id),
            ("in", recipient_id, sender_id),
        ):
            key = _key(f"settled:{direction}", account)
            # NX also preserves the original settlement time when the hook is retried.
            pipe.zadd(key, {f"{tx_id}:{counterparty}:{amount:.2f}": ts}, nx=True)
            pipe.zremrangebyscore(key, "-inf", ts - RETENTION_S)
            pipe.expire(key, RETENTION_S + 3600)
        await pipe.execute()
