"""Bounded read-only recipient pages from saved records, never an owner/SOC capability."""

import uuid

from aiogram.types import InlineKeyboardMarkup
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.base import utcnow
from app.integrations.models import ContactNotification, GuardianReport, TrustedContact
from app.integrations.telegram.assistant_ui import COPY, buttons
from app.integrations.telegram.templates import STATE_LABELS

PAGE_SIZE = 5
MAX_PAGES = 20
Screen = tuple[str, InlineKeyboardMarkup]


def page_number(value: str) -> int:
    if not value.isascii() or not value.isdecimal() or len(value) > 2:
        raise ValueError("invalid recipient page")
    page = int(value)
    if not 0 <= page < MAX_PAGES:
        raise ValueError("invalid recipient page")
    return page


async def dashboard(factory: async_sessionmaker[AsyncSession], chat_id: int, lang: str) -> str:
    t = COPY[lang]
    contacts = select(TrustedContact.id).where(
        TrustedContact.telegram_chat_id == str(chat_id),
        TrustedContact.state == "CONTACT_VERIFIED",
        TrustedContact.contact_consented_at.is_not(None),
    )
    async with factory() as session:
        active = await session.scalar(select(func.count()).select_from(contacts.subquery()))
        enabled = await session.scalar(
            select(func.count()).select_from(
                contacts.where(TrustedContact.notifications_enabled.is_(True)).subquery()
            )
        )
        waiting = await session.scalar(
            select(func.count())
            .select_from(ContactNotification)
            .where(
                ContactNotification.contact_id.in_(contacts),
                ContactNotification.state == "NOTIFICATION_SENT",
                ContactNotification.expires_at > utcnow(),
            )
        )
        suspected = await session.scalar(
            select(func.count())
            .select_from(ContactNotification)
            .where(
                ContactNotification.contact_id.in_(contacts),
                ContactNotification.state == "SUSPICION_REPORTED",
            )
        )
        reports = await session.scalar(
            select(func.count())
            .select_from(GuardianReport)
            .where(GuardianReport.contact_id.in_(contacts), GuardianReport.expires_at > utcnow())
        )
    return (
        t["dashboard"]
        + "\n\n"
        + "\n".join(
            f"{t[key]}: {value or 0}"
            for key, value in (
                ("active", active),
                ("enabled", enabled),
                ("waiting", waiting),
                ("suspected", suspected),
                ("reports_open", reports),
            )
        )
        + ("\n\n" + t["empty"] if not active else "")
    )


async def notification_page(
    factory: async_sessionmaker[AsyncSession], chat_id: int, lang: str, page: int = 0
) -> Screen:
    page_number(str(page))
    t = COPY[lang]
    async with factory() as session:
        rows = list(
            await session.scalars(
                select(ContactNotification)
                .join(TrustedContact, TrustedContact.id == ContactNotification.contact_id)
                .where(
                    TrustedContact.telegram_chat_id == str(chat_id),
                    TrustedContact.state == "CONTACT_VERIFIED",
                    TrustedContact.contact_consented_at.is_not(None),
                )
                .order_by(ContactNotification.created_at.desc(), ContactNotification.id.desc())
                .offset(page * PAGE_SIZE)
                .limit(PAGE_SIZE + 1)
            )
        )
    text = t["notifications"] + f" · {t['page']} {page + 1}\n\n" + t["scope"]
    actions: list[tuple[str, str]] = []
    for row in rows[:PAGE_SIZE]:
        label = STATE_LABELS.get(row.state, ("Состояние недоступно", "Күй қолжетімсіз"))[
            lang == "kk"
        ]
        text += f"\n\n{row.created_at:%Y-%m-%d %H:%M} UTC · {label}"
        actions.append(
            (f"{row.created_at:%d.%m %H:%M} · {str(row.id)[:8]}", "g:notification:" + str(row.id))
        )
    if not rows:
        text += "\n\n" + t["empty"]
    if page:
        actions.append((t["previous"], f"g:notifications:{page - 1}"))
    if len(rows) > PAGE_SIZE and page + 1 < MAX_PAGES:
        actions.append((t["next"], f"g:notifications:{page + 1}"))
    if page == MAX_PAGES - 1:
        text += "\n\n" + t["limit"]
    actions += [
        (t["refresh"], f"g:notifications:{page}"),
        (t["reports"], "r:list"),
        (t["back"], "g:home"),
    ]
    return text, buttons(actions)


async def notification_detail(
    factory: async_sessionmaker[AsyncSession], chat_id: int, lang: str, reference: str
) -> Screen:
    t = COPY[lang]
    navigation = buttons([(t["notifications"], "g:alerts"), (t["back"], "g:home")])
    try:
        notification_id = uuid.UUID(reference)
    except ValueError:
        return t["unavailable"], navigation
    async with factory() as session:
        row = await session.scalar(
            select(ContactNotification)
            .join(TrustedContact, TrustedContact.id == ContactNotification.contact_id)
            .where(
                ContactNotification.id == notification_id,
                TrustedContact.telegram_chat_id == str(chat_id),
                TrustedContact.state == "CONTACT_VERIFIED",
                TrustedContact.contact_consented_at.is_not(None),
            )
        )
    if row is None:
        return t["unavailable"], navigation
    label = STATE_LABELS.get(row.state, ("Состояние недоступно", "Күй қолжетімсіз"))[lang == "kk"]
    return (
        f"{t['notifications']} · {str(row.id)[:8]}\n\n{label}\n"
        f"{t['created']}: {row.created_at:%Y-%m-%d %H:%M} UTC\n"
        f"{t['expires']}: {row.expires_at:%Y-%m-%d %H:%M} UTC\n\n{t['original']}",
        navigation,
    )


async def report_page(session: AsyncSession, chat_id: int, lang: str, page: int = 0) -> Screen:
    page_number(str(page))
    t = COPY[lang]
    rows = list(
        await session.scalars(
            select(GuardianReport)
            .join(TrustedContact, TrustedContact.id == GuardianReport.contact_id)
            .where(
                TrustedContact.telegram_chat_id == str(chat_id),
                TrustedContact.state == "CONTACT_VERIFIED",
                TrustedContact.contact_consented_at.is_not(None),
                GuardianReport.expires_at > utcnow(),
            )
            .order_by(GuardianReport.created_at.desc(), GuardianReport.id.desc())
            .offset(page * PAGE_SIZE)
            .limit(PAGE_SIZE + 1)
        )
    )
    actions = [
        (f"{row.created_at:%d.%m %H:%M} · {str(row.id)[:8]}", "r:status:" + str(row.id))
        for row in rows[:PAGE_SIZE]
    ]
    text = t["reports"] + f" · {t['page']} {page + 1}"
    if not rows:
        text += "\n\n" + t["empty"]
    if page:
        actions.append((t["previous"], f"r:list:{page - 1}"))
    if len(rows) > PAGE_SIZE and page + 1 < MAX_PAGES:
        actions.append((t["next"], f"r:list:{page + 1}"))
    if page == MAX_PAGES - 1:
        text += "\n\n" + t["limit"]
    actions += [(t["refresh"], f"r:list:{page}"), (t["back"], "g:home")]
    return text, buttons(actions)
