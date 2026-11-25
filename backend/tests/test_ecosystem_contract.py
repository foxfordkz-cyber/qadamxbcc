from typing import Any

from httpx import AsyncClient

from scripts.export_ecosystem_contract import OUTPUT, render
from tests.test_mobile_gateway import ADMIN_CODE, PLATFORM_CODE, login
from tests.test_mobile_gateway import mobile_world as mobile_world


def test_openapi_contract_matches_committed_client_boundary() -> None:
    assert OUTPUT.read_text(encoding="utf-8") == render()


async def test_discovery_is_nonsecret_and_account_roles_remain_server_enforced(
    mobile_world: tuple[AsyncClient, Any],
) -> None:
    client, _ = mobile_world
    discovery = await client.get("/mobile/v1/compatibility")
    assert discovery.status_code == 200
    assert set(discovery.json()) == {
        "api_major",
        "minimum_android_build",
        "transaction_statuses",
        "update_url",
    }
    assert discovery.json()["api_major"] == 1
    assert discovery.json()["minimum_android_build"] == 0
    assert "cooling_off" in discovery.json()["transaction_statuses"]
    owner, officer, platform = (
        await login(client),
        await login(client, ADMIN_CODE),
        await login(client, PLATFORM_CODE),
    )
    account = await client.get("/mobile/v1/account", headers=owner)
    assert account.status_code == 200
    assert isinstance(account.json()["balance"], str)
    assert account.json()["currency"] == "KZT"
    assert account.json()["supports_call_question"] is True  # additive fields preserved
    for role in (officer, platform):
        assert (await client.get("/mobile/v1/account", headers=role)).status_code == 403
    assert (await client.get("/mobile/v1/api/soc/feed", headers=owner)).status_code == 403
    assert (await client.get("/mobile/v1/api/soc/feed", headers=platform)).status_code == 403
    assert (await client.get("/mobile/v1/admin/staff", headers=officer)).status_code == 403
