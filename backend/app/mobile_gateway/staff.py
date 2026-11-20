"""Administration is limited to the preconfigured SOC test employee."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import SessionDep
from app.mobile_gateway.app import IdentityDep
from app.mobile_gateway.config import MobileSettings
from app.mobile_gateway.staff_models import StaffAccessEvent, staff_status


class StaffCard(BaseModel):
    subject: UUID
    login: Literal["admin_demo"] = "admin_demo"
    role: Literal["officer"] = "officer"
    enabled: bool
    version: int


class AuditEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    subject: UUID
    actor: UUID
    at: datetime
    enabled: bool
    version: int


class StaffOverview(BaseModel):
    items: list[StaffCard]
    audit: list[AuditEntry]


class AccessChange(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool
    expected_version: int = Field(ge=0)


def install_staff(app: FastAPI, cfg: MobileSettings) -> None:
    base = "/mobile/v1/admin/staff"

    @app.get(base)
    async def overview(principal: IdentityDep, db: SessionDep) -> StaffOverview:
        if principal.role != "platform_admin":
            raise HTTPException(403, "platform_admin_required")
        events = list(
            await db.scalars(
                select(StaffAccessEvent)
                .where(StaffAccessEvent.subject == cfg.officer_id)
                .order_by(StaffAccessEvent.version.desc())
                .limit(25)
            )
        )
        latest = events[0] if events else None
        return StaffOverview(
            items=[
                StaffCard(
                    subject=cfg.officer_id,
                    enabled=latest.enabled if latest else True,
                    version=latest.version if latest else 0,
                )
            ],
            audit=[AuditEntry.model_validate(event) for event in events],
        )

    @app.patch(base + "/{subject}")
    async def change(
        subject: UUID, body: AccessChange, principal: IdentityDep, db: SessionDep
    ) -> StaffCard:
        if principal.role != "platform_admin":
            raise HTTPException(403, "platform_admin_required")
        if subject != cfg.officer_id:
            raise HTTPException(404, "staff_member_not_found")
        enabled, version = await staff_status(db, subject)
        if body.expected_version != version:
            raise HTTPException(409, "staff_version_conflict")
        if body.enabled != enabled:
            version += 1
            db.add(
                StaffAccessEvent(
                    subject=subject, actor=principal.subject, version=version, enabled=body.enabled
                )
            )
            try:
                # The primary key accepts at most one decision at this revision.
                # Committing the audit row also revokes every older officer session.
                await db.commit()
            except IntegrityError:
                await db.rollback()
                raise HTTPException(409, "staff_version_conflict") from None
        return StaffCard(subject=subject, enabled=body.enabled, version=version)
