import asyncio
import os
from unittest.mock import AsyncMock

import pytest

from app.integrations.telegram.adapter import RejectedDeliveryError
from app.integrations.telegram.worker import deliver_one
from tests.integrations.conftest import IntegrationWorld
from tests.integrations.test_durable_retry import make_due


@pytest.mark.skipif(not os.getenv("BCC_TEST_DATABASE_URL"), reason="requires PostgreSQL locks")
async def test_concurrent_due_retry_sends_once(iw: IntegrationWorld) -> None:
    row = await iw.queue(await iw.verified())
    rejected = AsyncMock()
    rejected.send.side_effect = RejectedDeliveryError(120)
    await deliver_one(iw.factory, rejected, iw.cfg)
    await make_due(iw, row)
    await asyncio.gather(*(iw.deliver() for _ in range(5)))
    assert len(iw.adapter.messages) == 1
    response = await iw.client.get(
        f"/api/v1/trusted-contacts/transactions/{row['transaction_id']}/notifications",
        headers=iw.auth(),
    )
    assert response.json()[0]["attempts"] == 2
    assert response.json()[0]["next_attempt_at"] is None
