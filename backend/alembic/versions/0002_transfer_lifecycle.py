"""Durable evaluation audit, idempotency and cooling lifecycle.

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TYPE transaction_status ADD VALUE IF NOT EXISTS 'cancelled'")
    with op.batch_alter_table("transactions") as batch:
        batch.add_column(sa.Column("request_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("request_hash", sa.String(64), nullable=True))
        batch.add_column(
            sa.Column("evaluation_snapshot", sa.JSON(), nullable=False, server_default="{}")
        )
        batch.add_column(
            sa.Column("context_snapshot", sa.JSON(), nullable=False, server_default="{}")
        )
        batch.add_column(sa.Column("verification_answers", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("resolution_action", sa.String(16), nullable=True))
        batch.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
        batch.create_unique_constraint("uq_transactions_request_id", ["request_id"])
    op.execute("UPDATE transactions SET updated_at = COALESCE(resolved_at, created_at)")
    with op.batch_alter_table("transactions") as batch:
        batch.alter_column("updated_at", nullable=False)
        batch.alter_column("evaluation_snapshot", server_default=None)
        batch.alter_column("context_snapshot", server_default=None)
        batch.create_index("ix_transactions_updated_at", ["updated_at"])
    with op.batch_alter_table("risk_events") as batch:
        batch.add_column(sa.Column("evidence", sa.JSON(), nullable=False, server_default="{}"))
        batch.alter_column("evidence", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("risk_events") as batch:
        batch.drop_column("evidence")
    with op.batch_alter_table("transactions") as batch:
        batch.drop_index("ix_transactions_updated_at")
        batch.drop_constraint("uq_transactions_request_id", type_="unique")
        for name in (
            "updated_at",
            "resolution_action",
            "verification_answers",
            "context_snapshot",
            "evaluation_snapshot",
            "request_hash",
            "request_id",
        ):
            batch.drop_column(name)
    # PostgreSQL enum values cannot be safely removed while historical rows may use them.
