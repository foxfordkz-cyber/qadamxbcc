import asyncio
import os
import subprocess
import sys
import uuid
from datetime import timedelta
from pathlib import Path

import pytest

from app.db.base import utcnow
from app.integrations.models import ContactNotification
from app.integrations.telegram.adapter import RejectedDeliveryError
from app.integrations.telegram.fake_adapter import FakeTelegramAdapter
from app.integrations.telegram.polling_lock import PollingLock
from app.integrations.telegram.worker import deliver_one
from tests.integrations.conftest import IntegrationWorld
from tests.integrations.test_durable_retry import make_due

ROOT = "/api/v1/integrations"


class RejectingFake(FakeTelegramAdapter):
    async def send(self, chat_id: int, text: str, notification_id: uuid.UUID, language: str) -> str:
        raise RejectedDeliveryError(120)


async def test_operations_dead_letter_inspection_never_resends(iw: IntegrationWorld) -> None:
    queued = await iw.queue(await iw.verified())
    for attempt in range(3):
        assert await deliver_one(iw.factory, RejectingFake(), iw.cfg)
        if attempt < 2:
            await make_due(iw, queued)
    path = ROOT + "/soc/operations/notifications"
    response = await iw.client.get(path + "?failed_only=true", headers=iw.auth("soc"))
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    job = response.json()["items"][0]
    assert job["disposition"] == "retry_exhausted"
    assert job["attempts"] == 3
    assert not job["retry_scheduled"]
    assert not job["manual_resend_supported"]
    assert "chat_id" not in response.text
    assert "message_id" not in response.text
    assert (
        await iw.client.post(path + "/" + job["id"] + "/retry", headers=iw.auth("soc"))
    ).status_code == 404
    assert (await iw.client.get(path, headers=iw.auth())).status_code == 403
    assert not await iw.deliver()
    assert not iw.adapter.messages
    summary = (await iw.client.get(ROOT + "/soc/operations/queue", headers=iw.auth("soc"))).json()
    assert summary["retry_exhausted"] == 1
    assert summary["by_state"]["DELIVERY_FAILED"] == 1


async def test_operations_delayed_and_abandoned_claim(iw: IntegrationWorld) -> None:
    queued = await iw.queue(await iw.verified())
    await deliver_one(iw.factory, RejectingFake(), iw.cfg)
    path = ROOT + "/soc/operations/notifications"
    job = (await iw.client.get(path, headers=iw.auth("soc"))).json()["items"][0]
    assert job["disposition"] == "delayed"
    assert job["retry_scheduled"]
    assert not await iw.deliver()
    async with iw.factory() as session:
        row = await session.get(ContactNotification, uuid.UUID(str(queued["id"])))
        assert row
        row.claimed_at = utcnow() - timedelta(seconds=31)
        row.next_attempt_at = None
        row.error_code = None
        await session.commit()
    job = (await iw.client.get(path, headers=iw.auth("soc"))).json()["items"][0]
    assert job["disposition"] == "ambiguous"
    assert job["processing_age_seconds"] >= 31
    assert not job["retry_scheduled"]
    assert not await iw.deliver()
    summary = (await iw.client.get(ROOT + "/soc/operations/queue", headers=iw.auth("soc"))).json()
    assert summary["ambiguous_delivery"] == 1
    assert not iw.adapter.messages


async def test_privacy_export_history_ownership_and_erasure(iw: IntegrationWorld) -> None:
    cid = await iw.verified()
    contact_path = "/api/v1/trusted-contacts/" + cid
    await iw.client.patch(
        contact_path + "/preferences",
        headers=iw.auth(),
        json={
            "alias": "Private synthetic alias",
            "language": "kk",
            "notifications_enabled": False,
        },
    )
    path = ROOT + "/privacy/permissions"
    response = await iw.client.get(path, headers=iw.auth())
    assert "Private synthetic alias" not in response.text
    assert "telegram_chat_id" not in response.text
    assert "invitation" not in response.text
    permission = response.json()["permissions"][0]
    assert permission["last_contact_consent_at"]
    assert permission["consent_currently_valid"]
    assert not permission["notifications_enabled"]
    assert (await iw.client.get(path, headers=iw.auth("soc"))).status_code == 403
    assert (await iw.client.get(path, headers=iw.auth(subject=iw.recipient.id))).json()[
        "permissions"
    ] == []
    history_path = ROOT + f"/privacy/contacts/{cid}/history"
    assert (
        await iw.client.get(history_path, headers=iw.auth(subject=iw.recipient.id))
    ).status_code == 404
    await iw.client.delete(contact_path, headers=iw.auth())
    after = (await iw.client.get(path, headers=iw.auth())).json()["permissions"][0]
    assert not after["consent_currently_valid"]
    assert after["delivery_identifiers_erased"]
    events: list[str] = []
    cursor = None
    while True:
        params = {"limit": "2"}
        if cursor:
            params["after_id"] = cursor
        page = (await iw.client.get(history_path, headers=iw.auth(), params=params)).json()
        events.extend(e["event"] for e in page["events"])
        cursor = page["next_after_id"]
        if cursor is None:
            break
    assert len(events) == len(set(events)) == 5
    assert "CONTACT_REVOKED" in events


