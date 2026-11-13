"""BCC Shield real-time antifraud & drop-network engine.

Hybrid pipeline evaluated on every transfer (warmed scorer p95 target < 15 ms):

* **Layer 1 — Behavioral & context guard** (pure CPU): active phone call, deposit
  withdrawal, new recipient, amount deviation from the sender's average, new device,
  night hours (Asia/Almaty), and composite social-engineering / takeover patterns.
* **Layer 2 — Velocity & graph engine**: Redis sliding windows (10m/30m/1h/24h, one
  pipeline round trip) and in-memory NetworkX metrics (distinct senders, transit
  ratio, shared device clusters, SOC flags).
* **Layer 3 — Machine learning**: locally trained random forest, including browser
  biometrics, with signed local tree-path explanations (inference target < 2 ms).
* **Layer 4 — Adaptive decision**: score 0–100 → ``approved`` (<40),
  ``cooling_off`` (40–74) or ``blocked`` (>=75), with bilingual kk/ru reasons.

Adaptive principle: customer-side behavioral signals alone never hard-block a
transfer — they are capped at the top of the cooling-off band so a real customer
gets a 15-minute pause and an anti-scam check instead of a rejection. A hard block
requires network evidence (velocity or graph) that the money is heading into, or
coming out of, a mule structure. ML may introduce a block only with corroborated
recipient-side mule evidence. Synthetic-model scores require real-data validation
before production use; they are not calibrated estimates of banking fraud rates.
"""

import time
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any, Final
from zoneinfo import ZoneInfo

from redis.asyncio import Redis

from app.ml.features import Features
from app.ml.model import Contributor, get_model
from app.models import TransactionStatus
from app.services import explain
from app.services.graph import (
    SHARED_DEVICE_MIN,
    TRANSIT_MIN_SENDERS,
    TRANSIT_RATIO,
    GraphMetrics,
    GraphStore,
)
from app.services.velocity import VelocityCounters, VelocitySnapshot

LAYER_BEHAVIORAL: Final = "behavioral"
LAYER_VELOCITY: Final = "velocity"
LAYER_GRAPH: Final = "graph"
LAYER_ML: Final = "ml"

COOLING_OFF_THRESHOLD: Final = 40
BLOCK_THRESHOLD: Final = 75
BEHAVIORAL_ONLY_CAP: Final = BLOCK_THRESHOLD - 1

# Behavioral weights
W_ACTIVE_CALL: Final = 25
W_DEPOSIT: Final = 15
W_NEW_RECIPIENT: Final = 10
W_AMOUNT_3X: Final = 10
W_AMOUNT_10X: Final = 20
W_NEW_DEVICE: Final = 15
W_NIGHT: Final = 10
W_SE_PATTERN: Final = 10
W_ATO_PATTERN: Final = 10
NIGHT_HOURS: Final = range(0, 6)

# Velocity weights / thresholds
W_SENDER_BURST: Final = 15
SENDER_BURST_10M: Final = 5
W_HUB_FAN_IN: Final = 35
HUB_FAN_IN_30M: Final = 12
W_FAN_IN: Final = 20
FAN_IN_1H: Final = 6
W_INSTANT_CASHOUT: Final = 20
W_PASS_THROUGH: Final = 35
PASS_THROUGH_MIN_IN: Final = 3
CASHOUT_RATIO: Final = 0.7

# Graph weights / thresholds
W_MANY_SENDERS_HIGH: Final = 20
W_MANY_SENDERS: Final = 10
MANY_SENDERS_HIGH: Final = 10
MANY_SENDERS: Final = 5
W_TRANSIT: Final = 15
W_RECIPIENT_SHARED_DEVICE: Final = 15
W_SENDER_DEVICE_SHARED: Final = 15
W_FLAGGED: Final = 40

# Fan-in alone describes a *collection* (birthday, rent split, small business), not a mule.
# Collection signals keep full weight only when something says the money is leaving the
# recipient or the recipient sits in a mule structure; otherwise they are downgraded.
COLLECTION_WEIGHTS: Final[dict[str, int]] = {
    "DROP_HUB_FAN_IN": 10,
    "FAN_IN_VELOCITY": 5,
    "RECIPIENT_MANY_SENDERS": 5,
}
MULE_CORROBORATION: Final = frozenset(
    {
        "RECIPIENT_INSTANT_CASHOUT",
        "RECIPIENT_TRANSIT_RATIO",
        "RECIPIENT_SHARED_DEVICE",
        "RECIPIENT_FLAGGED",
    }
)


