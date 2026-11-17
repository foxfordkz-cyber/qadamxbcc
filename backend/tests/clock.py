"""Explicit integration-scenario clocks; no automatic fixture or scoring overrides."""

import sys
from datetime import datetime, tzinfo

import pytest

from app.services import projections, soc, transfers


def pin_server_clock(monkeypatch: pytest.MonkeyPatch, instant: datetime) -> None:
    """Keep attempts, settlements, recovery windows and hold expiry on one clock."""

    class ScenarioClock:
        @staticmethod
        def now(tz: tzinfo | None = None) -> datetime:
            # Real datetime values preserve SQL's normal binding/adaptation behavior.
            return datetime.fromtimestamp(instant.timestamp(), tz)

    for module in (transfers, projections, soc, sys.modules["tests.test_api"]):
        monkeypatch.setattr(module, "datetime", ScenarioClock)
