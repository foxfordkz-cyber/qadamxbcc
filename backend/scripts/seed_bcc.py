"""BCC Shield — deterministic Kazakhstan synthetic seed (T03).

Wipes and re-creates (idempotent):

* the 4 fixed demo accounts used by the Next.js live presets (``DEMO_ACCOUNTS``):
  Sender, Friend (prior approved history with Sender), Stranger (scam target) and
  Dropper Hub (12 distinct victims in the last 30 min, rapid cash-out, 1 account
  sharing its device_id) — written to Postgres *and* the Redis velocity windows;
* 295 background accounts: checksum-valid 12-digit IINs, BCC KZ IBANs (bank code
  856), Kazakh / Russian full names, phones, device ids, average transfer amounts;
* ~2,500 background transactions scored by the real ``AntifraudEngine`` (genuine
  reasons, latency and velocity), plus aggregated ``graph_edges``.

Usage (schema must exist — the backend container runs ``alembic upgrade head``)::

    docker compose exec backend python -m scripts.seed_bcc
    docker compose restart backend      # re-hydrate the resident graph

The hub's velocity evidence is time-bound: re-seed within ~1 hour of the live demo.
"""

import argparse
import asyncio
import math
import random
import time
import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from datetime import time as dtime
from decimal import Decimal
from typing import Final
from zoneinfo import ZoneInfo

from redis.asyncio import Redis
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.kz import iin_check_digit, make_kz_iban
from app.db.session import build_engine, build_session_factory
from app.models import Account, EdgeType, GraphEdge, RiskEvent, Transaction, TransactionStatus
from app.services import explain
from app.services.antifraud import AntifraudEngine, Evaluation, TransferContext
from app.services.graph import GraphStore
from app.services.transfers import BLOCKED_AFTER_RED_FLAG_SCORE, RED_FLAG_LABELS
from app.services.velocity import KEY_PREFIX

RNG_SEED: Final = 20261126
BACKGROUND_ACCOUNTS: Final = 295
BACKGROUND_TRANSACTIONS: Final = 2500
HISTORY_DAYS: Final = 30
ALMATY: Final = ZoneInfo("Asia/Almaty")
BATCH: Final = 500

# --------------------------------------------------------------------------- demo accounts
SENDER_ID: Final = uuid.UUID("00000000-0000-4000-8000-000000000001")
FRIEND_ID: Final = uuid.UUID("00000000-0000-4000-8000-000000000002")
STRANGER_ID: Final = uuid.UUID("00000000-0000-4000-8000-000000000003")
HUB_ID: Final = uuid.UUID("00000000-0000-4000-8000-000000000004")
HUB_DEVICE: Final = "android-hub-7f3e9a1c"

HUB_VICTIMS: Final = 12
VICTIM_WINDOW_MIN: Final = 14  # victims land between now-14m and now-3m (inside 30 min)
CASHOUT_SHARES: Final = (0.50, 0.35)  # 85 % of the inflow leaves within minutes


@dataclass(frozen=True, slots=True)
class DemoAccount:
    id: uuid.UUID
    full_name: str
    phone: str
    role: str
    avg: Decimal
    age_days: int
    device_id: str | None = None


DEMO_ACCOUNTS: Final[tuple[DemoAccount, ...]] = (
    DemoAccount(SENDER_ID, "Аружан С.", "+77010000001", "sender", Decimal("25000"), 1_600),
    DemoAccount(FRIEND_ID, "Данияр А.", "+77010000002", "friend", Decimal("30000"), 1_200),
    DemoAccount(STRANGER_ID, "Алексей К.", "+77010000003", "stranger", Decimal("20000"), 3),
    DemoAccount(HUB_ID, "Марат Т.", "+77010000004", "dropper_hub", Decimal("150000"), 30,
                HUB_DEVICE),
)  # fmt: skip


@dataclass(frozen=True, slots=True)
class DemoPreset:
    """Mirrors ``frontend/src/lib/config.ts`` presets (recipient resolved by phone)."""

    key: str
    sender_id: uuid.UUID
    recipient_phone: str
    amount: Decimal
    expected: TransactionStatus
    context: dict[str, bool] = field(default_factory=dict)

    def payload(self) -> dict[str, object]:
        """Request body for ``POST /api/v1/transfers/evaluate``."""
        return {
            "sender_id": str(self.sender_id),
            "recipient_phone": self.recipient_phone,
            "amount": str(self.amount),
            "context": dict(self.context),
        }


