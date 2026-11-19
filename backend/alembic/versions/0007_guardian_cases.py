"""Independent synthetic SOC cases and content retention."""
from alembic import op
import sqlalchemy as sa

revision = "0007_guardian_cases"
down_revision = "0006_guardian_reports"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("guardian_cases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("report_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column("source", sa.String(24), nullable=False),
        sa.Column("category", sa.String(24), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("assignee", sa.String(24)),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status_since", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_case_created_id", "guardian_cases", ["created_at", "id"])
    op.create_index("ix_guardian_cases_expires_at", "guardian_cases", ["expires_at"])
    op.create_table("guardian_case_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("case_id", sa.Uuid(), sa.ForeignKey("guardian_cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("key", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("actor_role", sa.String(16), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("question", sa.String(32)),
        sa.Column("reply_to", sa.Uuid(), unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("case_id", "version", name="uq_case_event_version"),
        sa.UniqueConstraint("case_id", "key", name="uq_case_event_key"),
    )
    op.create_table("guardian_case_content",
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("guardian_case_events.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("body", sa.String(500), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_guardian_case_content_expires_at", "guardian_case_content", ["expires_at"])


def downgrade():
    op.drop_table("guardian_case_content")
    op.drop_table("guardian_case_events")
    op.drop_table("guardian_cases")
