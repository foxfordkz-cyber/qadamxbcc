import uuid
from collections.abc import Callable, Coroutine
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import SessionDep
from app.db.base import utcnow
from app.integrations.cases import service
from app.integrations.cases.models import CaseContent, CaseEvent
from app.integrations.cases.schemas import (
    Action,
    AnswerInformation,
    AnswerReceipt,
    CaseAnalytics,
    CaseExport,
    CaseOut,
    CasePage,
    ContentOut,
    ContentPage,
    EventOut,
    EventPage,
    ExportEvent,
    InformationOut,
    OpenCase,
)
from app.integrations.models import GuardianReport, IntegrationAudit
from app.integrations.security import ConfigDep, PrincipalDep, require_role
from app.integrations.telegram.schemas import AuditOut


class SafeCaseRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            try:
                response = await original(request)
            except RequestValidationError:
                # Do not echo arbitrary rejected text, authorization headers or body inputs.
                response = JSONResponse({"detail": "case_input_invalid"}, status_code=422)
            response.headers["Cache-Control"] = "no-store"
            return response

        return handler


router = APIRouter(
    prefix="/guardian", tags=["Guardian synthetic SOC cases"], route_class=SafeCaseRoute
)
Key = Annotated[uuid.UUID, Header(alias="Idempotency-Key")]
Limit = Annotated[int, Query(ge=1, le=100)]
After = Annotated[int, Query(ge=0)]


@router.post("/soc/cases", response_model=CaseOut, status_code=201)
async def create(
    body: OpenCase,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    idempotency_key: Key,
) -> CaseOut:
    require_role(principal, "soc")
    return await service.open_case(
        session, body.report_id, principal, idempotency_key, service.digest(body, principal)
    )


@router.get("/soc/cases", response_model=CasePage)
async def list_cases(
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    limit: Limit = 20,
    cursor: Annotated[str | None, Query(max_length=500)] = None,
) -> CasePage:
    require_role(principal, "soc")
    return await service.page(
        session, limit, cursor, cfg.signing_key.get_secret_value(), principal.subject
    )


@router.get("/soc/cases/analytics", response_model=CaseAnalytics)
async def case_analytics(
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> CaseAnalytics:
    require_role(principal, "soc")
    return await service.analytics(session)


@router.get("/soc/cases/{case_id}", response_model=CaseOut)
async def read_case(
    case_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> CaseOut:
    require_role(principal, "soc")
    return CaseOut.model_validate(await service.get_case(session, case_id))


@router.post("/soc/cases/{case_id}/actions", response_model=CaseOut)
async def action(
    case_id: uuid.UUID,
    body: Action,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    idempotency_key: Key,
) -> CaseOut:
    require_role(principal, "soc")
    return await service.mutate(session, case_id, principal, idempotency_key, body)


@router.get("/soc/cases/{case_id}/history", response_model=EventPage)
async def history(
    case_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    limit: Limit = 20,
    after_version: After = 0,
) -> EventPage:
    require_role(principal, "soc")
    await service.get_case(session, case_id)
    rows = list(
        await session.scalars(
            select(CaseEvent)
            .where(
                CaseEvent.case_id == case_id,
                CaseEvent.version > after_version,
            )
            .order_by(CaseEvent.version)
            .limit(limit + 1)
        )
    )
    return EventPage(
        items=[EventOut.model_validate(service.event_output(e)) for e in rows[:limit]],
        next_after_version=rows[limit - 1].version if len(rows) > limit else None,
    )


@router.get("/soc/cases/{case_id}/notes", response_model=ContentPage)
async def notes(
    case_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    limit: Limit = 20,
    after_version: After = 0,
) -> ContentPage:
    require_role(principal, "soc")
    await service.get_case(session, case_id)
    rows = (
        await session.execute(
            select(CaseContent, CaseEvent.version)
            .join(CaseEvent, CaseContent.event_id == CaseEvent.id)
            .where(
                CaseEvent.case_id == case_id,
                CaseEvent.version > after_version,
                CaseContent.expires_at > utcnow(),
            )
            .order_by(CaseEvent.version)
            .limit(limit + 1)
        )
    ).all()
    return ContentPage(
        items=[
            ContentOut(event_id=c.event_id, body=c.body, expires_at=c.expires_at)
            for c, _ in rows[:limit]
        ],
        next_after_version=rows[limit - 1][1] if len(rows) > limit else None,
    )


class EvidenceOut(BaseModel):
    report_available: bool
    transaction_id: uuid.UUID | None
    report_events: list[AuditOut]
    advisory_only: bool = True


@router.get("/soc/cases/{case_id}/evidence", response_model=EvidenceOut)
async def evidence(
    case_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> EvidenceOut:
    require_role(principal, "soc")
    row = await service.get_case(session, case_id)
    report = await session.get(GuardianReport, row.report_id)
    available = (
        report is not None and report.expires_at > utcnow() and report.description is not None
    )
    events = await session.scalars(
        select(IntegrationAudit)
        .where(IntegrationAudit.resource_id == row.report_id)
        .order_by(IntegrationAudit.created_at)
        .limit(20)
    )
    return EvidenceOut(
        report_available=available,
        transaction_id=report.transaction_id if report and available else None,
        report_events=[AuditOut.model_validate(e) for e in events],
    )


@router.get("/soc/cases/{case_id}/export", response_model=CaseExport)
async def export(
    case_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> CaseExport:
    require_role(principal, "soc")
    row = await service.get_case(session, case_id)
    parsed = CaseOut.model_validate(row)
    rows = await session.scalars(
        select(CaseEvent).where(CaseEvent.case_id == case_id).order_by(CaseEvent.version).limit(500)
    )
    return CaseExport(
        category=parsed.category,
        state=parsed.state,
        source=parsed.source,
        created_at=parsed.created_at,
        events=[
            ExportEvent(code=e.code, state=e.result["case"]["state"], timestamp=e.created_at)
            for e in rows
        ],
    )


@router.get("/reports/{report_id}/information-requests", response_model=list[InformationOut])
async def information_requests(
    report_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> list[InformationOut]:
    require_role(principal, "owner")
    row = await service.owned_case(session, report_id, principal)
    return await service.information(session, row)


@router.post("/reports/{report_id}/information-requests/{request_id}", response_model=AnswerReceipt)
async def answer_information(
    report_id: uuid.UUID,
    request_id: uuid.UUID,
    body: AnswerInformation,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    idempotency_key: Key,
) -> AnswerReceipt:
    require_role(principal, "owner")
    row = await service.owned_case(session, report_id, principal, lock=True)
    await service.answer(session, row, request_id, principal, idempotency_key, body)
    return AnswerReceipt(request_id=request_id)
