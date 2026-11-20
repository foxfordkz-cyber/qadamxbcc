"""Customer family preferences and advisory answers after a call."""

import sqlalchemy as sa
from alembic import op

revision = "0009_mobile_protection"
down_revision = "0008_core_integration_merge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mobile_family_shield",
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("accounts.id"), primary_key=True),
        sa.Column("disable_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "mobile_post_call",
        sa.Column("transaction_id", sa.Uuid(), sa.ForeignKey("transactions.id"), primary_key=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("answered_at", sa.DateTime(timezone=True)),
        sa.Column("answer", sa.String(16)),
    )


def downgrade() -> None:
    op.drop_table("mobile_post_call")
    op.drop_table("mobile_family_shield")
