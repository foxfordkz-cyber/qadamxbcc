"""Keep staff access versions and their audit trail in the same row."""

import sqlalchemy as sa
from alembic import op

revision = "0013_staff_access"
down_revision = "0012_mobile_core_merge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mobile_staff_access_event",
        sa.Column("subject", sa.Uuid(), primary_key=True),
        sa.Column("version", sa.Integer(), primary_key=True),
        sa.Column("actor", sa.Uuid(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("version > 0", name="positive_version"),
    )


def downgrade() -> None:
    op.drop_table("mobile_staff_access_event")
