import uuid

from app.integrations.errors import IntegrationError
from app.integrations.telegram.schemas import SimulatedUpdate, UpdateOut
from app.integrations.telegram.service import TrustedContactService


async def process_update(service: TrustedContactService, update: SimulatedUpdate) -> UpdateOut:
    if update.kind == "start":
        contact = await service.bind(update.reference, update.chat_id)
        return UpdateOut(resource_id=contact.id, state=contact.state)
    try:
        resource_id = uuid.UUID(update.reference)
    except ValueError as exc:
        raise IntegrationError(422, "invalid_callback_reference") from exc
    if update.kind == "consent":
        contact = await service.consent(resource_id, update.chat_id)
        return UpdateOut(resource_id=contact.id, state=contact.state)
    if update.kind == "revoke":
        contact = await service.revoke(resource_id, chat_id=update.chat_id)
        return UpdateOut(resource_id=contact.id, state=contact.state)
    notification = await service.callback(
        resource_id, update.chat_id, update.message_id, update.kind
    )
    return UpdateOut(resource_id=notification.id, state=notification.state)
