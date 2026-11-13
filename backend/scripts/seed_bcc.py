"""BCC Shield — deterministic Kazakhstan synthetic seed (T03).

Wipes and re-creates (idempotent):

* 300 accounts with checksum-valid 12-digit IINs, BCC KZ IBANs (bank code 856),
  Kazakh / Russian full names, phones, device ids and average transfer amounts;
* 3,000 transactions with risk events and aggregated graph edges. Background
  history is scored by the real ``AntifraudEngine`` (so latency, reasons and the
  Redis velocity windows are genuine); demo-ring history is staged directly;
* four one-click demo presets with fixed UUIDs (see ``DEMO_PRESETS``).

Usage (schema must exist: the backend container runs ``alembic upgrade head``)::

    docker compose exec backend python -m scripts.seed_bcc
    # or from backend/:  uv run python -m scripts.seed_bcc

Restart the backend afterwards so its resident graph is re-hydrated:
``docker compose restart backend``.
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
TOTAL_ACCOUNTS: Final = 300
TOTAL_TRANSACTIONS: Final = 3000
HISTORY_DAYS: Final = 30
ALMATY: Final = ZoneInfo("Asia/Almaty")
BATCH: Final = 500

# --------------------------------------------------------------------------- fixed ids
_NS: Final = uuid.UUID("bcc00000-0000-4000-8000-000000000000")


def _fixed(n: int) -> uuid.UUID:
    return uuid.UUID(f"bcc00000-0000-4000-8000-{n:012d}")


def _ring(name: str) -> uuid.UUID:
    return uuid.uuid5(_NS, name)


P2P_SENDER: Final = _fixed(101)
P2P_RECIPIENT: Final = _fixed(102)
SE_VICTIM: Final = _fixed(201)
SE_SCAMMER: Final = _fixed(202)
HUB_VICTIM: Final = _fixed(301)
DROP_HUB: Final = _fixed(302)
CASHOUT_OLD: Final = _fixed(303)
CASHOUT_NEW: Final = _fixed(304)
BIRTHDAY_GUEST: Final = _fixed(401)
BIRTHDAY_HOST: Final = _fixed(402)
RING_DEVICE: Final = "android-ring-7f3e9a1c"

OLD_FEEDERS: Final = [_ring(f"hub-old-feeder-{i:02d}") for i in range(6)]
NEW_FEEDERS: Final = [_ring(f"hub-feeder-{i:02d}") for i in range(12)]
GUESTS: Final = [_ring(f"birthday-guest-{i:02d}") for i in range(15)]


@dataclass(frozen=True, slots=True)
class DemoPreset:
    key: str
    title_kk: str
    title_ru: str
    sender_id: uuid.UUID
    recipient_id: uuid.UUID
    amount: Decimal
    expected: TransactionStatus
    context: dict[str, bool] = field(default_factory=dict)

    def payload(self) -> dict[str, object]:
        """Request body for ``POST /api/v1/transfers/evaluate``."""
        return {
            "sender_id": str(self.sender_id),
            "recipient_id": str(self.recipient_id),
            "amount": str(self.amount),
            "context": dict(self.context),
        }


DEMO_PRESETS: Final[tuple[DemoPreset, ...]] = (
    DemoPreset(
        "legit_p2p",
        "Қалыпты P2P аударым",
        "Обычный P2P-перевод",
        P2P_SENDER,
        P2P_RECIPIENT,
        Decimal("25000.00"),
        TransactionStatus.APPROVED,
    ),
    DemoPreset(
        "social_engineering",
        "Әлеуметтік инженерия құрбаны",
        "Жертва социальной инженерии",
        SE_VICTIM,
        SE_SCAMMER,
        Decimal("1500000.00"),
        TransactionStatus.COOLING_OFF,
        {"active_call": True, "from_deposit": True},
    ),
    DemoPreset(
        "drop_hub",
        "Дроп-хаб желісі",
        "Сеть дроп-хаба",
        HUB_VICTIM,
        DROP_HUB,
        Decimal("600000.00"),
        TransactionStatus.BLOCKED,
    ),
    DemoPreset(
        "birthday_collection",
        "Туған күнге ақша жинау",
        "Сбор на день рождения",
        BIRTHDAY_GUEST,
        BIRTHDAY_HOST,
        Decimal("10000.00"),
        TransactionStatus.APPROVED,
    ),
)

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
        self._phones: set[str] = set()
        self._devices: set[str] = set()

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

    def person(
        self,
        account_id: uuid.UUID | None = None,
        *,
        full_name: str | None = None,
        male: bool | None = None,
        device_id: str | None = None,
        avg: Decimal | None = None,
        age_days: int | None = None,
    ) -> Person:
        is_male = self.rng.random() < 0.5 if male is None else male
        days = age_days if age_days is not None else self.rng.randint(120, 2_500)
        return Person(
            id=account_id or uuid.UUID(int=self.rng.getrandbits(128), version=4),
            full_name=full_name or self.name(is_male),
            iin=self.iin(is_male),
            iban=self.iban(),
            phone=self.phone(),
            device_id=device_id or self.device(),
            avg=avg if avg is not None else self.avg_amount(),
            created_at=self.now - timedelta(days=days),
        )


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
    return moment.astimezone(UTC)


def build_population(rng: random.Random, now: datetime, n_accounts: int) -> dict[str, list[Person]]:
    f = Factory(rng, now)
    demo = [
        f.person(P2P_SENDER, full_name="Ахметова Айгерим Ерлановна", male=False,
                 avg=Decimal("35000")),
        f.person(P2P_RECIPIENT, full_name="Сулейменов Даурен Маратович", male=True,
                 avg=Decimal("30000")),
        f.person(SE_VICTIM, full_name="Касымова Гульнара Болатовна", male=False,
                 avg=Decimal("60000"), age_days=4_000),
        f.person(SE_SCAMMER, full_name="Омаров Ерасыл Талгатович", male=True,
                 avg=Decimal("20000"), age_days=2),
        f.person(HUB_VICTIM, full_name="Жумабаев Ержан Серікович", male=True,
                 avg=Decimal("50000")),
        f.person(DROP_HUB, full_name="Искаков Санжар Асхатович", male=True,
                 avg=Decimal("300000"), device_id=RING_DEVICE, age_days=40),
        f.person(CASHOUT_OLD, full_name="Байжанов Арман Жомартович", male=True,
                 avg=Decimal("250000"), device_id=RING_DEVICE, age_days=35),
        f.person(CASHOUT_NEW, full_name="Тулегенов Мадияр Нурланович", male=True,
                 avg=Decimal("250000"), device_id=RING_DEVICE, age_days=12),
        f.person(BIRTHDAY_GUEST, full_name="Смирнова Анна Сергеевна", male=False,
                 avg=Decimal("15000")),
        f.person(BIRTHDAY_HOST, full_name="Есенова Томирис Даурен қызы", male=False,
                 avg=Decimal("40000")),
    ]  # fmt: skip
    ring = [f.person(i) for i in (*OLD_FEEDERS, *NEW_FEEDERS)]
    guests = [f.person(i, avg=f.avg_amount(15_000)) for i in GUESTS]
    fixed = len(demo) + len(ring) + len(guests)
    if n_accounts < fixed + 10:
        raise ValueError(f"need at least {fixed + 10} accounts")
    background = [f.person() for _ in range(n_accounts - fixed)]
    for p in background:
        p.contacts = [c.id for c in rng.sample(background, rng.randint(3, 7)) if c.id != p.id]
    return {"demo": demo, "ring": ring, "guests": guests, "background": background}


def plan_background(
    rng: random.Random, now: datetime, pop: dict[str, list[Person]], n_transfers: int
) -> list[PlannedTransfer]:
    """Organic history for normal customers plus scripted demo-customer history."""
    bg = pop["background"]
    by_id = {p.id: p for group in pop.values() for p in group}
    demo = {p.id: p for p in pop["demo"]}
    plan: list[PlannedTransfer] = []

    def transfer(s: Person, r: Person, at: datetime, amount: float | None = None) -> None:
        new_device = rng.random() < 0.02
        value = amount if amount is not None else float(s.avg) * rng.lognormvariate(0, 0.45)
        if amount is None and rng.random() < 0.03:
            value *= rng.uniform(3, 8)
        plan.append(
            PlannedTransfer(
                sender=s,
                recipient=r,
                amount=_money(value),
                at=at,
                device_id=f"android-{rng.getrandbits(48):012x}" if new_device else s.device_id,
                active_call=rng.random() < 0.02,
                from_deposit=rng.random() < 0.03,
                is_new_device=new_device,
            )
        )

    # Preset 1: Aigerim has paid Dauren before → known recipient.
    for days, amount in ((26, 28_000), (19, 31_500), (11, 27_000), (4, 33_000)):
        transfer(demo[P2P_SENDER], demo[P2P_RECIPIENT], _local_moment(rng, now, days), amount)
    # Demo senders also look like ordinary customers.
    for sid in (P2P_SENDER, SE_VICTIM, HUB_VICTIM, BIRTHDAY_GUEST):
        for c in rng.sample(bg, 4):
            for _ in range(rng.randint(1, 3)):
                transfer(demo[sid], c, _local_moment(rng, now, rng.randint(1, HISTORY_DAYS)))

    while len(plan) < n_transfers:
        s = rng.choice(bg)
        r = by_id[rng.choice(s.contacts)] if rng.random() > 0.12 else rng.choice(bg)
        if r.id == s.id:
            continue
        transfer(s, r, _local_moment(rng, now, rng.randint(1, HISTORY_DAYS)))

    plan.sort(key=lambda t: t.at)
    return plan[:n_transfers]


def plan_staged(
    rng: random.Random, now: datetime, pop: dict[str, list[Person]]
) -> list[PlannedTransfer]:
    """Drop-ring and birthday flows that pre-date the demo (inserted as settled history)."""
    by_id = {p.id: p for group in pop.values() for p in group}
    staged: list[PlannedTransfer] = []

    def add(s: uuid.UUID, r: uuid.UUID, amount: int, at: datetime) -> None:
        staged.append(PlannedTransfer(by_id[s], by_id[r], Decimal(amount), at, by_id[s].device_id))

    # 3 days ago: 6 victims pay the hub, 4 h later 95 % leaves to the first cash-out mule.
    t0 = (now - timedelta(days=3)).replace(hour=5, minute=0, second=0, microsecond=0)
    for i, fid in enumerate(OLD_FEEDERS):
        add(fid, DROP_HUB, 100_000, t0 + timedelta(minutes=20 * i))
    add(DROP_HUB, CASHOUT_OLD, 570_000, t0 + timedelta(hours=4))

    # Last 30 min: 12 distinct senders → hub, then two rapid cash-out chunks (65 %).
    inflow = 0
    for i, fid in enumerate(NEW_FEEDERS):
        amount = rng.randrange(85_000, 115_001, 500)
        inflow += amount
        add(fid, DROP_HUB, amount, now - timedelta(minutes=29) + timedelta(minutes=2 * i))
    add(DROP_HUB, CASHOUT_NEW, inflow * 40 // 100, now - timedelta(minutes=5))
    add(DROP_HUB, CASHOUT_NEW, inflow * 25 // 100, now - timedelta(minutes=4))

    # Last 30 min: 15 friends chip in for a birthday; nothing is forwarded.
    for i, gid in enumerate(GUESTS):
        amount = rng.choice((5_000, 7_000, 10_000, 10_000, 15_000, 20_000))
        add(gid, BIRTHDAY_HOST, amount, now - timedelta(minutes=29) + timedelta(seconds=110 * i))
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


async def seed(
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    *,
    n_accounts: int = TOTAL_ACCOUNTS,
    n_transactions: int = TOTAL_TRANSACTIONS,
    rng_seed: int = RNG_SEED,
    now: datetime | None = None,
) -> SeedReport:
    started = time.perf_counter()
    rng = random.Random(rng_seed)
    now = (now or datetime.now(UTC)).astimezone(UTC).replace(microsecond=0)
    settings = get_settings()
    report = SeedReport()

    await redis.ping()  # connect before scoring so no history row carries connect latency
    population = build_population(rng, now, n_accounts)
    staged = plan_staged(rng, now, population)
    background = plan_background(rng, now, population, n_transactions - len(staged))
    people = [p for group in population.values() for p in group]

    engine = AntifraudEngine(
        redis,
        GraphStore(),
        timezone=settings.timezone,
        cooling_off_minutes=settings.cooling_off_minutes,
    )
    for p in people:
        engine.graph.add_account(str(p.id), label=p.full_name, device_id=p.device_id)
    edges = EdgeBook()
    latencies: list[float] = []

    async with session_factory() as session:
        report.redis_keys_cleared = await _clear(session, redis)
        session.add_all(p.to_account() for p in people)
        await session.commit()

        pending: list[Transaction] = []
        for t in background:
            ctx = TransferContext(
                tx_id=str(uuid.UUID(int=rng.getrandbits(128), version=4)),
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

        for t in staged:
            tx_id = uuid.UUID(int=rng.getrandbits(128), version=4)
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
        session.add_all(edge_rows)
        await session.commit()

        report.accounts = len(people)
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
    presets = _table(
        ("#", "preset", "sender_id", "recipient_id", "amount ₸", "context", "expected"),
        [
            (
                str(i),
                p.key,
                str(p.sender_id),
                str(p.recipient_id),
                explain.fmt_tenge(float(p.amount)),
                ",".join(k for k, v in p.context.items() if v) or "-",
                p.expected.value,
            )
            for i, p in enumerate(DEMO_PRESETS, start=1)
        ],
    )
    return (
        f"\nBCC Shield seed complete (cleared {report.redis_keys_cleared} Redis keys)\n"
        f"{stats}\n\nDemo presets → POST /api/v1/transfers/evaluate\n{presets}\n\n"
        "SOC graph: GET /api/v1/soc/graph/" + str(DROP_HUB) + "\n"
        "Next: docker compose restart backend   (re-hydrates the resident graph)\n"
        "Velocity windows are 'live' for ~30 min; graph evidence keeps presets stable after.\n"
    )


async def _main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument("--accounts", type=int, default=TOTAL_ACCOUNTS)
    parser.add_argument("--transactions", type=int, default=TOTAL_TRANSACTIONS)
    parser.add_argument("--seed", type=int, default=RNG_SEED)
    args = parser.parse_args()

    settings = get_settings()
    db_engine = build_engine(settings.database_url)
    redis = Redis.from_url(settings.redis_url)
    try:
        report = await seed(
            build_session_factory(db_engine),
            redis,
            n_accounts=args.accounts,
            n_transactions=args.transactions,
            rng_seed=args.seed,
        )
    finally:
        await redis.aclose()
        await db_engine.dispose()
    print(render_summary(report))


if __name__ == "__main__":
    asyncio.run(_main())
