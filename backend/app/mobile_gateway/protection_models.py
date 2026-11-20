"""Durable customer safety preferences and advisory post-call answers."""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FamilyShield(Base):
    __tablename__ = "mobile_family_shield"
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    disable_at: Mapped[datetime | None] = mapped_column()


class PostCall(Base):
    __tablename__ = "mobile_post_call"
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transactions.id"), primary_key=True
    )
    ended_at: Mapped[datetime] = mapped_column()
    answered_at: Mapped[datetime | None] = mapped_column()
    answer: Mapped[str | None] = mapped_column(String(16))
