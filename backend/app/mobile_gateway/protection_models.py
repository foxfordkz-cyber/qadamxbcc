"""Durable customer safety preferences and advisory post-call answers."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, LargeBinary, String
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


class TransferKey(Base):
    __tablename__ = "mobile_transfer_key"
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    credential_id: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    public_key: Mapped[bytes] = mapped_column(LargeBinary)
    sign_count: Mapped[int] = mapped_column(BigInteger)


class SignedIntent(Base):
    __tablename__ = "mobile_signed_intent"
    request_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    recipient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    amount_tiyn: Mapped[int] = mapped_column(BigInteger)
    fingerprint: Mapped[str] = mapped_column(String(64))
    session_hash: Mapped[str] = mapped_column(String(64))
    verified_at: Mapped[datetime]
