from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile

logger = logging.getLogger(__name__)
from datetime import datetime

from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import get_current_user, get_db
from app.models.agent import Agent
from app.models.campaign import Campaign, Project
from app.models.followup import FollowUp
from app.models.lead import Lead
from app.models.models import Activity, SiteVisit, Task
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
# Batch size for campaign ingestion (reduces commit frequency)
BATCH_SIZE = getattr(settings, "CAMPAIGN_BATCH_SIZE", 200)


def _ensure_campaign_access(current_user: Agent) -> None:
    if current_user.role not in {"admin", "manager"}:
        raise HTTPException(status_code=403, detail="Only admin/manager can access campaign management")


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
    logger.info("=" * 50)
    logger.info(f"UPLOAD REQUEST RECEIVED")
    logger.info(f"  - User: {current_user.id} ({current_user.role})")
    logger.info(f"  - File: {file.filename} (content-type: {file.content_type})")
    logger.info(f"  - Campaign name: {campaign_name}")
    logger.info(f"  - Agent name: {agent_name}")
    logger.info("=" * 50)

    try:
        _ensure_campaign_access(current_user)
        logger.info("Auth check passed")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Auth check failed")
        raise HTTPException(status_code=500, detail=f"Authentication failed: {str(e)}")

    if not campaign_name.strip():
        logger.error("campaign_name is empty")
        raise HTTPException(status_code=400, detail="campaign_name is required")

    try:
        content = await file.read()
        logger.info(f"File content read: {len(content)} bytes")
    except Exception as e:
        logger.exception("Failed to read file content")
        raise HTTPException(status_code=500, detail=f"Failed to read file: {str(e)}")

    if not content or len(content) == 0:
        logger.error("File content is empty")
        raise HTTPException(status_code=400, detail="File is empty")

    try:
        logger.info(f"Parsing file: {file.filename}")
        rows, fmt = parse_campaign_file(content, file.filename or "")
        logger.info(f"SUCCESS: Parsed {len(rows)} rows, format: {fmt}")
    except ValueError as e:
        logger.exception("ValueError during parsing")
        raise HTTPException(status_code=400, detail=str(e))
    except ImportError as e:
        logger.exception("ImportError during parsing")
        raise HTTPException(status_code=501, detail=f"Missing dependency: {str(e)}. Please install openpyxl for Excel support.")
    except Exception as e:
        logger.exception("Upload parsing failed - this is the error")
        raise HTTPException(status_code=500, detail=f"Failed to parse file: {str(e)}")

    logger.info(f"Returning preview with {len(rows)} rows")
    return CampaignUploadPreview(rows=[CampaignRow(**r) for r in rows], total=len(rows), format_detected=fmt)


