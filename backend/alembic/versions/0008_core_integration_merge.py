"""Join the published core lifecycle and integration histories without rewriting either."""

revision = "0008_core_integration_merge"
down_revision = ("0003", "0007_guardian_cases")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
