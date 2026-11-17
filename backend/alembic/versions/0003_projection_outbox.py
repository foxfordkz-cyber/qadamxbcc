"""Durable approved-transfer projections and abandoned client request tombstones.

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "abandoned_requests",
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("request_id", name=op.f("pk_abandoned_requests")),
    )
    op.create_table(
        "projection_outbox",
        sa.Column("transaction_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("transaction_id", name=op.f("pk_projection_outbox")),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["transactions.id"],
            name=op.f("fk_projection_outbox_transaction_id_transactions"),
            ondelete="CASCADE",
        ),
    )


def downgrade() -> None:
    op.drop_table("projection_outbox")
    op.drop_table("abandoned_requests")
