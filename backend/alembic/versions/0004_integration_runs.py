"""Durable off-path orchestration jobs."""
from alembic import op
import sqlalchemy as sa

revision = "0004_integration_runs"
down_revision = "0003_external_checks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("integration_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), sa.ForeignKey("transactions.id"), nullable=False, unique=True),
        sa.Column("idempotency_key", sa.Uuid(), nullable=False),
        sa.Column("correlation_id", sa.Uuid(), nullable=False),
        sa.Column("contact_id", sa.Uuid(), sa.ForeignKey("trusted_contacts.id")),
        sa.Column("gateway_identifier", sa.String(44)),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("contact_outcome", sa.String(40), nullable=False),
        sa.Column("notification_id", sa.Uuid(), sa.ForeignKey("contact_notifications.id")),
        sa.Column("external_check_id", sa.Uuid(), sa.ForeignKey("external_checks.id")),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(40)),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_id", "idempotency_key", name="uq_integration_run_key"))
    op.create_index("ix_integration_runs_state", "integration_runs", ["state"])


def downgrade() -> None:
    op.drop_table("integration_runs")
