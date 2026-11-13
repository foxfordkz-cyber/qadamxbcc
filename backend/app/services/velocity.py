"""Redis sliding-window velocity counters (sorted sets, one round trip per evaluation).

Each account owns two ZSETs: ``vel:out:{id}`` and ``vel:in:{id}``. A member is
``"{tx_id}:{counterparty_id}:{amount}"`` scored by the event's epoch seconds, so count,
distinct counterparties and volume for any window up to 24h are derived from a single
``ZRANGEBYSCORE ... WITHSCORES``.
Writing the same ``tx_id`` twice is idempotent.
"""

from dataclasses import dataclass, field

from redis.asyncio import Redis

WINDOWS: dict[str, int] = {"10m": 600, "30m": 1800, "1h": 3600, "24h": 86400}
RETENTION_S = WINDOWS["24h"]
KEY_PREFIX = "bcc:vel"


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
class VelocitySnapshot:
    sender_out: FlowStats
    sender_in: FlowStats
    recipient_in: FlowStats
    recipient_out: FlowStats

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
            )
        }


def _key(direction: str, account_id: str) -> str:
    return f"{KEY_PREFIX}:{direction}:{account_id}"


def _decode(member: bytes | str) -> str:
    return member.decode() if isinstance(member, bytes) else member


def _aggregate(rows: list[tuple[bytes | str, float]], now: float) -> FlowStats:
    windows: dict[str, WindowStat] = {}
    parsed: list[tuple[float, str, float]] = []
    for member, score in rows:
        parts = _decode(member).split(":")
        # legacy members "{tx}:{amount}" count each tx as its own counterparty
        counterparty = parts[1] if len(parts) == 3 else parts[0]
        try:
            parsed.append((float(score), counterparty, float(parts[-1])))
        except ValueError:
            continue
    for name, span in WINDOWS.items():
        lo = now - span
        hits = [(cp, amt) for ts, cp, amt in parsed if ts > lo]
        windows[name] = WindowStat(
            count=len(hits),
            distinct=len({cp for cp, _ in hits}),
            volume=sum(amt for _, amt in hits),
        )
    return FlowStats(windows=windows)


class VelocityCounters:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def record_and_snapshot(
        self,
        *,
        tx_id: str,
        sender_id: str,
        recipient_id: str,
        amount: float,
        ts: float,
    ) -> VelocitySnapshot:
        """Atomically-ish record the attempt and read all windows in ONE pipeline round trip."""
        out_member = f"{tx_id}:{recipient_id}:{amount:.2f}"
        in_member = f"{tx_id}:{sender_id}:{amount:.2f}"
        out_s, in_s = _key("out", sender_id), _key("in", sender_id)
        in_r, out_r = _key("in", recipient_id), _key("out", recipient_id)
        floor = ts - RETENTION_S

        pipe = self._redis.pipeline(transaction=False)
        pipe.zadd(out_s, {out_member: ts})
        pipe.zadd(in_r, {in_member: ts})
        for key in (out_s, in_r):
            pipe.zremrangebyscore(key, "-inf", floor)
            pipe.expire(key, RETENTION_S + 3600)
        for key in (out_s, in_s, in_r, out_r):
            pipe.zrangebyscore(key, floor, ts, withscores=True)
        res = await pipe.execute()
        rows = res[-4:]
        return VelocitySnapshot(
            sender_out=_aggregate(rows[0], ts),
            sender_in=_aggregate(rows[1], ts),
            recipient_in=_aggregate(rows[2], ts),
            recipient_out=_aggregate(rows[3], ts),
        )
