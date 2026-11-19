"""Explicit per-contact preferences; no broadcast policy."""
from alembic import op
import sqlalchemy as sa

revision = "0005_contact_preferences"
down_revision = "0004a_retry_stack_merge"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("trusted_contacts", sa.Column("alias", sa.String(40), nullable=False, server_default=""))
    op.add_column("trusted_contacts", sa.Column("notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))

def downgrade():
    op.drop_column("trusted_contacts", "notifications_enabled")
    op.drop_column("trusted_contacts", "alias")
