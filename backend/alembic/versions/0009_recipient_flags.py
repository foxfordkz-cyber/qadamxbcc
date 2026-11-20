"""Versioned, audited SOC recipient flags."""

import sqlalchemy as sa
from alembic import op

revision = "0009_recipient_flags"
down_revision = "0008_core_integration_merge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accounts", sa.Column("flag_version", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column("accounts", sa.Column("flag_updated_at", sa.DateTime(timezone=True)))
    op.create_table(
        "recipient_flag_audit",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("accounts.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("request_id", sa.Uuid()),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("previous_flagged", sa.Boolean(), nullable=False),
        sa.Column("flagged", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("actor", sa.String(64), nullable=False),
        sa.Column("note", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("account_id", "request_id", name="uq_recipient_flag_request"),
        sa.UniqueConstraint("account_id", "version", name="uq_recipient_flag_version"),
    )
    op.create_index("ix_recipient_flag_audit_account_id", "recipient_flag_audit", ["account_id"])


def downgrade() -> None:
    op.drop_table("recipient_flag_audit")
    op.drop_column("accounts", "flag_updated_at")
    op.drop_column("accounts", "flag_version")
