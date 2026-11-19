import uuid
from typing import Protocol

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError, TelegramRetryAfter
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from app.integrations.telegram.templates import BUTTONS


class DeliveryError(Exception):
    """Sanitized delivery failure; ambiguous failures must not be automatically retried."""


class RejectedDeliveryError(DeliveryError):
    """Explicit flood-control rejection: Telegram did not accept the send request."""

    def __init__(self, retry_after: int) -> None:
        super().__init__("telegram_rate_limited")
        self.retry_after = retry_after


class TelegramAdapter(Protocol):
    async def send(
        self, chat_id: int, text: str, notification_id: uuid.UUID, language: str
    ) -> str: ...


class AiogramTelegramAdapter:
    def __init__(self, bot: Bot, allowed_chat_ids: list[int]) -> None:
        self.bot = bot
        self.allowed = frozenset(allowed_chat_ids)

    async def send(self, chat_id: int, text: str, notification_id: uuid.UUID, language: str) -> str:
        if chat_id not in self.allowed:
            raise DeliveryError("recipient_not_allowlisted")
        ack, suspect = BUTTONS[language]
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(text=ack, callback_data=f"ack:{notification_id}"),
                    InlineKeyboardButton(text=suspect, callback_data=f"suspect:{notification_id}"),
                ]
            ]
        )
        try:
            message = await self.bot.send_message(chat_id, text, reply_markup=keyboard)
            return str(message.message_id)
        except TelegramRetryAfter as exc:
            raise RejectedDeliveryError(exc.retry_after) from None
        except TelegramAPIError as exc:
            raise DeliveryError("telegram_api_error") from exc
