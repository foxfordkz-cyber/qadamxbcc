import uuid

import pytest
from fastapi import HTTPException

from app.integrations.security import Principal, issue_token, verify_token
from tests.integrations.conftest import TEST_KEY, IntegrationWorld

ROOT = "/api/v1/trusted-contacts"


@pytest.mark.parametrize("token", ["", "owner:bad:9999999999:sig", "Bearer user", "a:b:c:d:e"])
def test_malformed_capabilities(token: str) -> None:
    with pytest.raises(HTTPException):
        verify_token(token, TEST_KEY)


def test_signature_binds_role_and_owner() -> None:
    owner = Principal(role="owner", subject=uuid.uuid4())
    token = issue_token(owner, TEST_KEY)
    assert verify_token(token, TEST_KEY) == owner
    for forged in (
        token.replace("owner:", "soc:"),
        token.replace(str(owner.subject), str(uuid.uuid4())),
    ):
        with pytest.raises(HTTPException):
            verify_token(forged, TEST_KEY)


async def test_missing_auth_and_fake_identity(iw: IntegrationWorld) -> None:
    response = await iw.client.get(ROOT, headers={"X-Account-ID": str(iw.owner.id)})
    assert response.status_code == 401
    response = await iw.client.post(
        ROOT, headers=iw.auth(), json={"owner_consent": True, "telegram_chat_id": 123}
    )
    assert response.status_code == 422


async def test_owner_cannot_impersonate_telegram_sender(iw: IntegrationWorld) -> None:
    invitation = await iw.invite()
    response = await iw.client.post(
        ROOT + "/simulator/update",
        headers=iw.auth(),
        json={"kind": "start", "chat_id": 123, "reference": invitation["invitation_token"]},
    )
    assert response.status_code == 403


async def test_cross_owner_access(iw: IntegrationWorld) -> None:
    contact = await iw.verified()
    tx = await iw.transfer()
    auth = iw.auth(subject=iw.recipient.id)
    response = await iw.client.delete(f"{ROOT}/{contact}", headers=auth)
    assert response.status_code == 404
    response = await iw.client.post(
        f"{ROOT}/transactions/{tx['transaction_id']}/notifications",
        headers=auth,
        json={"contact_id": contact},
    )
    assert response.status_code == 404


async def test_rate_limit(iw: IntegrationWorld) -> None:
    iw.cfg.rate_limit_per_minute = 1
    assert (await iw.client.get(ROOT, headers=iw.auth())).status_code == 200
    assert (await iw.client.get(ROOT, headers=iw.auth())).status_code == 429


async def test_disabled_integrations_leave_core_alive(iw: IntegrationWorld) -> None:
    iw.cfg.enabled = False
    assert (await iw.client.get(ROOT, headers=iw.auth())).status_code == 503
    assert (await iw.client.get("/health")).status_code == 200
    assert (await iw.transfer(cooling=False))["status"] == "approved"


async def test_wrong_contact_cannot_consent(iw: IntegrationWorld) -> None:
    invitation = await iw.invite()
    response = await iw.client.post(
        ROOT + "/simulator/update",
        headers=iw.auth("simulator"),
        json={"kind": "start", "chat_id": 123, "reference": invitation["invitation_token"]},
    )
    reference = response.json()["resource_id"]
    response = await iw.client.post(
        ROOT + "/simulator/update",
        headers=iw.auth("simulator"),
        json={"kind": "consent", "chat_id": 456, "reference": reference},
    )
    assert response.status_code == 404
