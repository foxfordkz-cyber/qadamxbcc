"""Link a single scored refund and its client review to the incoming payment."""

import sqlalchemy as sa
from alembic import op

revision = "0010_linked_returns"
down_revision = "0009_recipient_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payment_returns",
        sa.Column(
            "original_id",
            sa.Uuid(),
            sa.ForeignKey("transactions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "refund_transaction_id",
            sa.Uuid(),
            sa.ForeignKey("transactions.id", ondelete="RESTRICT"),
            unique=True,
        ),
        sa.Column("reported_at", sa.DateTime(timezone=True)),
        sa.Column("appealed_at", sa.DateTime(timezone=True)),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("decision", sa.String(8)),
        sa.CheckConstraint("refund_transaction_id <> original_id", name="distinct_transactions"),
        sa.CheckConstraint("decision IN ('clear', 'uphold')", name="review_decision"),
    )


def downgrade() -> None:
    op.drop_table("payment_returns")
