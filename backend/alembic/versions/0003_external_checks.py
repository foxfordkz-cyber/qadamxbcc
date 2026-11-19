"""Durable synthetic enrichment and request idempotency."""
from alembic import op
import sqlalchemy as sa

revision = "0003_external_checks"
down_revision = "0002_trusted_contacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("external_checks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), sa.ForeignKey("transactions.id")),
        sa.Column("idempotency_key", sa.Uuid(), nullable=False),
        sa.Column("correlation_id", sa.Uuid(), nullable=False),
        sa.Column("identifier", sa.String(44), nullable=False),
        sa.Column("result", sa.JSON()),
        sa.Column("cache_hit", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_id", "idempotency_key", name="uq_external_check_key"))
    for name in ("owner_id", "transaction_id"):
        op.create_index(f"ix_external_checks_{name}", "external_checks", [name])


def downgrade() -> None:
    op.drop_table("external_checks")
