import asyncio
import os

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
