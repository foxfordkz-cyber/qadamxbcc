"""An isolated recipient of synthetic family approvals, installed only inside jury rooms."""

import asyncio
from datetime import timedelta, timezone
from html import escape
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.base import utcnow
from app.integrations.config import IntegrationSettings
from app.integrations.errors import IntegrationError
from app.integrations.models import ContactNotification, TrustedContact
from app.integrations.telegram.fake_adapter import FakeTelegramAdapter
from app.integrations.telegram.schemas import ContactState, NotificationState
from app.integrations.telegram.service import TrustedContactService
from app.integrations.telegram.worker import deliver_one
from app.mobile_gateway.jury_rooms import CONTACT_INBOX
from app.models import Transaction, TransactionStatus
from app.models.family_approval import FamilyApproval


async def install_jury_contact(
    app: FastAPI, sessions: async_sessionmaker[AsyncSession], cfg: IntegrationSettings, owner: UUID
) -> None:
    if cfg.environment != "test" or cfg.telegram_mode != "fake":
        raise ValueError("The jury inbox requires an offline test adapter")
    app.state.jury_contact_available = True
    now = utcnow()
    # Private synthetic delivery address. Each jury lease owns a separate database.
    chat = 10001
    async with sessions() as db:
        contact = TrustedContact(
            owner_id=owner,
            invitation_expires_at=now,
            language="kk",
            alias="Алия · Demo",
            state=ContactState.VERIFIED,
            contact_consented_at=now,
            telegram_chat_id=str(chat),
        )
        db.add(contact)
        await db.commit()
        contact_id = contact.id
    adapter = FakeTelegramAdapter()
    delivery = asyncio.Lock()

    def require_invitation(request: Request) -> None:
        if not getattr(request.state, "jury_contact", False):
            raise HTTPException(403, "contact_invitation_required")

    headers = {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; "
        "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    }

    @app.get(CONTACT_INBOX)
    async def inbox(request: Request, lang: str = "kk") -> HTMLResponse:
        require_invitation(request)
        ru = lang == "ru"
        locale = "ru" if ru else "kk"

        def tr(kk: str, russian: str) -> str:
            return russian if ru else kk

        async with delivery:
            # The learner can refresh the inbox even when several transfers arrive together.
            for _ in range(8):
                if not await deliver_one(sessions, adapter, cfg):
                    break
            adapter.messages.clear()
        async with sessions() as db:
            rows = (
                await db.execute(
                    select(FamilyApproval, ContactNotification, Transaction.status)
                    .join(
                        ContactNotification,
                        ContactNotification.transaction_id == FamilyApproval.transaction_id,
                    )
                    .join(Transaction, Transaction.id == FamilyApproval.transaction_id)
                    .join(TrustedContact, TrustedContact.id == FamilyApproval.contact_id)
                    .where(
                        FamilyApproval.contact_id == contact_id,
                        ContactNotification.contact_id == contact_id,
                        ContactNotification.owner_id == owner,
                        Transaction.sender_id == owner,
                        TrustedContact.state == ContactState.VERIFIED,
                        TrustedContact.contact_consented_at.is_not(None),
                        TrustedContact.notifications_enabled.is_(True),
                        ContactNotification.state.in_(
                            (
                                NotificationState.SENT,
                                NotificationState.ACKNOWLEDGED,
                                NotificationState.SUSPICION,
                            )
                        ),
                    )
                    .order_by(ContactNotification.created_at.desc())
                    .limit(30)
                )
            ).all()
        cards: list[str] = []
        for approval, notice, status in rows:
            amount = f"{approval.amount:,.2f}".replace(",", " ").removesuffix(".00")
            deadline = approval.expires_at.astimezone(timezone(timedelta(hours=5))).strftime(
                "%d.%m %H:%M"
            )
            actions = []
            if notice.state == NotificationState.SUSPICION:
                state = tr("Қауіп туралы хабарланды", "О подозрении сообщили")
            elif status != TransactionStatus.COOLING_OFF:
                state = tr("Сұрау жабылды", "Запрос закрыт")
            elif approval.expires_at <= utcnow():
                state = tr("Растау мерзімі өтті", "Срок подтверждения истёк")
            elif approval.approved_at:
                state = tr(
                    "Растадыңыз. Клиенттің шешімі күтілуде.",
                    "Вы подтвердили. Ожидается решение клиента.",
                )
                actions = ["suspect"]
            elif notice.state in (NotificationState.SENT, NotificationState.ACKNOWLEDGED):
                state = tr(
                    "Сома мен алушыны жақыныңызбен тексеріңіз.",
                    "Сверьте сумму и получателя с близким.",
                )
                actions = ["approve", "suspect"]
            else:
                state = tr("Растау қолжетімсіз", "Подтверждение недоступно")
            labels = {
                "approve": tr("Осы аударымды растаймын", "Подтверждаю этот перевод"),
                "suspect": tr("Күдік бар", "Есть подозрение"),
            }
            buttons = "".join(
                f'<form method="post" action="{CONTACT_INBOX}/{notice.id}/{action}?lang={locale}">'
                f'<button class="{action}">{labels[action]}</button></form>'
                for action in actions
            )
            cards.append(
                f"<article><strong>{amount} ₸</strong><p>{escape(approval.recipient_label)}</p>"
                f"<small>{tr('Мерзімі', 'Срок')} · {deadline} (UTC+5)</small>"
                f"<p>{state}</p>{buttons}</article>"
            )
        title = tr("Жақын адамның растауы", "Подтверждение близкого")
        info = tr(
            "Бұл — қазыларға арналған оқу бөлмесі. Ірі аударымы үшін клиент сізді таңдағанда, "
            "сұрау осында келеді. Клиент кідірістен кейін аударымды өзі аяқтайды.",
            "В этой учебной комнате клиент может выбрать вас для подтверждения крупного перевода. "
            "Здесь появится запрос. После паузы клиент отдельно подтверждает отправку.",
        )
        empty = tr("Әзірге сұрау жоқ", "Запросов пока нет")
        return HTMLResponse(
            f'''<!doctype html><html lang="{locale}"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{title} · Saq Bol</title>
<style>*{{box-sizing:border-box}}body{{background:#f4f6f8;color:#101828;
font:1rem/1.5 system-ui;margin:0}}
main{{max-width:36rem;margin:3rem auto;padding:1rem}}article{{background:white;padding:1.5rem;
border-radius:1.4rem;margin:1rem 0}}strong{{font-size:1.75rem;font-variant-numeric:tabular-nums}}
form{{display:inline-block;margin:0 .5rem .5rem 0}}button{{background:#007a42;color:white;
padding:.8rem 1rem;border:0;border-radius:.7rem;font:inherit;cursor:pointer}}
.suspect{{background:#90351a}}
a{{color:#006d3b}}nav{{display:flex;justify-content:space-between}}</style><main>
<nav><b>Saq Bol × BCC</b><span><a href="?lang=kk">ҚАЗ</a> / <a href="?lang=ru">РУС</a></span></nav>
<h1>{title}</h1><p>{info}</p>{"".join(cards) or f"<article>{empty}</article>"}
<a href="?lang={locale}">{tr("Жаңарту", "Обновить запросы")}</a></main></html>''',
            headers=headers,
        )

    @app.post(CONTACT_INBOX + "/{notice_id}/{action}")
    async def decide(notice_id: UUID, action: str, request: Request, lang: str = "kk") -> Response:
        require_invitation(request)
        if action not in {"approve", "suspect"}:
            raise HTTPException(404)
        async with sessions() as db:
            message = await db.scalar(
                select(ContactNotification.message_id)
                .join(
                    FamilyApproval,
                    FamilyApproval.transaction_id == ContactNotification.transaction_id,
                )
                .join(TrustedContact, TrustedContact.id == FamilyApproval.contact_id)
                .where(
                    ContactNotification.id == notice_id,
                    ContactNotification.owner_id == owner,
                    ContactNotification.contact_id == contact_id,
                    FamilyApproval.contact_id == contact_id,
                    TrustedContact.state == ContactState.VERIFIED,
                    TrustedContact.contact_consented_at.is_not(None),
                    TrustedContact.notifications_enabled.is_(True),
                )
            )
        if message is None:
            raise HTTPException(404, "request_not_found")
        async with sessions() as db:
            try:
                await TrustedContactService(db, cfg).callback(notice_id, chat, message, action)
            except IntegrationError as exc:
                raise HTTPException(exc.status, exc.code) from exc
        return RedirectResponse(
            CONTACT_INBOX + ("?lang=ru" if lang == "ru" else "?lang=kk"),
            status_code=303,
            headers=headers,
        )
