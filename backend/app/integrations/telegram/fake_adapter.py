import uuid

from app.integrations.telegram.adapter import DeliveryError


class FakeTelegramAdapter:
    """Offline, deterministic adapter. Never opens a network connection."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.messages: dict[uuid.UUID, tuple[int, str, str]] = {}

    async def send(self, chat_id: int, text: str, notification_id: uuid.UUID, language: str) -> str:
        if self.fail:
            raise DeliveryError("fake_unavailable")
        self.messages.setdefault(notification_id, (chat_id, text, language))
        return str(notification_id.int % 2_000_000_000)
