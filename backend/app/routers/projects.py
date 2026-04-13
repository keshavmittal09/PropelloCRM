from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_user, get_db
from app.models.agent import Agent
from app.models.campaign import Project
from app.models.lead import Lead
from app.schemas.schemas import LeadResponse, ProjectResponse

router = APIRouter()


def _parse_bhk(value: Optional[str]) -> list[str]:
    if not value:
        return []
    return [v.strip() for v in value.split(",") if v.strip()]


def _serialize_bhk(values: Optional[list[str]]) -> Optional[str]:
    if not values:
        return None
    return json.dumps(values)


async def _project_leads(project_id: str, db: AsyncSession) -> list[Lead]:
    result = await db.execute(
        select(Lead)
        .options(selectinload(Lead.contact), selectinload(Lead.assigned_agent))
        .order_by(Lead.updated_at.desc())
    )
    leads = []
    for lead in result.scalars().all():
        ids = list(lead.project_ids or [])
        if project_id in ids:
            leads.append(lead)
    leads.sort(key=lambda l: {"hot": 0, "warm": 1, "cold": 2}.get(l.lead_score, 3))
    return leads


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    skip: int = Query(0),
    limit: int = Query(100),
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    del current_user
    result = await db.execute(select(Project).order_by(Project.created_at.desc()).offset(skip).limit(limit))
    items = []
    for p in result.scalars().all():
        options = []
        try:
            options = json.loads(p.bhk_options) if p.bhk_options else []
        except Exception:
            options = []
        items.append(
            ProjectResponse(
                id=p.id,
                name=p.name,
                developer=p.developer,
                location=p.location,
                city=p.city,
                bhk_options=options,
                price_range_min=float(p.price_range_min) if p.price_range_min is not None else None,
                price_range_max=float(p.price_range_max) if p.price_range_max is not None else None,
                brochure_url=p.brochure_url,
                status=p.status,
                created_at=p.created_at,
            )
        )
    return items


@router.post("", response_model=ProjectResponse)
async def create_project(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Only admin/manager can create projects")

    name = str(payload.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    project = Project(
        name=name,
        developer=payload.get("developer"),
        location=payload.get("location"),
        city=payload.get("city"),
        bhk_options=_serialize_bhk(payload.get("bhk_options") or _parse_bhk(payload.get("bhk_options_csv"))),
        price_range_min=payload.get("price_range_min"),
        price_range_max=payload.get("price_range_max"),
        brochure_url=payload.get("brochure_url"),
        status=payload.get("status") or "active",
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)

    return ProjectResponse(
        id=project.id,
        name=project.name,
        developer=project.developer,
        location=project.location,
        city=project.city,
        bhk_options=json.loads(project.bhk_options) if project.bhk_options else [],
        price_range_min=float(project.price_range_min) if project.price_range_min is not None else None,
        price_range_max=float(project.price_range_max) if project.price_range_max is not None else None,
        brochure_url=project.brochure_url,
        status=project.status,
        created_at=project.created_at,
    )


@router.get("/{project_id}")
async def get_project_detail(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    del current_user
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    leads = await _project_leads(project_id, db)

    return {
        "project": {
            "id": project.id,
            "name": project.name,
            "developer": project.developer,
            "location": project.location,
            "city": project.city,
            "bhk_options": json.loads(project.bhk_options) if project.bhk_options else [],
            "price_range_min": float(project.price_range_min) if project.price_range_min is not None else None,
            "price_range_max": float(project.price_range_max) if project.price_range_max is not None else None,
            "brochure_url": project.brochure_url,
            "status": project.status,
            "created_at": project.created_at,
        },
        "leads": [LeadResponse.model_validate(l).model_dump() for l in leads],
    }


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Only admin/manager can update projects")

    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    editable = [
        "name",
        "developer",
        "location",
        "city",
        "price_range_min",
        "price_range_max",
        "brochure_url",
        "status",
    ]
    for field in editable:
        if field in payload:
            setattr(project, field, payload.get(field))

    if "bhk_options" in payload:
        project.bhk_options = _serialize_bhk(payload.get("bhk_options"))
    elif "bhk_options_csv" in payload:
        project.bhk_options = _serialize_bhk(_parse_bhk(payload.get("bhk_options_csv")))

    await db.commit()
    await db.refresh(project)

    return ProjectResponse(
        id=project.id,
        name=project.name,
        developer=project.developer,
        location=project.location,
        city=project.city,
        bhk_options=json.loads(project.bhk_options) if project.bhk_options else [],
        price_range_min=float(project.price_range_min) if project.price_range_min is not None else None,
        price_range_max=float(project.price_range_max) if project.price_range_max is not None else None,
        brochure_url=project.brochure_url,
        status=project.status,
        created_at=project.created_at,
    )


@router.post("/{project_id}/leads/{lead_id}")
async def add_project_tag(
    project_id: str,
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role not in ["admin", "manager", "agent"]:
        raise HTTPException(status_code=403, detail="Not allowed")

    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    ids = list(lead.project_ids or [])
    if project_id not in ids:
        ids.append(project_id)
        lead.project_ids = ids
        await db.commit()

    return {"status": "ok", "project_id": project_id, "lead_id": lead_id}


@router.delete("/{project_id}/leads/{lead_id}")
async def remove_project_tag(
    project_id: str,
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role not in ["admin", "manager", "agent"]:
        raise HTTPException(status_code=403, detail="Not allowed")

    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    ids = [pid for pid in list(lead.project_ids or []) if pid != project_id]
    lead.project_ids = ids
    await db.commit()

    return {"status": "ok", "project_id": project_id, "lead_id": lead_id}
