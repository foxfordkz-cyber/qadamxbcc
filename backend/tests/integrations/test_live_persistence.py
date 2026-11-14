import asyncio
import os
import uuid

import pytest

from tests.integrations.conftest import IntegrationWorld

pytestmark = pytest.mark.skipif(
    not os.getenv("BCC_TEST_DATABASE_URL"), reason="requires isolated PostgreSQL and Redis services"
)


async def test_concurrent_invitation_consumption(iw: IntegrationWorld) -> None:
    invite = await iw.invite()

    async def bind(chat: int) -> int:
        response = await iw.client.post(
            "/api/v1/trusted-contacts/simulator/update",
            headers=iw.auth("simulator"),
            json={"kind": "start", "chat_id": chat, "reference": invite["invitation_token"]},
        )
        return response.status_code

    assert sorted(await asyncio.gather(bind(123), bind(456))) == [200, 409]


async def test_concurrent_enqueue_is_unique(iw: IntegrationWorld) -> None:
    contact = await iw.verified()
    tx = await iw.transfer()

    async def enqueue() -> str:
        response = await iw.client.post(
            f"/api/v1/trusted-contacts/transactions/{tx['transaction_id']}/notifications",
            headers=iw.auth(),
            json={"contact_id": contact},
        )
        assert response.status_code == 200, response.text
        result: str = response.json()["id"]
        return result

    assert len(set(await asyncio.gather(*(enqueue() for _ in range(8))))) == 1
    await asyncio.gather(iw.deliver(), iw.deliver())
    assert len(iw.adapter.messages) == 1


async def test_concurrent_gateway_reservation(iw: IntegrationWorld) -> None:
    key = str(uuid.uuid4())

    async def request() -> tuple[int, str | None]:
        response = await iw.client.post(
            "/api/v1/external-checks",
            headers={**iw.auth(), "Idempotency-Key": key},
            json={"identifier": "SYN-CLEAR-001"},
        )
        assert response.status_code in {200, 409}, response.text
        return response.status_code, response.json().get("id")

    results = await asyncio.gather(*(request() for _ in range(8)))
    ids = {identifier for code, identifier in results if code == 200}
    assert len(ids) == 1
    code, identifier = await request()
    assert code == 200
    assert identifier in ids


async def test_stale_session_observes_consent_revocation(iw: IntegrationWorld) -> None:
    from app.integrations.errors import IntegrationError
    from app.integrations.models import TrustedContact
    from app.integrations.telegram.service import TrustedContactService

    contact_id = uuid.UUID(await iw.verified())
    tx = await iw.transfer()
    async with iw.factory() as session:
        contact = await session.get(TrustedContact, contact_id)
        assert contact is not None
        assert contact.state == "CONTACT_VERIFIED"
        await iw.client.delete(f"/api/v1/trusted-contacts/{contact_id}", headers=iw.auth())
        with pytest.raises(IntegrationError, match="contact_consent_required"):
            await TrustedContactService(session, iw.cfg).enqueue(
                iw.owner.id, uuid.UUID(str(tx["transaction_id"])), contact_id
            )


async def test_invitation_lock_does_not_block_core_foreign_keys(
    iw: IntegrationWorld,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from decimal import Decimal

    from sqlalchemy import text

    from app.integrations.telegram.schemas import InviteRequest
    from app.integrations.telegram.service import TrustedContactService
    from app.models import Transaction, TransactionStatus

    entered, release = asyncio.Event(), asyncio.Event()
    async with iw.factory() as inviting:
        commit = inviting.commit

        async def delayed_commit() -> None:
            entered.set()
            await release.wait()
            await commit()

        monkeypatch.setattr(inviting, "commit", delayed_commit)
        invitation = asyncio.create_task(
            TrustedContactService(inviting, iw.cfg).invite(
                iw.owner.id, InviteRequest(owner_consent=True)
            )
        )
        await entered.wait()
        try:
            async with iw.factory() as core:
                await core.execute(text("SET LOCAL lock_timeout = '150ms'"))
                core.add(
                    Transaction(
                        sender_id=iw.owner.id,
                        recipient_id=iw.recipient.id,
                        amount=Decimal("1"),
                        device_id="synthetic",
                        status=TransactionStatus.APPROVED,
                    )
                )
                await core.commit()
        finally:
            release.set()
            await invitation
