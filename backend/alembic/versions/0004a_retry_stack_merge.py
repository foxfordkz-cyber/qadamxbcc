"""Join the existing orchestration head with the retry/gateway merge."""
revision = "0004a_retry_stack_merge"
down_revision = ("0004_integration_runs", "0003a_retry_gateway_merge")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
