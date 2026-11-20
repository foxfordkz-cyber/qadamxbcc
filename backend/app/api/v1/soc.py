import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response, status

from app.api.deps import EngineDep, SessionDep
from app.models import TransactionStatus
from app.schemas.funds_trace import FundsTrace
from app.schemas.soc import (
    FeedResponse,
    GraphResponse,
    RecipientFlagRequest,
    RecipientFlagResponse,
    RecipientFlagState,
)
from app.services import recipient_flags, soc, submission_limits
from app.services.funds_trace import funds_trace
from app.services.recipient_lookback import PriorReceipts, prior_receipts
from app.services.trace_anchors import TraceAnchors, recent_anchors
from app.services.transfers import NotFoundError

router = APIRouter(prefix="/soc", tags=["soc"])


@router.get("/accounts/{account_id}/trace-anchors", response_model=TraceAnchors)
async def trace_anchors(
    account_id: uuid.UUID, session: SessionDep, response: Response
) -> TraceAnchors:
    """Up to eight settled KZT receipts among the last 64 transfers to this account."""
    response.headers["Cache-Control"] = "no-store"
    return await recent_anchors(session, account_id)


@router.get("/transfers/{transaction_id}/funds-trace", response_model=FundsTrace)
async def trace_transfer(
    transaction_id: uuid.UUID, session: SessionDep, response: Response
) -> FundsTrace:
    """One amount-conserving, time-ordered allocation through later approved payments."""
    response.headers["Cache-Control"] = "no-store"
    result = await funds_trace(session, transaction_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "transaction_not_found")
    return result


@router.get("/feed", response_model=FeedResponse)
async def soc_feed(
    session: SessionDep,
    request: Request,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    q: Annotated[
        str | None,
        Query(
            max_length=128,
            pattern=r"^[^\x00]*$",
            description="Party name substring or exact transaction UUID",
        ),
    ] = None,
    since: Annotated[
        datetime | None, Query(description="Rows updated after this time; not a lossless cursor")
    ] = None,
    status_filter: Annotated[TransactionStatus | None, Query(alias="status")] = None,
    min_score: Annotated[int, Query(ge=0, le=100)] = 0,
    alerts_only: bool = False,
) -> FeedResponse:
    """Searchable SOC window; offset pages are not a snapshot or lossless event cursor."""
    result = await soc.feed(
        session,
        limit=limit,
        offset=offset,
        q=q,
        since=since,
        status=status_filter,
        min_score=min_score,
        alerts_only=alerts_only,
    )
    if request.app.state.settings.api_key:
        result.stats.submission_limits = await submission_limits.summary(
            request.app.state.resources.redis
        )
    return result


@router.get("/recipients/{account_id}/flag", response_model=RecipientFlagState)
async def recipient_flag_state(
    account_id: uuid.UUID, session: SessionDep, response: Response
) -> RecipientFlagState:
    response.headers["Cache-Control"] = "no-store"
    try:
        return await recipient_flags.state(session, account_id)
    except recipient_flags.FlagError as exc:
        raise HTTPException(exc.status, exc.code) from exc


@router.post("/recipients/{account_id}/flag", response_model=RecipientFlagResponse)
async def flag_recipient(
    account_id: uuid.UUID,
    body: RecipientFlagRequest,
    session: SessionDep,
    engine: EngineDep,
    request: Request,
    response: Response,
) -> RecipientFlagResponse:
    """Confirm/unmark a reviewed recipient with a durable service-actor audit."""
    response.headers["Cache-Control"] = "no-store"
    key = request.app.state.settings.soc_api_key
    actor = recipient_flags.service_actor(key.get_secret_value() if key else None)
    try:
        return await recipient_flags.set_flag(session, engine.graph, account_id, body, actor)
    except recipient_flags.FlagError as exc:
        raise HTTPException(exc.status, exc.code) from exc


@router.get("/recipients/{account_id}/prior-receipts", response_model=PriorReceipts)
async def prior_recipient_receipts(
    account_id: uuid.UUID,
    session: SessionDep,
    response: Response,
    version: Annotated[int, Query(ge=1)],
    days: Annotated[int, Query(ge=1, le=30)] = 7,
    cursor: uuid.UUID | None = None,
) -> PriorReceipts:
    response.headers["Cache-Control"] = "no-store"
    try:
        return await prior_receipts(session, account_id, version, days, cursor)
    except recipient_flags.FlagError as exc:
        raise HTTPException(exc.status, exc.code) from exc


@router.get("/graph/{account_id}", response_model=GraphResponse)
async def soc_graph(
    account_id: uuid.UUID,
    session: SessionDep,
    engine: EngineDep,
    depth: Annotated[int, Query(ge=1, le=3)] = 2,
) -> GraphResponse:
    """Money-flow subgraph around an account, shaped for React Flow (nodes + edges)."""
    await engine.ensure_consistent()
    try:
        return await soc.account_graph(session, engine.graph, account_id, depth=depth)
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
