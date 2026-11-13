"""initial schema: accounts, transactions, risk_events, graph_edges

Revision ID: 0001
Revises:
Create Date: 2026-11-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TX_STATUS = sa.Enum("approved", "cooling_off", "blocked", name="transaction_status")
EDGE_TYPE = sa.Enum("transfer", "shared_device", name="edge_type")
TS = sa.DateTime(timezone=True)
MONEY = sa.Numeric(18, 2)


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("iin", sa.String(12), nullable=False),
        sa.Column("iban", sa.String(20), nullable=False),
        sa.Column("phone", sa.String(16), nullable=False),
        sa.Column("full_name", sa.String(128), nullable=False),
        sa.Column("device_id", sa.String(64), nullable=False),
        sa.Column("avg_tx_amount", MONEY, nullable=False),
        sa.Column("is_flagged", sa.Boolean(), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.CheckConstraint("length(iin) = 12", name=op.f("ck_accounts_iin_len")),
        sa.CheckConstraint("iban LIKE 'KZ%'", name=op.f("ck_accounts_iban_kz")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_accounts")),
        sa.UniqueConstraint("iban", name=op.f("uq_accounts_iban")),
        sa.UniqueConstraint("iin", name=op.f("uq_accounts_iin")),
        sa.UniqueConstraint("phone", name=op.f("uq_accounts_phone")),
    )
    op.create_index(op.f("ix_accounts_device_id"), "accounts", ["device_id"])

    op.create_table(
        "transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("sender_id", sa.Uuid(), nullable=False),
        sa.Column("recipient_id", sa.Uuid(), nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("status", TX_STATUS, nullable=False),
        sa.Column("risk_score", sa.Integer(), nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=False),
        sa.Column("device_id", sa.String(64), nullable=False),
        sa.Column("active_call", sa.Boolean(), nullable=False),
        sa.Column("from_deposit", sa.Boolean(), nullable=False),
        sa.Column("is_new_device", sa.Boolean(), nullable=False),
        sa.Column("is_new_recipient", sa.Boolean(), nullable=False),
        sa.Column("cooling_until", TS, nullable=True),
        sa.Column("resolved_at", TS, nullable=True),
        sa.Column("created_at", TS, nullable=False),
        sa.CheckConstraint("amount > 0", name=op.f("ck_transactions_amount_positive")),
        sa.CheckConstraint(
            "risk_score BETWEEN 0 AND 100", name=op.f("ck_transactions_risk_score_range")
        ),
        sa.ForeignKeyConstraint(
            ["sender_id"],
            ["accounts.id"],
            name=op.f("fk_transactions_sender_id_accounts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipient_id"],
            ["accounts.id"],
            name=op.f("fk_transactions_recipient_id_accounts"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_transactions")),
    )
    op.create_index("ix_transactions_created_at", "transactions", ["created_at"])
    op.create_index("ix_transactions_sender_created", "transactions", ["sender_id", "created_at"])
    op.create_index(
        "ix_transactions_recipient_created", "transactions", ["recipient_id", "created_at"]
    )

    op.create_table(
        "risk_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), nullable=False),
        sa.Column("layer", sa.String(16), nullable=False),
        sa.Column("rule_code", sa.String(64), nullable=False),
        sa.Column("score_delta", sa.Integer(), nullable=False),
        sa.Column("reason_kk", sa.String(512), nullable=False),
        sa.Column("reason_ru", sa.String(512), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["transactions.id"],
            name=op.f("fk_risk_events_transaction_id_transactions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_risk_events")),
    )
    op.create_index(op.f("ix_risk_events_transaction_id"), "risk_events", ["transaction_id"])
    op.create_index(op.f("ix_risk_events_rule_code"), "risk_events", ["rule_code"])

    op.create_table(
        "graph_edges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("edge_type", EDGE_TYPE, nullable=False),
        sa.Column("weight", sa.Float(), nullable=False),
        sa.Column("tx_count", sa.Integer(), nullable=False),
        sa.Column("last_seen_at", TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["accounts.id"],
            name=op.f("fk_graph_edges_source_id_accounts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_id"],
            ["accounts.id"],
            name=op.f("fk_graph_edges_target_id_accounts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_graph_edges")),
        sa.UniqueConstraint("source_id", "target_id", "edge_type", name="uq_graph_edges_triplet"),
    )
    op.create_index("ix_graph_edges_target", "graph_edges", ["target_id"])


def downgrade() -> None:
    op.drop_index("ix_graph_edges_target", table_name="graph_edges")
    op.drop_table("graph_edges")
    op.drop_index(op.f("ix_risk_events_rule_code"), table_name="risk_events")
    op.drop_index(op.f("ix_risk_events_transaction_id"), table_name="risk_events")
    op.drop_table("risk_events")
    op.drop_index("ix_transactions_recipient_created", table_name="transactions")
    op.drop_index("ix_transactions_sender_created", table_name="transactions")
    op.drop_index("ix_transactions_created_at", table_name="transactions")
    op.drop_table("transactions")
    op.drop_index(op.f("ix_accounts_device_id"), table_name="accounts")
    op.drop_table("accounts")
    bind = op.get_bind()
    EDGE_TYPE.drop(bind, checkfirst=True)
    TX_STATUS.drop(bind, checkfirst=True)
