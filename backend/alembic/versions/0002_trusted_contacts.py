"""Consent, persistent delivery queue and minimal integration audit."""
from alembic import op
import sqlalchemy as sa

revision = "0002_trusted_contacts"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("integration_audit",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.Column("correlation_id", sa.Uuid(), nullable=False),
        sa.Column("event", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    for name in ("owner_id", "resource_id", "correlation_id"):
        op.create_index(f"ix_integration_audit_{name}", "integration_audit", [name])
    op.create_table("trusted_contacts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("invitation_hash", sa.String(64), unique=True),
        sa.Column("invitation_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("language", sa.String(2), nullable=False),
        sa.Column("state", sa.String(40), nullable=False),
        sa.Column("owner_consented_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("contact_consented_at", sa.DateTime(timezone=True)),
        sa.Column("telegram_chat_id", sa.String(24)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_trusted_contacts_owner_id", "trusted_contacts", ["owner_id"])
    op.create_table("contact_notifications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("contact_id", sa.Uuid(), sa.ForeignKey("trusted_contacts.id"), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), sa.ForeignKey("transactions.id"), nullable=False),
        sa.Column("correlation_id", sa.Uuid(), nullable=False),
        sa.Column("state", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("message_id", sa.String(32)),
        sa.Column("error_code", sa.String(40)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("contact_id", "transaction_id", name="uq_contact_transaction"))
    for name in ("owner_id", "transaction_id"):
        op.create_index(f"ix_contact_notifications_{name}", "contact_notifications", [name])


def downgrade() -> None:
    op.drop_table("contact_notifications")
    op.drop_table("trusted_contacts")
    op.drop_table("integration_audit")
