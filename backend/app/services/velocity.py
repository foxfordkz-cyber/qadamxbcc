"""Redis sliding-window velocity counters (sorted sets, one round trip per evaluation).

Each account owns two ZSETs: ``vel:out:{id}`` and ``vel:in:{id}``. A member is
``"{tx_id}:{amount}"`` scored by the event's epoch seconds, so count and volume for
any window up to 24h are derived from a single ``ZRANGEBYSCORE ... WITHSCORES``.
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
    volume: float = 0.0


@dataclass(frozen=True, slots=True)
class FlowStats:
    """Per-window stats for one direction (in/out) of one account."""

    windows: dict[str, WindowStat] = field(default_factory=dict)

    def count(self, window: str) -> int:
        return self.windows.get(window, WindowStat()).count

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
                w: {"count": s.count, "volume": round(s.volume, 2)} for w, s in fs.windows.items()
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
    parsed: list[tuple[float, float]] = []
    for member, score in rows:
        _, _, amount = _decode(member).rpartition(":")
        try:
            parsed.append((float(score), float(amount)))
        except ValueError:
            continue
    for name, span in WINDOWS.items():
        lo = now - span
        hits = [amt for ts, amt in parsed if ts > lo]
        windows[name] = WindowStat(count=len(hits), volume=sum(hits))
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
        member = f"{tx_id}:{amount:.2f}"
        out_s, in_s = _key("out", sender_id), _key("in", sender_id)
        in_r, out_r = _key("in", recipient_id), _key("out", recipient_id)
        floor = ts - RETENTION_S

        pipe = self._redis.pipeline(transaction=False)
        pipe.zadd(out_s, {member: ts})
        pipe.zadd(in_r, {member: ts})
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