async def test_privacy_permission_pages_keep_owner_scope(iw: IntegrationWorld) -> None:
    expected = {await iw.verified() for _ in range(3)}
    seen: set[str] = set()
    cursor = None
    while True:
        params = {"limit": "1"}
        if cursor:
            params["after_id"] = cursor
        page = (
            await iw.client.get(ROOT + "/privacy/permissions", params=params, headers=iw.auth())
        ).json()
        seen.update(row["contact_id"] for row in page["permissions"])
        cursor = page["next_after_id"]
        if cursor is None:
            break
    assert seen == expected


def test_polling_lock_prevents_duplicate_and_releases(tmp_path: Path) -> None:
    first, second = PollingLock(123, tmp_path), PollingLock(123, tmp_path)
    first.acquire()
    try:
        with pytest.raises(RuntimeError, match="polling already running"):
            second.acquire()
        other = PollingLock(456, tmp_path)
        other.acquire()
        other.close()
    finally:
        first.close()
    second.acquire()
    second.close()
    assert first.path.read_bytes() == b"0"


def test_polling_lock_recovers_after_process_crash(tmp_path: Path) -> None:
    code = (
        "import sys; from pathlib import Path; "
        "from app.integrations.telegram.polling_lock import PollingLock; "
        "lock=PollingLock(789,Path(sys.argv[1])); lock.acquire(); "
        "print('ready',flush=True); sys.stdin.read(1)"
    )
    try:
        child = subprocess.Popen(
            [sys.executable, "-c", code, str(tmp_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except PermissionError as exc:
        if sys.platform == "win32" and exc.winerror == 5:
            pytest.skip("Windows denied child launch before lock code; Linux CI must run this test")
        raise
    try:
        assert child.stdout
        assert child.stdout.readline().strip() == "ready"
        contender = PollingLock(789, tmp_path)
        with pytest.raises(RuntimeError, match="polling already running"):
            contender.acquire()
    finally:
        child.terminate()
        child.communicate(timeout=10)
    contender.acquire()
    contender.close()


@pytest.mark.skipif(not os.getenv("BCC_TEST_DATABASE_URL"), reason="requires PostgreSQL row locks")
async def test_inflight_delivery_serializes_revoke_and_multiple_workers(
    iw: IntegrationWorld,
) -> None:
    cid = await iw.verified()
    await iw.queue(cid)
    started, release = asyncio.Event(), asyncio.Event()
    calls = 0

    class ControlledFake(FakeTelegramAdapter):
        async def send(
            self, chat_id: int, text: str, notification_id: uuid.UUID, language: str
        ) -> str:
            nonlocal calls
            calls += 1
            started.set()
            await release.wait()
            return await super().send(chat_id, text, notification_id, language)

    adapter = ControlledFake()
    delivery = asyncio.create_task(deliver_one(iw.factory, adapter, iw.cfg))
    await asyncio.wait_for(started.wait(), timeout=15)
    revoke = asyncio.create_task(
        iw.client.delete("/api/v1/trusted-contacts/" + cid, headers=iw.auth())
    )
    competitors = asyncio.gather(*(deliver_one(iw.factory, adapter, iw.cfg) for _ in range(3)))
    await asyncio.sleep(0.02)
    assert not revoke.done()  # Revoke cannot commit across the held delivery/consent lock.
    release.set()
    await delivery
    assert (await revoke).status_code == 200
    await competitors
    assert calls == 1
    assert not await deliver_one(iw.factory, adapter, iw.cfg)
    assert calls == 1
