"""Opt-in family approval and immutable terms for each held transfer."""

import sqlalchemy as sa
from alembic import op

revision = "0014_family_approval"
down_revision = "0013_staff_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "family_approval_policy",
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("accounts.id"), primary_key=True),
        sa.Column("contact_id", sa.Uuid(), sa.ForeignKey("trusted_contacts.id"), nullable=False),
        sa.Column("disable_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "family_approval",
        sa.Column("transaction_id", sa.Uuid(), sa.ForeignKey("transactions.id"), primary_key=True),
        sa.Column("contact_id", sa.Uuid(), sa.ForeignKey("trusted_contacts.id"), nullable=False),
        sa.Column("recipient_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("recipient_label", sa.String(160), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("family_approval")
    op.drop_table("family_approval_policy")
