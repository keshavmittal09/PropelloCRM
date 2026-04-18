from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import get_current_user, get_db
from app.models.agent import Agent
from app.models.campaign import Campaign, Project
from app.models.lead import Lead
from app.models.models import Activity
from app.schemas.schemas import (
    CampaignAnalyticsResponse,
    CampaignDetailResponse,
    CampaignIngestRequest,
    CampaignIngestResult,
    CampaignLeadDetailResponse,
    CampaignLeadSummary,
    CampaignResponse,
    CampaignRow,
    CampaignUploadPreview,
    AgentAssignment,
    LeadResponse,
    ProjectResponse,
)
from app.services.campaign_service import (
    auto_link_project,
    list_campaign_leads,
    normalise_phone,
    parse_campaign_file,
    process_campaign_row,
)

router = APIRouter()


class AgentAssignmentRequest(BaseModel):
    selected_agent_ids: list[str] = Field(default_factory=list)


@router.post("/upload", response_model=CampaignUploadPreview)
async def upload_campaign_preview(
    file: UploadFile = File(...),
    campaign_name: str = Form(...),
    agent_name: str = Form("Niharika"),
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    del agent_name, db, current_user

    if not campaign_name.strip():
        raise HTTPException(status_code=400, detail="campaign_name is required")

    try:
        rows, fmt = parse_campaign_file(await file.read(), file.filename or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return CampaignUploadPreview(rows=[CampaignRow(**r) for r in rows], total=len(rows), format_detected=fmt)


@router.post("/ingest", response_model=CampaignIngestResult)
async def ingest_campaign(
    payload: CampaignIngestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if not payload.campaign_name.strip():
        raise HTTPException(status_code=400, detail="campaign_name is required")

    if not payload.rows:
        raise HTTPException(status_code=400, detail="No rows provided for ingestion")

    project_id = await auto_link_project(payload.campaign_name, db)

    campaign = Campaign(
        name=payload.campaign_name.strip(),
        project_id=project_id,
        agent_name=payload.agent_name or "Niharika",
        uploaded_by=current_user.id,
    )
    db.add(campaign)
    await db.flush()

    seen_phones: set[str] = set()
    hot = warm = cold = created = updated = failed_rows = skipped_duplicates = 0
    tier_dist: dict[str, int] = {}
    processed: list[CampaignLeadSummary] = []

    for row in payload.rows:
        row_data = row.model_dump()
        if not row_data.get("name") and not row_data.get("phone_number"):
            failed_rows += 1
            continue

        phone = normalise_phone(row_data.get("phone_number", ""))
        if phone and phone in seen_phones:
            skipped_duplicates += 1
            continue
        if phone:
            seen_phones.add(phone)

        try:
            outcome = await process_campaign_row(row_data, campaign, db)
            score = outcome["score"]
            if score == "hot":
                hot += 1
            elif score == "warm":
                warm += 1
            else:
                cold += 1

            if outcome["action"] == "created":
                created += 1
            else:
                updated += 1

            # Track tier distribution
            tier = outcome.get("priority_tier", "P7")
            tier_dist[tier] = tier_dist.get(tier, 0) + 1

            processed.append(CampaignLeadSummary(**outcome))
        except Exception:
            failed_rows += 1
            continue

    total_valid = hot + warm + cold
    if total_valid == 0:
        await db.rollback()
        raise HTTPException(status_code=400, detail="No valid rows found in file. Check column headers match expected format.")

    campaign.total_calls = total_valid
    campaign.hot_count = hot
    campaign.warm_count = warm
    campaign.cold_count = cold
    campaign.new_leads_created = created
    campaign.existing_leads_updated = updated
    campaign.skipped_duplicates = skipped_duplicates
    campaign.failed_rows = failed_rows

    await db.commit()

    processed.sort(key=lambda x: {"hot": 0, "warm": 1, "cold": 2}.get(x.score, 3))

    return CampaignIngestResult(
        campaign_id=campaign.id,
        total=total_valid,
        hot=hot,
        warm=warm,
        cold=cold,
        created=created,
        updated=updated,
        skipped_duplicates=skipped_duplicates,
        failed_rows=failed_rows,
        tier_distribution=tier_dist,
        leads=processed,
    )


@router.post("/ingest-single")
async def ingest_campaign_single(
    payload: dict,
    x_campaign_secret: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    if not x_campaign_secret or x_campaign_secret != settings.CAMPAIGN_WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid campaign secret")

    campaign_name = str(payload.get("campaign_name", "")).strip()
    if not campaign_name:
        raise HTTPException(status_code=400, detail="campaign_name is required")

    row_payload = payload.get("row") or payload.get("data") or payload
    row = CampaignRow(**row_payload)

    project_id = await auto_link_project(campaign_name, db)
    campaign = Campaign(name=campaign_name, project_id=project_id, agent_name=str(payload.get("agent_name", "Niharika")))
    db.add(campaign)
    await db.flush()

    outcome = await process_campaign_row(row.model_dump(), campaign, db)
    campaign.total_calls = 1
    campaign.hot_count = 1 if outcome["score"] == "hot" else 0
    campaign.warm_count = 1 if outcome["score"] == "warm" else 0
    campaign.cold_count = 1 if outcome["score"] == "cold" else 0
    campaign.new_leads_created = 1 if outcome["action"] == "created" else 0
    campaign.existing_leads_updated = 1 if outcome["action"] == "updated" else 0

    await db.commit()

    return {
        "campaign_id": campaign.id,
        "total": 1,
        "hot": campaign.hot_count,
        "warm": campaign.warm_count,
        "cold": campaign.cold_count,
        "created": campaign.new_leads_created,
        "updated": campaign.existing_leads_updated,
        "leads": [outcome],
    }


@router.get("", response_model=list[CampaignResponse])
async def get_campaigns(
    skip: int = Query(0),
    limit: int = Query(50),
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    del current_user
    result = await db.execute(
        select(Campaign).order_by(Campaign.created_at.desc()).offset(skip).limit(limit)
    )
    return [CampaignResponse.model_validate(c) for c in result.scalars().all()]


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    del current_user
    result = await db.execute(select(Project).order_by(Project.name.asc()))
    projects = []
    for project in result.scalars().all():
        options = []
        try:
            import json

            options = json.loads(project.bhk_options) if project.bhk_options else []
        except Exception:
            options = []
        projects.append(
            ProjectResponse(
                id=project.id,
                name=project.name,
                developer=project.developer,
                location=project.location,
                city=project.city,
                bhk_options=options,
                price_range_min=float(project.price_range_min) if project.price_range_min is not None else None,
                price_range_max=float(project.price_range_max) if project.price_range_max is not None else None,
                brochure_url=project.brochure_url,
                status=project.status,
                created_at=project.created_at,
            )
        )
    return projects


@router.patch("/{campaign_id}/project/{project_id}")
async def assign_campaign_project(
    campaign_id: str,
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Only admin/manager can assign projects")

    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    campaign.project_id = project_id

    leads = await list_campaign_leads(campaign_id, db)
    for lead in leads:
        ids = list(lead.project_ids or [])
        if project_id not in ids:
            ids.append(project_id)
            lead.project_ids = ids

    await db.commit()
    return {"status": "ok", "campaign_id": campaign_id, "project_id": project_id}


@router.delete("/{campaign_id}/project")
async def remove_campaign_project(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Only admin/manager can remove projects")

    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    if not campaign.project_id:
        return {"status": "ok", "campaign_id": campaign_id, "project_id": None}

    removed_project_id = campaign.project_id
    campaign.project_id = None

    leads = await list_campaign_leads(campaign_id, db)
    for lead in leads:
        ids = list(lead.project_ids or [])
        if removed_project_id in ids:
            ids = [pid for pid in ids if pid != removed_project_id]
            lead.project_ids = ids or None

    await db.commit()
    return {"status": "ok", "campaign_id": campaign_id, "project_id": None}


# ─── CAMPAIGN ANALYTICS DASHBOARD ENDPOINTS ─────────────────────────────────

@router.get("/{campaign_id}/analytics", response_model=CampaignAnalyticsResponse)
async def get_campaign_analytics(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Get full analytics data for the campaign dashboard."""
    del current_user
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    from app.services.campaign_analytics_service import compute_campaign_analytics
    analytics = await compute_campaign_analytics(campaign_id, db)
    return CampaignAnalyticsResponse(**analytics)


@router.get("/{campaign_id}/leads-detail", response_model=list[CampaignLeadDetailResponse])
async def get_campaign_leads_detail(
    campaign_id: str,
    tier: Optional[str] = Query(None, description="Filter by priority tier (P1-P7)"),
    search: Optional[str] = Query(None, description="Search by name or phone"),
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Get detailed lead list for campaign dashboard with filters."""
    del current_user
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    from app.services.campaign_analytics_service import get_campaign_leads_detail
    details = await get_campaign_leads_detail(campaign_id, db, tier_filter=tier, search=search)
    return [CampaignLeadDetailResponse(**d) for d in details]


@router.get("/{campaign_id}/agent-assignments", response_model=list[AgentAssignment])
async def get_agent_assignments(
    campaign_id: str,
    selected_agent_ids: list[str] = Query(default_factory=list),
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Get auto-computed agent assignments for campaign leads."""
    del current_user
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    from app.services.campaign_analytics_service import compute_agent_assignments
    assignments = await compute_agent_assignments(campaign_id, db, selected_agent_ids=selected_agent_ids)
    return [AgentAssignment(**a) for a in assignments]


@router.post("/{campaign_id}/assign-agents")
async def execute_agent_assignment(
    campaign_id: str,
    payload: Optional[AgentAssignmentRequest] = None,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Execute auto-assignment — actually assigns leads to agents in DB."""
    if current_user.role not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Only admin/manager can assign agents")

    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    from app.services.campaign_analytics_service import execute_agent_assignments
    selected_ids = payload.selected_agent_ids if payload else None
    result = await execute_agent_assignments(campaign_id, db, selected_agent_ids=selected_ids)
    await db.commit()
    return result


@router.post("/{campaign_id}/analyze-ai")
async def trigger_ai_analysis(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Trigger AI analysis on all connected calls in the campaign."""
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    from app.services.campaign_ai_analyzer import batch_analyze_campaign
    result = await batch_analyze_campaign(campaign_id, db)
    return result


@router.get("/{campaign_id}", response_model=CampaignDetailResponse)
async def get_campaign_detail(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    del current_user
    result = await db.execute(
        select(Campaign)
        .options(selectinload(Campaign.project))
        .where(Campaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    leads = await list_campaign_leads(campaign_id, db)

    return CampaignDetailResponse(
        **CampaignResponse.model_validate(campaign).model_dump(),
        project_name=campaign.project.name if campaign.project else None,
        leads=[LeadResponse.model_validate(lead) for lead in leads],
    )


@router.delete("/{campaign_id}")
async def delete_campaign(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Only admin/manager can remove campaigns")

    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    campaign_name = campaign.name

    lead_result = await db.execute(select(Lead).where(Lead.campaign_id == campaign_id))
    linked_leads = lead_result.scalars().all()
    for lead in linked_leads:
        lead.campaign_id = None

    activity_result = await db.execute(
        select(Activity)
        .where(Activity.campaign_id == campaign_id)
        .where(Activity.type == "campaign_call")
    )
    campaign_activities = activity_result.scalars().all()
    for activity in campaign_activities:
        await db.delete(activity)

    await db.delete(campaign)
    await db.commit()

    return {
        "status": "ok",
        "campaign_id": campaign_id,
        "campaign_name": campaign_name,
        "leads_detached": len(linked_leads),
        "activities_deleted": len(campaign_activities),
    }