_NO_CTX: Final = {"active_call": False, "from_deposit": False, "is_new_device": False}
DEMO_PRESETS: Final[tuple[DemoPreset, ...]] = (
    DemoPreset("normal", SENDER_ID, "+77010000002", Decimal("25000"),
               TransactionStatus.APPROVED, {**_NO_CTX, "is_new_recipient": False}),
    DemoPreset("scam", SENDER_ID, "+77010000003", Decimal("900000"),
               TransactionStatus.COOLING_OFF,
               {**_NO_CTX, "active_call": True, "from_deposit": True, "is_new_recipient": True}),
    DemoPreset("hub", SENDER_ID, "+77010000004", Decimal("250000"),
               TransactionStatus.BLOCKED, {**_NO_CTX, "is_new_recipient": True}),
)  # fmt: skip

# --------------------------------------------------------------------------- names
KZ_MALE: Final = (
    "Ерлан", "Нурлан", "Асхат", "Даурен", "Ержан", "Бауыржан", "Арман", "Санжар",
    "Айдос", "Темирлан", "Нурсултан", "Мадияр", "Алихан", "Дамир", "Ерасыл", "Қайрат",
    "Серік", "Талгат", "Жандос", "Әлібек",
)  # fmt: skip
KZ_FEMALE: Final = (
    "Айгерим", "Гульнара", "Динара", "Жанар", "Сауле", "Айжан", "Мадина", "Аружан",
    "Камила", "Асель", "Дана", "Жансая", "Томирис", "Әсем", "Алия", "Гаухар", "Мөлдір",
    "Ақбота",
)  # fmt: skip
KZ_SURNAMES: Final = (
    "Ахметов", "Жумабаев", "Нурланов", "Касымов", "Абдрахманов", "Есенов", "Омаров",
    "Сулейменов", "Тулегенов", "Байжанов", "Мухаметжанов", "Искаков", "Каримов",
    "Жаксылыков", "Оспанов", "Бекмуханбетов", "Утемисов", "Кенжебаев", "Садыков",
    "Сейткали", "Әбдіқадыр",
)  # fmt: skip
KZ_FATHERS: Final = (
    "Ерлан", "Нурлан", "Асхат", "Даурен", "Серік", "Қайрат", "Талгат", "Бауыржан",
    "Арман", "Марат", "Болат", "Жомарт",
)  # fmt: skip
RU_MALE: Final = (
    "Александр", "Дмитрий", "Сергей", "Андрей", "Алексей", "Максим", "Иван", "Никита",
    "Павел", "Игорь", "Владимир", "Евгений",
)  # fmt: skip
RU_FEMALE: Final = (
    "Анна", "Елена", "Ольга", "Наталья", "Татьяна", "Екатерина", "Мария", "Ирина",
    "Светлана", "Юлия", "Ксения", "Виктория",
)  # fmt: skip
RU_SURNAMES: Final = (
    "Иванов", "Петров", "Смирнов", "Кузнецов", "Попов", "Васильев", "Соколов", "Морозов",
    "Новиков", "Фёдоров", "Волков", "Лебедев", "Ковалёв", "Ким", "Шевченко", "Цой",
)  # fmt: skip
RU_PATRONYMICS: Final = (
    ("Александрович", "Александровна"), ("Дмитриевич", "Дмитриевна"),
    ("Сергеевич", "Сергеевна"), ("Андреевич", "Андреевна"), ("Иванович", "Ивановна"),
    ("Владимирович", "Владимировна"), ("Николаевич", "Николаевна"),
    ("Петрович", "Петровна"), ("Викторович", "Викторовна"),
)  # fmt: skip
PHONE_PREFIXES: Final = (
    "700", "701", "702", "705", "707", "708", "747", "771", "775", "776", "777", "778",
)  # fmt: skip


def _female_surname(surname: str) -> str:
    return surname + "а" if surname.endswith(("ов", "ев", "ёв", "ин")) else surname


