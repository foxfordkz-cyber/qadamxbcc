import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class ExternalCheck(Base):
    __tablename__ = "external_checks"
    __table_args__ = (
        UniqueConstraint("owner_id", "idempotency_key", name="uq_external_check_key"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), index=True)
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("transactions.id"), index=True
    )
    idempotency_key: Mapped[uuid.UUID] = mapped_column()
    correlation_id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4)
    identifier: Mapped[str] = mapped_column(String(44))
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    cache_hit: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
