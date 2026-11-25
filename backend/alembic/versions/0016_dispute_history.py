"""Backfill the fast-path marker for customers with an incoming-payment dispute."""

import sqlalchemy as sa
from alembic import op

revision = "0016_dispute_history"
down_revision = "0015_transfer_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("has_dispute_history", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute(
        "UPDATE accounts SET has_dispute_history = true WHERE id IN "
        "(SELECT t.recipient_id FROM payment_returns r JOIN transactions t ON t.id = r.original_id "
        "WHERE r.reported_at IS NOT NULL)"
    )


def downgrade() -> None:
    op.drop_column("accounts", "has_dispute_history")
