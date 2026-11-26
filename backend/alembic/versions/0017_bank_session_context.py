"""Keep pseudonymous bank login observations separate from browser transfer input."""

import sqlalchemy as sa
from alembic import op

revision = "0017_bank_session_context"
down_revision = "0016_dispute_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("has_network_history", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "bank_session_observations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("network_token", sa.String(64), nullable=False),
        sa.Column("country", sa.String(2), nullable=False),
        sa.Column("city", sa.String(32), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
    )
    for name, keys in [
        ("ix_bank_session_account_time", ["account_id", "observed_at"]),
        ("ix_bank_session_network_time", ["network_token", "observed_at"]),
        ("ix_bank_session_expiry", ["observed_at"]),
    ]:
        op.create_index(name, "bank_session_observations", keys)


def downgrade() -> None:
    op.drop_table("bank_session_observations")
    op.drop_column("accounts", "has_network_history")
