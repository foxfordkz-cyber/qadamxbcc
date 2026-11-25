"""Store WebAuthn public keys and signed transfer intent evidence."""

import sqlalchemy as sa
from alembic import op

revision = "0015_transfer_key"
down_revision = "0014_family_approval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mobile_transfer_key",
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("accounts.id"), primary_key=True),
        sa.Column("credential_id", sa.LargeBinary(), unique=True, nullable=False),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.BigInteger(), nullable=False),
    )
    op.create_table(
        "mobile_signed_intent",
        sa.Column("request_id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("recipient_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("amount_tiyn", sa.BigInteger(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("session_hash", sa.String(64), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("mobile_signed_intent")
    op.drop_table("mobile_transfer_key")