@router.post("/ingest", response_model=CampaignIngestResult)
async def ingest_campaign(
    payload: CampaignIngestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    _ensure_campaign_access(current_user)

    if not payload.campaign_name.strip():
        raise HTTPException(status_code=400, detail="campaign_name is required")

    if not payload.rows:
        raise HTTPException(status_code=400, detail="No rows provided for ingestion")

    project_id = await auto_link_project(payload.campaign_name, db)

    campaign = Campaign(
        name=payload.campaign_name.strip(),
        project_id=project_id,
        agent_name=payload.agent_name or "Niharika",
    )
    db.add(campaign)
    await db.flush()

    seen_phones: set[str] = set()
    hot = warm = cold = created = updated = failed_rows = skipped_duplicates = 0
    tier_dist: dict[str, int] = {}
    processed: list[CampaignLeadSummary] = []
    first_row_error: str | None = None

    # Preload existing leads by phone to avoid per-row DB lookups
    all_phones = set()
    for r in payload.rows:
        ph = normalise_phone(r.model_dump().get("phone_number", ""))
        if ph:
            all_phones.add(ph)

    phone_to_existing: dict[str, object] = {}
    if all_phones:
        try:
            result = await db.execute(
                select(Lead, Contact).join(Contact, Lead.contact_id == Contact.id).where(Contact.phone.in_(list(all_phones)))
            )
            for lead, contact in result.all():
                phone_to_existing[contact.phone] = lead
        except Exception:
            # fallback: continue without preload
            logger.exception("Preloading existing leads by phone failed")

    # Process rows in batches to reduce transaction overhead
    rows = payload.rows
    total_rows = len(rows)
    for start in range(0, total_rows, BATCH_SIZE):
        batch = rows[start : start + BATCH_SIZE]

        # Process all rows in-memory and add to session; commit once per batch
        for row in batch:
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
                existing = phone_to_existing.get(phone) if phone else None
                outcome = await process_campaign_row(row_data, campaign, db, existing=existing)

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

                tier = outcome.get("priority_tier", "P7")
                tier_dist[tier] = tier_dist.get(tier, 0) + 1

                processed.append(CampaignLeadSummary(**outcome))
            except Exception as exc:
                logger.exception("Campaign ingest row failed (batch)")
                if first_row_error is None:
                    first_row_error = str(exc)
                failed_rows += 1
                # continue; do not rollback here — rollback will be done at batch level if needed

        # Try committing the batch once
        try:
            await db.commit()
        except Exception:
            logger.exception("Batch commit failed, falling back to per-row commit")
            # Batch-level commit failed. Roll back and process rows individually to isolate bad rows.
            try:
                await db.rollback()
            except Exception:
                logger.exception("Rollback after failed batch commit failed")

            for row in batch:
                row_data = row.model_dump()
                if not row_data.get("name") and not row_data.get("phone_number"):
                    continue

                phone = normalise_phone(row_data.get("phone_number", ""))
                if phone and phone in seen_phones:
                    # already accounted for
                    continue

                try:
                    existing = phone_to_existing.get(phone) if phone else None
                    outcome = await process_campaign_row(row_data, campaign, db, existing=existing)
                    # commit per-row to isolate issues
                    await db.commit()

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

                    tier = outcome.get("priority_tier", "P7")
                    tier_dist[tier] = tier_dist.get(tier, 0) + 1

                    processed.append(CampaignLeadSummary(**outcome))
                except Exception as exc2:
                    logger.exception("Per-row fallback failed")
                    try:
                        await db.rollback()
                    except Exception:
                        logger.exception("Rollback after per-row fallback failed")
                    if first_row_error is None:
                        first_row_error = str(exc2)
                    failed_rows += 1
                    continue

    total_valid = hot + warm + cold
    if total_valid == 0:
        await db.rollback()
        detail = "No valid rows found in file. Check column headers match expected format."
        if first_row_error:
            detail = f"{detail} First row error: {first_row_error}"
        raise HTTPException(status_code=400, detail=detail)

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
    _ensure_campaign_access(current_user)
    result = await db.execute(
        select(Campaign).order_by(Campaign.created_at.desc()).offset(skip).limit(limit)
    )
    return [CampaignResponse.model_validate(c) for c in result.scalars().all()]


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    _ensure_campaign_access(current_user)
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
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admin can remove projects")

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
    _ensure_campaign_access(current_user)
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
    _ensure_campaign_access(current_user)
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
    _ensure_campaign_access(current_user)
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


@router.post("/{campaign_id}/auto-assign")
async def auto_assign_campaign_leads(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Auto-assign all unassigned leads in a campaign to available agents."""
    if current_user.role not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Only admin/manager can auto-assign leads")

    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    from sqlalchemy import func
    from app.models.lead import Lead
    from app.services.assignment_service import get_available_agents

    # Get all unassigned leads in this campaign
    result = await db.execute(
        select(Lead).where(
            Lead.campaign_id == campaign_id,
            or_(
                Lead.assigned_to.is_(None),
                Lead.assigned_to == ""
            )
        )
    )
    unassigned_leads = result.scalars().all()

    if not unassigned_leads:
        return {"status": "ok", "assigned": 0, "message": "No unassigned leads found"}

    agents = await get_available_agents(db)
    if not agents:
        raise HTTPException(status_code=400, detail="No available agents to assign leads to")

    # Seed load-balancing counts from live CRM leads per agent
    active_counts: dict[str, int] = {}
    for agent in agents:
        count_result = await db.execute(
            select(func.count(Lead.id)).where(
                Lead.assigned_to == agent.id,
                Lead.stage.notin_(["won", "lost", "nurture"]),
            )
        )
        active_counts[agent.id] = count_result.scalar() or 0

    assigned_count = 0
    by_tier = {}
    assignments_by_agent = {}

    for lead in unassigned_leads:
        # Load balance across agents
        assignee = min(agents, key=lambda a: active_counts.get(a.id, 0))
        lead.assigned_to = assignee.id
        lead.updated_at = datetime.utcnow()
        active_counts[assignee.id] = active_counts.get(assignee.id, 0) + 1
        assigned_count += 1
        tier = lead.lead_score or "cold"
        by_tier[tier] = by_tier.get(tier, 0) + 1
        assignments_by_agent[assignee.id] = assignments_by_agent.get(assignee.id, 0) + 1

    await db.commit()

    # Send notifications
    for agent_id, count in assignments_by_agent.items():
        agent = await db.get(Agent, agent_id)
        if agent:
            from app.services.lead_service import create_notification
            await create_notification(
                db,
                agent.id,
                title=f"{count} leads auto-assigned — {campaign.name}",
                body=f"{count} lead(s) auto-assigned to you in campaign {campaign.name}.",
                notif_type="new_lead",
                link="/campaigns",
            )

    await db.commit()

    return {
        "status": "ok",
        "assigned": assigned_count,
        "by_tier": by_tier,
        "campaign_id": campaign_id,
        "campaign_name": campaign.name,
    }


@router.post("/{campaign_id}/analyze-ai")
async def trigger_ai_analysis(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Trigger AI analysis on all connected calls in the campaign."""
    _ensure_campaign_access(current_user)
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
    _ensure_campaign_access(current_user)
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
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admin can remove campaigns")

    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    campaign_name = campaign.name

    lead_count_result = await db.execute(
        select(func.count(Lead.id)).where(Lead.campaign_id == campaign_id)
    )
    leads_deleted = int(lead_count_result.scalar() or 0)

    activity_count_result = await db.execute(
        select(func.count(Activity.id)).where(Activity.campaign_id == campaign_id)
    )
    activities_deleted = int(activity_count_result.scalar() or 0)

    try:
        lead_ids_subquery = select(Lead.id).where(Lead.campaign_id == campaign_id)

        # Remove lead-owned records before deleting leads when DB constraints are non-cascading.
        await db.execute(delete(FollowUp).where(FollowUp.lead_id.in_(lead_ids_subquery)))
        await db.execute(delete(SiteVisit).where(SiteVisit.lead_id.in_(lead_ids_subquery)))
        await db.execute(delete(Task).where(Task.lead_id.in_(lead_ids_subquery)))
        await db.execute(delete(Activity).where(Activity.lead_id.in_(lead_ids_subquery)))

        # Remove campaign-level activities, then leads, then campaign.
        await db.execute(delete(Activity).where(Activity.campaign_id == campaign_id))
        await db.execute(delete(Lead).where(Lead.campaign_id == campaign_id))
        await db.delete(campaign)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        logger.exception("Campaign delete failed due to referential integrity")
        raise HTTPException(
            status_code=409,
            detail="Campaign cannot be deleted because dependent records are still protected by database constraints. Apply latest migrations to enable cascade deletion.",
        ) from exc

    return {
        "status": "ok",
        "campaign_id": campaign_id,
        "campaign_name": campaign_name,
        "leads_deleted": leads_deleted,
        "activities_deleted": activities_deleted,
    }