# --------------------------------------------------------------------------- generators
@dataclass(slots=True)
class Person:
    id: uuid.UUID
    full_name: str
    iin: str
    iban: str
    phone: str
    device_id: str
    avg: Decimal
    created_at: datetime
    contacts: list[uuid.UUID] = field(default_factory=list)

    def to_account(self) -> Account:
        return Account(
            id=self.id,
            iin=self.iin,
            iban=self.iban,
            phone=self.phone,
            full_name=self.full_name,
            device_id=self.device_id,
            avg_tx_amount=self.avg,
            is_flagged=False,
            created_at=self.created_at,
        )


class Factory:
    def __init__(self, rng: random.Random, now: datetime) -> None:
        self.rng = rng
        self.now = now
        self._iins: set[str] = set()
        self._ibans: set[str] = set()
        self._phones: set[str] = {a.phone for a in DEMO_ACCOUNTS}
        self._devices: set[str] = {HUB_DEVICE}

    def _unique(self, pool: set[str], make: Callable[[], str]) -> str:
        while True:
            value = make()
            if value not in pool:
                pool.add(value)
                return value

    def iin(self, male: bool) -> str:
        """YYMMDD + century/sex digit + 4-digit serial + control digit (unassignable skipped)."""
        while True:
            year = self.rng.randint(1958, 2006)
            month, day = self.rng.randint(1, 12), self.rng.randint(1, 28)
            century = (3 if male else 4) if year < 2000 else (5 if male else 6)
            head = f"{year % 100:02d}{month:02d}{day:02d}{century}{self.rng.randint(0, 9999):04d}"
            check = iin_check_digit(head)
            if check is not None and (iin := f"{head}{check}") not in self._iins:
                self._iins.add(iin)
                return iin

    def iban(self) -> str:
        return self._unique(
            self._ibans, lambda: make_kz_iban(f"{self.rng.randrange(10**12, 10**13):013d}")
        )

    def phone(self) -> str:
        return self._unique(
            self._phones,
            lambda: f"+7{self.rng.choice(PHONE_PREFIXES)}{self.rng.randint(0, 9_999_999):07d}",
        )

    def device(self) -> str:
        return self._unique(
            self._devices,
            lambda: f"{self.rng.choice(('ios', 'android'))}-{self.rng.getrandbits(48):012x}",
        )

    def name(self, male: bool) -> str:
        if self.rng.random() < 0.7:
            first = self.rng.choice(KZ_MALE if male else KZ_FEMALE)
            surname = self.rng.choice(KZ_SURNAMES)
            father = self.rng.choice(KZ_FATHERS)
            patronymic = f"{father}ович" if male else f"{father}овна"
        else:
            first = self.rng.choice(RU_MALE if male else RU_FEMALE)
            surname = self.rng.choice(RU_SURNAMES)
            patronymic = self.rng.choice(RU_PATRONYMICS)[0 if male else 1]
        return f"{surname if male else _female_surname(surname)} {first} {patronymic}"

    def avg_amount(self, median: float = 35_000) -> Decimal:
        value = self.rng.lognormvariate(math.log(median), 0.55)
        return Decimal(int(min(max(value, 3_000), 400_000) // 100 * 100))

    def background(self) -> Person:
        male = self.rng.random() < 0.5
        return Person(
            id=uuid.UUID(int=self.rng.getrandbits(128), version=4),
            full_name=self.name(male),
            iin=self.iin(male),
            iban=self.iban(),
            phone=self.phone(),
            device_id=self.device(),
            avg=self.avg_amount(),
            created_at=self.now - timedelta(days=self.rng.randint(120, 2_500)),
        )

    def demo(self, spec: DemoAccount) -> Person:
        male = spec.role in ("friend", "stranger", "dropper_hub")
        return Person(
            id=spec.id,
            full_name=spec.full_name,
            iin=self.iin(male),
            iban=self.iban(),
            phone=spec.phone,
            device_id=spec.device_id or self.device(),
            avg=spec.avg,
            created_at=self.now - timedelta(days=spec.age_days),
        )


@dataclass(slots=True)
class Population:
    demo: dict[uuid.UUID, Person]
    background: list[Person]
    victims: list[Person]
    cashouts: list[Person]
    device_twin: Person

    @property
    def everyone(self) -> list[Person]:
        return [*self.demo.values(), *self.background]

    @property
    def organic(self) -> list[Person]:
        """Background customers that take part in normal day-to-day flows."""
        ring = {p.id for p in (*self.cashouts, self.device_twin)}
        return [p for p in self.background if p.id not in ring]


def build_population(rng: random.Random, now: datetime, n_background: int) -> Population:
    if n_background < HUB_VICTIMS + len(CASHOUT_SHARES) + 1 + 20:
        raise ValueError("too few background accounts for the dropper ring")
    f = Factory(rng, now)
    demo = {a.id: f.demo(a) for a in DEMO_ACCOUNTS}
    background = [f.background() for _ in range(n_background)]

    # Ring roles live inside the background population (victims are ordinary customers).
    cashouts = background[-len(CASHOUT_SHARES) - 1 : -1]
    device_twin = background[-1]
    device_twin.device_id = HUB_DEVICE  # the single account sharing the hub's phone
    for mule in (*cashouts, device_twin):
        mule.created_at = now - timedelta(days=rng.randint(10, 45))
    victims = rng.sample(background[: -len(CASHOUT_SHARES) - 1], HUB_VICTIMS)

    pop = Population(demo, background, victims, cashouts, device_twin)
    organic = pop.organic
    for p in organic:
        p.contacts = [c.id for c in rng.sample(organic, rng.randint(3, 7)) if c.id != p.id]
    return pop


# --------------------------------------------------------------------------- planning
@dataclass(frozen=True, slots=True)
class PlannedTransfer:
    sender: Person
    recipient: Person
    amount: Decimal
    at: datetime
    device_id: str
    active_call: bool = False
    from_deposit: bool = False
    is_new_device: bool = False


@dataclass(slots=True)
class SeedReport:
    accounts: int = 0
    transactions: int = 0
    by_status: dict[str, int] = field(default_factory=dict)
    graph_edges: int = 0
    redis_keys_cleared: int = 0
    engine_p95_ms: float = 0.0
    elapsed_s: float = 0.0


def _money(value: float) -> Decimal:
    return Decimal(max(500, int(value // 100 * 100)))


def _local_moment(rng: random.Random, now: datetime, days_back: int) -> datetime:
    """A plausible Almaty-local moment ``days_back`` days ago (4 % at night)."""
    day = (now.astimezone(ALMATY) - timedelta(days=days_back)).date()
    hour = rng.randint(0, 5) if rng.random() < 0.04 else rng.randint(8, 23)
    moment = datetime.combine(
        day, dtime(hour, rng.randint(0, 59), rng.randint(0, 59)), tzinfo=ALMATY
    )
    return min(moment.astimezone(UTC), now - timedelta(hours=2))


def plan_background(
    rng: random.Random, now: datetime, pop: Population, n_transfers: int
) -> list[PlannedTransfer]:
    """Scripted Sender↔Friend history plus organic day-to-day transfers."""
    organic = pop.organic
    by_id = {p.id: p for p in pop.everyone}
    sender, friend = pop.demo[SENDER_ID], pop.demo[FRIEND_ID]
    plan: list[PlannedTransfer] = []

    def clean(s: Person, r: Person, amount: float, at: datetime) -> None:
        plan.append(PlannedTransfer(s, r, _money(amount), at, s.device_id))

    # Prior approved history between Sender and Friend (both directions).
    for days, amount in ((27, 22_000), (20, 27_500), (13, 24_000), (6, 26_000), (2, 23_500)):
        clean(sender, friend, amount, _local_moment(rng, now, days))
    for days, amount in ((16, 15_000), (4, 18_500)):
        clean(friend, sender, amount, _local_moment(rng, now, days))
    # Sender and Friend also live ordinary financial lives.
    for person in (sender, friend):
        for contact in rng.sample(organic, 4):
            for _ in range(rng.randint(1, 3)):
                value = float(person.avg) * rng.lognormvariate(0, 0.35)
                clean(person, contact, value, _local_moment(rng, now, rng.randint(1, 29)))

    while len(plan) < n_transfers:
        s = rng.choice(organic)
        r = by_id[rng.choice(s.contacts)] if rng.random() > 0.12 else rng.choice(organic)
        if r.id == s.id:
            continue
        new_device = rng.random() < 0.02
        value = float(s.avg) * rng.lognormvariate(0, 0.45)
        if rng.random() < 0.03:
            value *= rng.uniform(3, 8)
        plan.append(
            PlannedTransfer(
                sender=s,
                recipient=r,
                amount=_money(value),
                at=_local_moment(rng, now, rng.randint(1, HISTORY_DAYS)),
                device_id=f"android-{rng.getrandbits(48):012x}" if new_device else s.device_id,
                active_call=rng.random() < 0.02,
                from_deposit=rng.random() < 0.03,
                is_new_device=new_device,
            )
        )

    plan.sort(key=lambda t: t.at)
    return plan[:n_transfers]


def plan_hub_ring(rng: random.Random, now: datetime, pop: Population) -> list[PlannedTransfer]:
    """12 distinct victims → hub inside the last 30 min, then rapid cash-out (85 %)."""
    hub = pop.demo[HUB_ID]
    staged: list[PlannedTransfer] = []
    start = now - timedelta(minutes=VICTIM_WINDOW_MIN)
    inflow = 0
    for i, victim in enumerate(pop.victims):
        amount = rng.randrange(70_000, 130_001, 500)
        inflow += amount
        staged.append(
            PlannedTransfer(
                victim, hub, Decimal(amount), start + timedelta(minutes=i), victim.device_id
            )
        )
    for i, (mule, share) in enumerate(zip(pop.cashouts, CASHOUT_SHARES, strict=True)):
        staged.append(
            PlannedTransfer(
                hub,
                mule,
                Decimal(int(inflow * share) // 100 * 100),
                now - timedelta(minutes=2 - i),
                hub.device_id,
            )
        )
    return staged


# --------------------------------------------------------------------------- persistence
class EdgeBook:
    def __init__(self) -> None:
        self._edges: dict[tuple[uuid.UUID, uuid.UUID], list[float]] = {}

    def add(self, s: uuid.UUID, r: uuid.UUID, amount: float, ts: float) -> None:
        edge = self._edges.setdefault((s, r), [0.0, 0.0, 0.0])
        edge[0] += amount
        edge[1] += 1
        edge[2] = max(edge[2], ts)

    def rows(self) -> Iterable[GraphEdge]:
        for (s, r), (weight, count, ts) in self._edges.items():
            yield GraphEdge(
                source_id=s,
                target_id=r,
                edge_type=EdgeType.TRANSFER,
                weight=round(weight, 2),
                tx_count=int(count),
                last_seen_at=datetime.fromtimestamp(ts, UTC),
            )


def _risk_events(ev: Evaluation, at: datetime) -> list[RiskEvent]:
    return [
        RiskEvent(
            layer=r.layer,
            rule_code=r.code,
            score_delta=r.score_delta,
            reason_kk=r.reason_kk,
            reason_ru=r.reason_ru,
            created_at=at,
        )
        for r in ev.reasons
    ]


def _resolve_historic_cooling(
    rng: random.Random, tx: Transaction, ev: Evaluation, at: datetime
) -> bool:
    """Historic holds were answered long ago: 85 % released, 15 % confirmed scams."""
    resolved = at + timedelta(minutes=rng.randint(2, 12))
    tx.resolved_at = resolved
    if rng.random() < 0.85:
        kk, ru = explain.render("QUESTIONNAIRE_PASSED")
        tx.status = TransactionStatus.APPROVED
        code, delta = "QUESTIONNAIRE_PASSED", 0
    else:
        flag_kk, flag_ru = RED_FLAG_LABELS["caller_claims_bank_or_police"]
        tpl_kk, tpl_ru = explain.REASONS["QUESTIONNAIRE_RED_FLAG"]
        kk, ru = tpl_kk.format(flags=flag_kk), tpl_ru.format(flags=flag_ru)
        delta = max(0, BLOCKED_AFTER_RED_FLAG_SCORE - ev.score)
        tx.status = TransactionStatus.BLOCKED
        tx.risk_score = max(ev.score, BLOCKED_AFTER_RED_FLAG_SCORE)
        code = "QUESTIONNAIRE_RED_FLAG"
    tx.risk_events.append(
        RiskEvent(
            layer="questionnaire",
            rule_code=code,
            score_delta=delta,
            reason_kk=kk,
            reason_ru=ru,
            created_at=resolved,
        )
    )
    return tx.status is TransactionStatus.APPROVED


async def _clear(session: AsyncSession, redis: Redis) -> int:
    for model in (RiskEvent, Transaction, GraphEdge, Account):
        await session.execute(delete(model))
    await session.commit()
    keys = [k async for k in redis.scan_iter(match=f"{KEY_PREFIX}:*", count=1_000)]
    for i in range(0, len(keys), 1_000):
        await redis.delete(*keys[i : i + 1_000])
    return len(keys)


async def _flush(session: AsyncSession, rows: list[Transaction]) -> None:
    session.add_all(rows)
    await session.commit()
    rows.clear()


def _new_id(rng: random.Random) -> uuid.UUID:
    return uuid.UUID(int=rng.getrandbits(128), version=4)


async def seed(
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    *,
    n_background_accounts: int = BACKGROUND_ACCOUNTS,
    n_background_transactions: int = BACKGROUND_TRANSACTIONS,
    rng_seed: int = RNG_SEED,
    now: datetime | None = None,
) -> SeedReport:
    started = time.perf_counter()
    await redis.ping()  # connect before scoring so no history row carries connect latency
    rng = random.Random(rng_seed)
    now = (now or datetime.now(UTC)).astimezone(UTC).replace(microsecond=0)
    settings = get_settings()
    report = SeedReport()

    pop = build_population(rng, now, n_background_accounts)
    background = plan_background(rng, now, pop, n_background_transactions)
    ring = plan_hub_ring(rng, now, pop)

    engine = AntifraudEngine(
        redis,
        GraphStore(),
        timezone=settings.timezone,
        cooling_off_minutes=settings.cooling_off_minutes,
    )
    for p in pop.everyone:
        engine.graph.add_account(str(p.id), label=p.full_name, device_id=p.device_id)
    edges = EdgeBook()
    latencies: list[float] = []

    async with session_factory() as session:
        report.redis_keys_cleared = await _clear(session, redis)
        session.add_all(p.to_account() for p in pop.everyone)
        await session.commit()

        pending: list[Transaction] = []
        for t in background:
            ctx = TransferContext(
                tx_id=str(_new_id(rng)),
                sender_id=str(t.sender.id),
                recipient_id=str(t.recipient.id),
                amount=float(t.amount),
                device_id=t.device_id,
                occurred_at=t.at,
                sender_avg_amount=float(t.sender.avg),
                active_call=t.active_call,
                from_deposit=t.from_deposit,
                is_new_device=t.is_new_device,
            )
            ev = await engine.evaluate(ctx)
            latencies.append(ev.latency_ms)
            tx = Transaction(
                id=uuid.UUID(ctx.tx_id),
                sender_id=t.sender.id,
                recipient_id=t.recipient.id,
                amount=t.amount,
                status=ev.decision,
                risk_score=ev.score,
                latency_ms=ev.latency_ms,
                device_id=t.device_id,
                active_call=t.active_call,
                from_deposit=t.from_deposit,
                is_new_device=t.is_new_device,
                is_new_recipient=ev.is_new_recipient,
                created_at=t.at,
            )
            tx.risk_events = _risk_events(ev, t.at)
            settled = ev.decision is TransactionStatus.APPROVED
            if ev.decision is TransactionStatus.COOLING_OFF:
                tx.cooling_until = t.at + timedelta(minutes=engine.cooling_off_minutes)
                settled = _resolve_historic_cooling(rng, tx, ev, t.at)
            if settled:
                engine.apply_transfer(ctx)
                edges.add(t.sender.id, t.recipient.id, float(t.amount), t.at.timestamp())
            pending.append(tx)
            if len(pending) >= BATCH:
                await _flush(session, pending)

        # Dropper ring: settled before the demo, mirrored into the Redis velocity windows.
        for t in ring:
            tx_id = _new_id(rng)
            await engine.velocity.record_and_snapshot(
                tx_id=str(tx_id),
                sender_id=str(t.sender.id),
                recipient_id=str(t.recipient.id),
                amount=float(t.amount),
                ts=t.at.timestamp(),
            )
            edges.add(t.sender.id, t.recipient.id, float(t.amount), t.at.timestamp())
            pending.append(
                Transaction(
                    id=tx_id,
                    sender_id=t.sender.id,
                    recipient_id=t.recipient.id,
                    amount=t.amount,
                    status=TransactionStatus.APPROVED,
                    risk_score=0,
                    latency_ms=0.0,
                    device_id=t.device_id,
                    is_new_recipient=True,
                    created_at=t.at,
                )
            )
        await _flush(session, pending)

        edge_rows = list(edges.rows())
        edge_rows.append(
            GraphEdge(
                source_id=HUB_ID,
                target_id=pop.device_twin.id,
                edge_type=EdgeType.SHARED_DEVICE,
                weight=0.0,
                tx_count=0,
                last_seen_at=now,
            )
        )
        session.add_all(edge_rows)
        await session.commit()

        report.accounts = len(pop.everyone)
        report.graph_edges = len(edge_rows)
        status_rows = await session.execute(
            select(Transaction.status, func.count()).group_by(Transaction.status)
        )
        report.by_status = {TransactionStatus(s).value: int(c) for s, c in status_rows}
        report.transactions = sum(report.by_status.values())

    report.engine_p95_ms = _p95(latencies)
    report.elapsed_s = round(time.perf_counter() - started, 2)
    return report


def _p95(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, math.ceil(0.95 * len(ordered)) - 1)], 3)


# --------------------------------------------------------------------------- output
def _table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    widths = [max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    line = "+" + "+".join("-" * (w + 2) for w in widths) + "+"

    def fmt(cells: Sequence[str]) -> str:
        return "| " + " | ".join(c.ljust(w) for c, w in zip(cells, widths, strict=True)) + " |"

    return "\n".join([line, fmt(headers), line, *(fmt(r) for r in rows), line])


def render_summary(report: SeedReport) -> str:
    stats = _table(
        ("accounts", "transactions", "approved", "cooling_off", "blocked", "graph_edges",
         "engine p95", "elapsed"),
        [(
            str(report.accounts),
            str(report.transactions),
            str(report.by_status.get("approved", 0)),
            str(report.by_status.get("cooling_off", 0)),
            str(report.by_status.get("blocked", 0)),
            str(report.graph_edges),
            f"{report.engine_p95_ms} ms",
            f"{report.elapsed_s} s",
        )],
    )  # fmt: skip
    accounts = _table(
        ("role", "account_id", "full_name", "phone"),
        [(a.role, str(a.id), a.full_name, a.phone) for a in DEMO_ACCOUNTS],
    )
    presets = _table(
        ("preset", "recipient_phone", "amount ₸", "context", "expected"),
        [
            (
                p.key,
                p.recipient_phone,
                explain.fmt_tenge(float(p.amount)),
                ",".join(k for k, v in p.context.items() if v) or "-",
                p.expected.value,
            )
            for p in DEMO_PRESETS
        ],
    )
    return (
        f"\nBCC Shield seed complete (cleared {report.redis_keys_cleared} Redis keys)\n"
        f"{stats}\n\nDemo accounts\n{accounts}\n\n"
        f"Live presets (sender {SENDER_ID}) → POST /api/v1/transfers/evaluate\n{presets}\n\n"
        f"SOC graph: GET /api/v1/soc/graph/{HUB_ID}\n"
        "Next: docker compose restart backend   (re-hydrates the resident graph)\n"
        "Hub velocity evidence is time-bound: re-seed within ~1 hour of the live demo.\n"
    )


async def _main() -> None:
    parser = argparse.ArgumentParser(description="Seed BCC Shield with deterministic KZ data.")
    parser.add_argument("--accounts", type=int, default=BACKGROUND_ACCOUNTS)
    parser.add_argument("--transactions", type=int, default=BACKGROUND_TRANSACTIONS)
    parser.add_argument("--seed", type=int, default=RNG_SEED)
    args = parser.parse_args()

    settings = get_settings()
    db_engine = build_engine(settings.database_url)
    redis = Redis.from_url(settings.redis_url)
    try:
        report = await seed(
            build_session_factory(db_engine),
            redis,
            n_background_accounts=args.accounts,
            n_background_transactions=args.transactions,
            rng_seed=args.seed,
        )
    finally:
        await redis.aclose()
        await db_engine.dispose()
    print(render_summary(report))


if __name__ == "__main__":
    asyncio.run(_main())
