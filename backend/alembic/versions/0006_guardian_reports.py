"""Seven-day demo report content and owned idempotency."""
from alembic import op
import sqlalchemy as sa

revision = "0006_guardian_reports"
down_revision = "0005_contact_preferences"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("guardian_reports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("contact_id", sa.Uuid(), sa.ForeignKey("trusted_contacts.id")),
        sa.Column("transaction_id", sa.Uuid(), sa.ForeignKey("transactions.id")),
        sa.Column("idempotency_key", sa.Uuid(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("category", sa.String(24), nullable=False),
        sa.Column("description", sa.String(500)),
        sa.Column("state", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_id", "idempotency_key", name="uq_guardian_owner_key"),
        sa.UniqueConstraint("owner_id", "content_hash", name="uq_guardian_owner_content"),
    )
    op.create_index("ix_guardian_reports_owner_id", "guardian_reports", ["owner_id"])
    op.create_index("ix_guardian_reports_expires_at", "guardian_reports", ["expires_at"])


def downgrade():
    op.drop_table("guardian_reports")

