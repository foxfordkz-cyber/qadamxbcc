"""Durable scheduling without rewriting any already-applied migration."""
from alembic import op
import sqlalchemy as sa

revision = "0002a_notification_retry"
down_revision = "0002_trusted_contacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("contact_notifications", sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("contact_notifications", sa.Column("next_attempt_at", sa.DateTime(timezone=True)))
    op.create_index("ix_notification_due", "contact_notifications", ["state", "next_attempt_at"])


def downgrade() -> None:
    op.drop_index("ix_notification_due", table_name="contact_notifications")
    op.drop_column("contact_notifications", "next_attempt_at")
    op.drop_column("contact_notifications", "attempts")