@dataclass(frozen=True, slots=True)
class TransferContext:
    tx_id: str
    sender_id: str
    recipient_id: str
    amount: float
    device_id: str
    occurred_at: datetime
    sender_avg_amount: float = 0.0
    active_call: bool = False
    from_deposit: bool = False
    is_new_device: bool = False
    is_new_recipient: bool | None = None  # None → derived from the transfer graph
    pasted_recipient: bool = False
    typing_duration_ms: int | None = None
    hesitation_count: int = 0
    recipient_input_length: int | None = None
    hesitation_ms: int | None = None


@dataclass(frozen=True, slots=True)
class RiskReason:
    code: str
    layer: str
    score_delta: int
    reason_kk: str
    reason_ru: str
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Evaluation:
    tx_id: str
    score: int
    decision: TransactionStatus
    reasons: list[RiskReason]
    is_new_recipient: bool
    latency_ms: float
    layer_latency_ms: dict[str, float]
    velocity: VelocitySnapshot
    recipient_graph: GraphMetrics
    headline_kk: str
    headline_ru: str
    cooling_off_minutes: int
    ml_score: float
    ml_base_score: float
    ml_contributors: tuple[Contributor, ...]

    @property
    def reasons_kk(self) -> list[str]:
        return [r.reason_kk for r in self.reasons]

    @property
    def reasons_ru(self) -> list[str]:
        return [r.reason_ru for r in self.reasons]


def decide(score: int) -> TransactionStatus:
    if score >= BLOCK_THRESHOLD:
        return TransactionStatus.BLOCKED
    if score >= COOLING_OFF_THRESHOLD:
        return TransactionStatus.COOLING_OFF
    return TransactionStatus.APPROVED


def _reason(code: str, layer: str, delta: int, **evidence: Any) -> RiskReason:
    kk, ru = explain.render(code, **evidence)
    return RiskReason(code, layer, delta, kk, ru, evidence)


def _corroborate(network: list[RiskReason]) -> list[RiskReason]:
    codes = {r.code for r in network}
    if codes & MULE_CORROBORATION or not codes & COLLECTION_WEIGHTS.keys():
        return network
    adjusted = [
        replace(
            r,
            score_delta=min(r.score_delta, COLLECTION_WEIGHTS[r.code]),
            evidence={**r.evidence, "corroborated": False},
        )
        if r.code in COLLECTION_WEIGHTS
        else r
        for r in network
    ]
    adjusted.append(_reason("FAN_IN_UNCORROBORATED", LAYER_GRAPH, 0))
    return adjusted


