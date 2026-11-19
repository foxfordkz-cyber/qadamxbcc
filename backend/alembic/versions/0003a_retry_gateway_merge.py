"""Join independently published gateway and notification-retry histories."""
revision = "0003a_retry_gateway_merge"
down_revision = ("0003_external_checks", "0002a_notification_retry")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
