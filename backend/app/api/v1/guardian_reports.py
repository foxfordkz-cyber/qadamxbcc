import uuid
from typing import Annotated

from fastapi import APIRouter, Header, Query, Response
from sqlalchemy import select

from app.api.deps import SessionDep
from app.integrations.audit import record
from app.integrations.errors import IntegrationError
from app.integrations.guardian_reports import ReportOut, ReportRequest, create_report, report_output
from app.integrations.models import GuardianReport, IntegrationAudit
from app.integrations.security import ConfigDep, PrincipalDep, require_role
from app.integrations.telegram.schemas import AuditOut

router = APIRouter(prefix="/guardian", tags=["Guardian demo reports"])


@router.post("/reports", response_model=ReportOut, status_code=201)
async def submit(
    body: ReportRequest,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    response: Response,
    idempotency_key: Annotated[uuid.UUID, Header()],
) -> ReportOut:
    require_role(principal, "owner")
    response.headers["Cache-Control"] = "no-store"
    return report_output(await create_report(session, principal.subject, body, idempotency_key))


@router.get("/reports", response_model=list[ReportOut])
async def list_reports(
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    response: Response,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[ReportOut]:
    from app.db.base import utcnow

    if principal.role != "soc":
        require_role(principal, "owner")
    query = select(GuardianReport).where(
        GuardianReport.expires_at > utcnow(), GuardianReport.description.is_not(None)
    )
    if principal.role != "soc":
        query = query.where(
            GuardianReport.owner_id == principal.subject, GuardianReport.contact_id.is_(None)
        )
    rows = await session.scalars(query.order_by(GuardianReport.created_at.desc()).limit(limit))
    response.headers["Cache-Control"] = "no-store"
    return [report_output(row) for row in rows]


@router.get("/reports/{report_id}", response_model=ReportOut)
async def read_report(
    report_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    response: Response,
) -> ReportOut:
    if principal.role != "soc":
        require_role(principal, "owner")
    row = await session.get(GuardianReport, report_id)
    if row is None or (
        principal.role != "soc"
        and (row.owner_id != principal.subject or row.contact_id is not None)
    ):
        raise IntegrationError(404, "incident_not_found")
    response.headers["Cache-Control"] = "no-store"
    return report_output(row)


@router.post("/reports/{report_id}/acknowledge", response_model=ReportOut)
async def acknowledge(
    report_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    response: Response,
) -> ReportOut:
    require_role(principal, "soc")
    row = await session.scalar(
        select(GuardianReport).where(GuardianReport.id == report_id).with_for_update()
    )
    if row is None:
        raise IntegrationError(404, "incident_not_found")
    report_output(row)
    if row.state != "DEMO_ACKNOWLEDGED":
        row.state = "DEMO_ACKNOWLEDGED"
        record(session, row.owner_id, row.id, row.id, "GUARDIAN_REPORT_DEMO_ACKNOWLEDGED")
        await session.commit()
    response.headers["Cache-Control"] = "no-store"
    return report_output(row)


@router.get("/reports/{report_id}/history", response_model=list[AuditOut])
async def report_history(
    report_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    response: Response,
) -> list[AuditOut]:
    if principal.role != "soc":
        require_role(principal, "owner")
    row = await session.get(GuardianReport, report_id)
    if row is None or (
        principal.role != "soc"
        and (row.owner_id != principal.subject or row.contact_id is not None)
    ):
        raise IntegrationError(404, "incident_not_found")
    rows = await session.scalars(
        select(IntegrationAudit)
        .where(IntegrationAudit.resource_id == report_id, IntegrationAudit.owner_id == row.owner_id)
        .order_by(IntegrationAudit.created_at)
        .limit(20)
    )
    response.headers["Cache-Control"] = "no-store"
    return [AuditOut.model_validate(a) for a in rows]
