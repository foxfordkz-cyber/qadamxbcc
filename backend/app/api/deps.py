from collections.abc import AsyncIterator
from typing import Annotated, cast

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.resources import Resources
from app.services.antifraud import AntifraudEngine


def get_resources(request: Request) -> Resources:
    return cast(Resources, request.app.state.resources)


async def get_session(
    resources: Annotated[Resources, Depends(get_resources)],
) -> AsyncIterator[AsyncSession]:
    async with resources.session_factory() as session:
        yield session


def get_engine(resources: Annotated[Resources, Depends(get_resources)]) -> AntifraudEngine:
    return resources.engine


SessionDep = Annotated[AsyncSession, Depends(get_session)]
EngineDep = Annotated[AntifraudEngine, Depends(get_engine)]
