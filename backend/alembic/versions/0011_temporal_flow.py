"""Index settlement time within a sender's transfer history for on-demand SOC traces."""

import sqlalchemy as sa
from alembic import op

revision = "0011_temporal_flow"
down_revision = "0010_linked_returns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_tx_sender_status_settlement",
        "transactions",
        ["sender_id", "status", sa.text("COALESCE(resolved_at, created_at)"), "id"],
    )


def downgrade() -> None:
    op.drop_index("ix_tx_sender_status_settlement", table_name="transactions")
