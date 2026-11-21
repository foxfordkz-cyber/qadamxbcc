import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FamilyApprovalPolicy(Base):
    __tablename__ = "family_approval_policy"

    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    contact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trusted_contacts.id"))
    disable_at: Mapped[datetime | None]


class FamilyApproval(Base):
    __tablename__ = "family_approval"

    transaction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transactions.id"), primary_key=True
    )
    contact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trusted_contacts.id"))
    recipient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    recipient_label: Mapped[str] = mapped_column(String(160))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3))
    expires_at: Mapped[datetime]
    approved_at: Mapped[datetime | None]