class AntifraudEngine:
    def __init__(
        self,
        redis: Redis,
        graph: GraphStore,
        *,
        timezone: str = "Asia/Almaty",
        cooling_off_minutes: int = 15,
    ) -> None:
        self.graph = graph
        self.velocity = VelocityCounters(redis)
        self._tz = ZoneInfo(timezone)
        self.cooling_off_minutes = cooling_off_minutes
        self.model = get_model()  # train/load once, outside the request latency budget

    # ------------------------------------------------------------------ public
    async def evaluate(self, ctx: TransferContext) -> Evaluation:
        t0 = time.perf_counter()

        is_new_recipient = (
            ctx.is_new_recipient
            if ctx.is_new_recipient is not None
            else not self.graph.has_transfer(ctx.sender_id, ctx.recipient_id)
        )
        behavioral = self._behavioral(ctx, is_new_recipient)
        t1 = time.perf_counter()

        snapshot = await self.velocity.record_and_snapshot(
            tx_id=ctx.tx_id,
            sender_id=ctx.sender_id,
            recipient_id=ctx.recipient_id,
            amount=ctx.amount,
            ts=ctx.occurred_at.timestamp(),
        )
        velocity = self._velocity(ctx, snapshot)
        t2 = time.perf_counter()

        recipient_metrics = self.graph.metrics(ctx.recipient_id)
        graph = self._graph(ctx, recipient_metrics, is_new_recipient)
        self.graph.link_device(ctx.sender_id, ctx.device_id)
        t3 = time.perf_counter()

        network = _corroborate([*velocity, *graph])
        features = Features(
            amount_ratio=ctx.amount / ctx.sender_avg_amount if ctx.sender_avg_amount > 0 else 1.0,
            night_hour=ctx.occurred_at.astimezone(self._tz).hour in NIGHT_HOURS,
            new_recipient=is_new_recipient,
            active_call=ctx.active_call,
            deposit_withdrawal=ctx.from_deposit,
            fan_in_velocity=snapshot.recipient_in.distinct("30m"),
            transit_ratio=recipient_metrics.transit_ratio,
            paste_detected=ctx.pasted_recipient,
            typing_speed_cps=(
                ctx.recipient_input_length * 1000 / ctx.typing_duration_ms
                if ctx.recipient_input_length is not None and ctx.typing_duration_ms
                else -1.0
            ),
            hesitation_ms=ctx.hesitation_ms if ctx.hesitation_ms is not None else -1,
            hesitation_count=ctx.hesitation_count,
            new_device=ctx.is_new_device,
        )
        prediction = self.model.score(features)
        t_ml = time.perf_counter()
        reasons = sorted([*behavioral, *network], key=lambda r: (-r.score_delta, r.code))
        raw = sum(r.score_delta for r in reasons)
        # Bounded residual blend: preserve rule floors; weak synthetic probabilities
        # add no friction. ML can add at most 15 points and cannot itself justify a block.
        ml_delta = round(0.25 * max(0.0, prediction.score - 40.0))
        network_evidence = bool(network)
        rule_score = max(0, min(100 if network_evidence else BEHAVIORAL_ONLY_CAP, raw))
        # Preserve all rule floors, but ML may cross into BLOCKED only with
        # corroborated recipient-side mule evidence. A sender pass-through signal
        # by itself still gets the existing questionnaire, not an ML-only block.
        corroborated = any(r.code in MULE_CORROBORATION for r in network)
        cap = 100 if corroborated else max(rule_score, BEHAVIORAL_ONLY_CAP)
        score = min(cap, rule_score + ml_delta)
        if score > rule_score:
            reasons.append(
                _reason(
                    "ML_RISK_UPLIFT",
                    LAYER_ML,
                    score - rule_score,
                    ml_score=round(prediction.score, 2),
                )
            )
            reasons.sort(key=lambda r: (-r.score_delta, r.code))
        decision = decide(score)
        head_kk, head_ru = explain.headline(decision, minutes=self.cooling_off_minutes)
        t4 = time.perf_counter()

        return Evaluation(
            tx_id=ctx.tx_id,
            score=score,
            decision=decision,
            reasons=reasons,
            is_new_recipient=is_new_recipient,
            latency_ms=round((t4 - t0) * 1000, 3),
            layer_latency_ms={
                LAYER_BEHAVIORAL: round((t1 - t0) * 1000, 3),
                LAYER_VELOCITY: round((t2 - t1) * 1000, 3),
                LAYER_GRAPH: round((t3 - t2) * 1000, 3),
                LAYER_ML: round((t_ml - t3) * 1000, 3),
                "decision": round((t4 - t_ml) * 1000, 3),
            },
            velocity=snapshot,
            recipient_graph=recipient_metrics,
            headline_kk=head_kk,
            headline_ru=head_ru,
            cooling_off_minutes=self.cooling_off_minutes,
            ml_score=round(prediction.score, 4),
            ml_base_score=round(prediction.base_score, 4),
            ml_contributors=prediction.contributors[:5],
        )

    def apply_transfer(self, ctx: TransferContext) -> None:
        """Commit a released (approved) transfer into the money-flow graph."""
        self.graph.add_transfer(
            ctx.sender_id, ctx.recipient_id, ctx.amount, ts=ctx.occurred_at.timestamp()
        )

    # --------------------------------------------------------------- layer 1
    def _behavioral(self, ctx: TransferContext, is_new_recipient: bool) -> list[RiskReason]:
        out: list[RiskReason] = []
        if ctx.active_call:
            out.append(_reason("ACTIVE_CALL", LAYER_BEHAVIORAL, W_ACTIVE_CALL))
        if ctx.active_call and ctx.pasted_recipient:
            out.append(_reason("PASTED_DURING_CALL", LAYER_BEHAVIORAL, 15))
        if ctx.from_deposit:
            out.append(_reason("DEPOSIT_WITHDRAWAL", LAYER_BEHAVIORAL, W_DEPOSIT))
        if is_new_recipient:
            out.append(_reason("NEW_RECIPIENT", LAYER_BEHAVIORAL, W_NEW_RECIPIENT))
        if ctx.sender_avg_amount > 0:
            ratio = ctx.amount / ctx.sender_avg_amount
            delta = W_AMOUNT_10X if ratio >= 10 else W_AMOUNT_3X if ratio >= 3 else 0
            if delta:
                out.append(
                    _reason(
                        "AMOUNT_SPIKE",
                        LAYER_BEHAVIORAL,
                        delta,
                        ratio=explain.fmt_ratio(ratio),
                        amount=explain.fmt_tenge(ctx.amount),
                        avg=explain.fmt_tenge(ctx.sender_avg_amount),
                    )
                )
        if ctx.is_new_device:
            out.append(_reason("NEW_DEVICE", LAYER_BEHAVIORAL, W_NEW_DEVICE))
        local = ctx.occurred_at.astimezone(self._tz)
        is_night = local.hour in NIGHT_HOURS
        if is_night:
            out.append(
                _reason("NIGHT_HOURS", LAYER_BEHAVIORAL, W_NIGHT, time=local.strftime("%H:%M"))
            )
        if ctx.active_call and (ctx.from_deposit or is_new_recipient):
            out.append(_reason("SOCIAL_ENGINEERING_PATTERN", LAYER_BEHAVIORAL, W_SE_PATTERN))
        if ctx.is_new_device and is_night:
            out.append(_reason("ACCOUNT_TAKEOVER_PATTERN", LAYER_BEHAVIORAL, W_ATO_PATTERN))
        return out

    # --------------------------------------------------------------- layer 2a
    def _velocity(self, ctx: TransferContext, snap: VelocitySnapshot) -> list[RiskReason]:
        out: list[RiskReason] = []
        burst = snap.sender_out.count("10m")
        if burst >= SENDER_BURST_10M:
            out.append(_reason("SENDER_BURST", LAYER_VELOCITY, W_SENDER_BURST, n=burst))

        # Fan-in counts DISTINCT senders: one customer repeatedly paying a known
        # recipient is not a drop hub.
        fan_in_30m = snap.recipient_in.distinct("30m")
        fan_in_1h = snap.recipient_in.distinct("1h")
        if fan_in_30m >= HUB_FAN_IN_30M:
            out.append(_reason("DROP_HUB_FAN_IN", LAYER_VELOCITY, W_HUB_FAN_IN, n=fan_in_30m))
        elif fan_in_1h >= FAN_IN_1H:
            out.append(_reason("FAN_IN_VELOCITY", LAYER_VELOCITY, W_FAN_IN, n=fan_in_1h))

        r_in, r_out = snap.recipient_in.volume("1h"), snap.recipient_out.volume("1h")
        r_in_prior = r_in - ctx.amount  # money that was already sitting with the recipient
        if snap.recipient_in.distinct("1h") > PASS_THROUGH_MIN_IN and r_in_prior > 0:
            ratio = r_out / r_in_prior
            if ratio >= CASHOUT_RATIO:
                out.append(
                    _reason(
                        "RECIPIENT_INSTANT_CASHOUT",
                        LAYER_VELOCITY,
                        W_INSTANT_CASHOUT,
                        pct=min(100, round(ratio * 100)),
                    )
                )

        s_in_n, s_in = snap.sender_in.distinct("1h"), snap.sender_in.volume("1h")
        if s_in_n >= PASS_THROUGH_MIN_IN and s_in > 0:
            ratio = snap.sender_out.volume("1h") / s_in  # includes the current transfer
            if ratio >= CASHOUT_RATIO:
                out.append(
                    _reason(
                        "SENDER_PASS_THROUGH",
                        LAYER_VELOCITY,
                        W_PASS_THROUGH,
                        n=s_in_n,
                        pct=min(100, round(ratio * 100)),
                    )
                )
        return out

    # --------------------------------------------------------------- layer 2b
    def _graph(
        self, ctx: TransferContext, rm: GraphMetrics, is_new_recipient: bool
    ) -> list[RiskReason]:
        out: list[RiskReason] = []
        senders = rm.in_degree + (1 if is_new_recipient else 0)
        if senders >= MANY_SENDERS_HIGH:
            out.append(
                _reason("RECIPIENT_MANY_SENDERS", LAYER_GRAPH, W_MANY_SENDERS_HIGH, n=senders)
            )
        elif senders >= MANY_SENDERS:
            out.append(_reason("RECIPIENT_MANY_SENDERS", LAYER_GRAPH, W_MANY_SENDERS, n=senders))

        if rm.in_degree >= TRANSIT_MIN_SENDERS and rm.transit_ratio >= TRANSIT_RATIO:
            out.append(
                _reason(
                    "RECIPIENT_TRANSIT_RATIO",
                    LAYER_GRAPH,
                    W_TRANSIT,
                    ratio=f"{rm.transit_ratio:.2f}".replace(".", ","),
                )
            )
        if rm.shared_device_accounts >= SHARED_DEVICE_MIN:
            out.append(
                _reason(
                    "RECIPIENT_SHARED_DEVICE",
                    LAYER_GRAPH,
                    W_RECIPIENT_SHARED_DEVICE,
                    n=rm.shared_device_accounts,
                )
            )
        others_on_device = self.graph.accounts_on_device(ctx.device_id) - {ctx.sender_id}
        if len(others_on_device) >= SHARED_DEVICE_MIN:
            out.append(
                _reason(
                    "SENDER_DEVICE_SHARED",
                    LAYER_GRAPH,
                    W_SENDER_DEVICE_SHARED,
                    n=len(others_on_device),
                )
            )
        if rm.flagged:
            out.append(_reason("RECIPIENT_FLAGGED", LAYER_GRAPH, W_FLAGGED))
        return out
