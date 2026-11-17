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
) -> FeedResponse:
    """Searchable SOC window; offset pages are not a snapshot or lossless event cursor."""
    return await soc.feed(
        session,
        limit=limit,
        offset=offset,
        q=q,
        since=since,
        status=status_filter,
        min_score=min_score,
    )


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
