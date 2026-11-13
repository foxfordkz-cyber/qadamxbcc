import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import EngineDep, SessionDep
from app.models import TransactionStatus
from app.schemas.soc import FeedResponse, GraphResponse
from app.services import soc
from app.services.transfers import NotFoundError

router = APIRouter(prefix="/soc", tags=["soc"])


@router.get("/feed", response_model=FeedResponse)
async def soc_feed(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    since: Annotated[
        datetime | None, Query(description="Only items newer than this (poll cursor)")
    ] = None,
    status_filter: Annotated[TransactionStatus | None, Query(alias="status")] = None,
    min_score: Annotated[int, Query(ge=0, le=100)] = 0,
) -> FeedResponse:
    """Live transaction stream for the SOC dashboard (poll with ``since=server_time``)."""
    return await soc.feed(
        session, limit=limit, since=since, status=status_filter, min_score=min_score
    )


@router.get("/graph/{account_id}", response_model=GraphResponse)
async def soc_graph(
    account_id: uuid.UUID,
    session: SessionDep,
    engine: EngineDep,
    depth: Annotated[int, Query(ge=1, le=3)] = 2,
) -> GraphResponse:
    """Money-flow subgraph around an account, shaped for React Flow (nodes + edges)."""
    try:
        return await soc.account_graph(session, engine.graph, account_id, depth=depth)
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
