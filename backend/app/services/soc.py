"""SOC officer read models: live risk feed and React Flow subgraph."""

import math
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Account, Transaction, TransactionStatus
from app.schemas.soc import (
    FeedItem,
    FeedParty,
    FeedResponse,
    FeedStats,
    GraphEdgeData,
    GraphEdgeOut,
    GraphNode,
    GraphNodeData,
    GraphResponse,
    NodeRole,
    Position,
)
from app.schemas.transfers import RiskReasonOut
from app.services.graph import GraphStore, NodeView
from app.services.transfers import NotFoundError, register_account

RING_SPACING = 280.0


def _party(account: Account) -> FeedParty:
    return FeedParty(id=account.id, full_name=account.full_name, iban=account.iban)


async def feed(
    session: AsyncSession,
    *,
    limit: int = 50,
    since: datetime | None = None,
    status: TransactionStatus | None = None,
    min_score: int = 0,
) -> FeedResponse:
    stmt = (
        select(Transaction)
        .options(
            selectinload(Transaction.sender),
            selectinload(Transaction.recipient),
            selectinload(Transaction.risk_events),
        )
        .order_by(Transaction.created_at.desc(), Transaction.id)
        .limit(limit)
    )
    if since is not None:
        stmt = stmt.where(Transaction.created_at > since)
    if status is not None:
        stmt = stmt.where(Transaction.status == status)
    if min_score:
        stmt = stmt.where(Transaction.risk_score >= min_score)
    rows = (await session.execute(stmt)).scalars().all()

    items = [
        FeedItem(
            transaction_id=tx.id,
            created_at=tx.created_at,
            status=tx.status,
            risk_score=tx.risk_score,
            amount=tx.amount,
            currency=tx.currency,
            latency_ms=tx.latency_ms,
            sender=_party(tx.sender),
            recipient=_party(tx.recipient),
            active_call=tx.active_call,
            from_deposit=tx.from_deposit,
            is_new_device=tx.is_new_device,
            is_new_recipient=tx.is_new_recipient,
            cooling_until=tx.cooling_until,
            resolved_at=tx.resolved_at,
            reasons=[
                RiskReasonOut(
                    code=e.rule_code,
                    layer=e.layer,
                    score_delta=e.score_delta,
                    reason_kk=e.reason_kk,
                    reason_ru=e.reason_ru,
                )
                for e in tx.risk_events
            ],
        )
        for tx in rows
    ]
    return FeedResponse(server_time=datetime.now(UTC), items=items, stats=await _stats(session))


async def _stats(session: AsyncSession) -> FeedStats:
    by_status = await session.execute(
        select(
            Transaction.status,
            func.count(),
            func.coalesce(func.avg(Transaction.latency_ms), 0.0),
            func.coalesce(func.max(Transaction.latency_ms), 0.0),
        ).group_by(Transaction.status)
    )
    stats = FeedStats()
    weighted = 0.0
    for status, count, avg_latency, max_latency in by_status:
        setattr(stats, TransactionStatus(status).value, int(count))
        stats.total += int(count)
        weighted += float(avg_latency) * int(count)
        stats.max_latency_ms = max(stats.max_latency_ms, round(float(max_latency), 3))
    if stats.total:
        stats.avg_latency_ms = round(weighted / stats.total, 3)
    return stats


def _role(node: NodeView) -> NodeRole:
    if node.depth == 0:
        return "center"
    if node.metrics.is_hub or (node.metrics.flagged and node.metrics.in_degree > 0):
        return "hub"
    if node.metrics.suspected_mule:
        return "mule"
    return "normal"


def _layout(nodes: list[NodeView]) -> dict[str, Position]:
    """Concentric rings by BFS depth — deterministic, so the demo graph never jumps."""
    rings: dict[int, list[str]] = {}
    for n in nodes:
        rings.setdefault(n.depth, []).append(n.id)
    positions: dict[str, Position] = {}
    for depth, ids in rings.items():
        if depth == 0:
            positions[ids[0]] = Position(x=0.0, y=0.0)
            continue
        radius = RING_SPACING * depth
        offset = (math.pi / len(ids)) * (depth - 1)
        for i, node_id in enumerate(ids):
            angle = offset + 2 * math.pi * i / len(ids)
            positions[node_id] = Position(
                x=round(radius * math.cos(angle), 1), y=round(radius * math.sin(angle), 1)
            )
    return positions


async def account_graph(
    session: AsyncSession, graph: GraphStore, account_id: uuid.UUID, *, depth: int = 2
) -> GraphResponse:
    account = await session.get(Account, account_id)
    if account is None:
        raise NotFoundError(f"account {account_id} not found")
    # Accounts created after startup (e.g. seeded while running) are not hydrated yet.
    register_account(graph, account)
    view = graph.subgraph(str(account_id), depth=depth)

    positions = _layout(view.nodes)
    roles = {n.id: _role(n) for n in view.nodes}
    suspicious = {nid for nid, role in roles.items() if role in ("hub", "mule")}
    nodes = [
        GraphNode(
            id=n.id,
            position=positions[n.id],
            data=GraphNodeData(
                label=n.label,
                role=roles[n.id],
                depth=n.depth,
                device_id=n.device_id,
                flagged=n.metrics.flagged,
                suspected_mule=n.metrics.suspected_mule,
                in_degree=n.metrics.in_degree,
                out_degree=n.metrics.out_degree,
                in_weight=round(n.metrics.in_weight, 2),
                out_weight=round(n.metrics.out_weight, 2),
                transit_ratio=round(n.metrics.transit_ratio, 3),
                shared_device_accounts=n.metrics.shared_device_accounts,
            ),
        )
        for n in view.nodes
    ]
    edges: list[GraphEdgeOut] = []
    for e in view.edges:
        is_transfer = e.edge_type == "transfer"
        highlight = (
            (e.target in suspicious)
            if is_transfer
            else (e.source in suspicious or e.target in suspicious)
        )
        edges.append(
            GraphEdgeOut(
                id=f"{e.edge_type}:{e.source}->{e.target}",
                source=e.source,
                target=e.target,
                type="default" if is_transfer else "straight",
                animated=is_transfer and highlight,
                label=f"{e.weight:,.0f} ₸".replace(",", " ") if is_transfer else None,
                data=GraphEdgeData(
                    edge_type="transfer" if is_transfer else "shared_device",
                    weight=round(e.weight, 2),
                    tx_count=e.tx_count,
                    highlight=highlight,
                ),
            )
        )
    return GraphResponse(center=str(account_id), depth=depth, nodes=nodes, edges=edges)
