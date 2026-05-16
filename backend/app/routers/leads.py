from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, asc, desc, delete
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pydantic import BaseModel
from app.core.dependencies import get_db, get_current_user
from app.core.config import settings
from app.models.agent import Agent
from app.models.contact import Contact
from app.models.lead import Lead
from app.models.models import Activity, Task, SiteVisit
from app.models.followup import FollowUp
from pydantic import Field
from app.schemas.schemas import (
    InboundLead, InboundLeadResponse, LeadCreate, LeadUpdate,
    LeadResponse, StageUpdate, NoteCreate, CallLogCreate, ActivityResponse,
    MasterProfileUpdate,
)
from app.services.lead_service import process_inbound_lead, change_lead_stage, log_activity, create_auto_task, create_notification
from app.services.services import find_matching_properties, send_whatsapp
from app.services.memory_service import build_memory_brief
from app.services.email_service import send_email
from app.schemas.schemas import WhatsAppSend, PropertyResponse, LeadNotifyRequest

router = APIRouter()


def _normalize_to_utc_naive_from_local(dt_value: datetime) -> datetime:
    tz = ZoneInfo(settings.NOTIFICATION_TIMEZONE)
    aware = dt_value.astimezone(tz) if dt_value.tzinfo else dt_value.replace(tzinfo=tz)
    return aware.astimezone(timezone.utc).replace(tzinfo=None)


class LeadPageResponse(BaseModel):
    items: list[LeadResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class LeadBulkDeleteRequest(BaseModel):
    lead_ids: list[str] = Field(default_factory=list)


async def _delete_leads_and_dependencies(db: AsyncSession, lead_ids: list[str]) -> int:
    if not lead_ids:
        return 0

    await db.execute(delete(Activity).where(Activity.lead_id.in_(lead_ids)))
    await db.execute(delete(Task).where(Task.lead_id.in_(lead_ids)))
    await db.execute(delete(FollowUp).where(FollowUp.lead_id.in_(lead_ids)))
    await db.execute(delete(SiteVisit).where(SiteVisit.lead_id.in_(lead_ids)))
    deleted_leads_result = await db.execute(delete(Lead).where(Lead.id.in_(lead_ids)))
    return int(deleted_leads_result.rowcount or 0)


def _ensure_lead_scope(current_user: Agent, lead: Lead) -> None:
    """
    Agents and call_agents can only access leads assigned to them.
    Admin/manager can access all leads.
    """
    if current_user.role in {"agent", "call_agent"} and lead.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to access this lead")


@router.post("/inbound", response_model=InboundLeadResponse)
async def inbound_lead(
    data: InboundLead,
    db: AsyncSession = Depends(get_db),
    x_priya_secret: Optional[str] = Header(None),
):
    """
    PUBLIC endpoint — receives leads from all external sources.
    Priya AI, website form, n8n workflows all POST here.
    """
    # Optional secret header verification for Priya
    if x_priya_secret and x_priya_secret != settings.PRIYA_WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid webhook secret")

    result = await process_inbound_lead(db, data)
    return InboundLeadResponse(**result)


@router.get("", response_model=list[LeadResponse])
async def list_leads(
    stage: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    lead_score: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    campaign_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = Query(0),
    limit: int = Query(50),
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    query = (
        select(Lead)
        .options(selectinload(Lead.contact), selectinload(Lead.assigned_agent))
        .order_by(Lead.updated_at.desc())
    )

    if stage:
        query = query.where(Lead.stage == stage)
    if source:
        query = query.where(Lead.source == source)
    if lead_score:
        query = query.where(Lead.lead_score == lead_score)
    if assigned_to:
        query = query.where(Lead.assigned_to == assigned_to)
    if campaign_id:
        query = query.where(Lead.campaign_id == campaign_id)

    # Agents only see their own leads
    if current_user.role in ["agent", "call_agent"]:
        query = query.where(Lead.assigned_to == current_user.id)

    if search:
        query = query.join(Contact).where(
            or_(Contact.name.ilike(f"%{search}%"), Contact.phone.ilike(f"%{search}%"))
        )

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return [LeadResponse.model_validate(l) for l in result.scalars().all()]


@router.get("/paginated", response_model=LeadPageResponse)
async def list_leads_paginated(
    stage: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    lead_score: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    campaign_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    filters = []

    if stage:
        filters.append(Lead.stage == stage)
    if source:
        filters.append(Lead.source == source)
    if lead_score:
        filters.append(Lead.lead_score == lead_score)
    if assigned_to:
        filters.append(Lead.assigned_to == assigned_to)
    if campaign_id:
        filters.append(Lead.campaign_id == campaign_id)

    if current_user.role in ["agent", "call_agent"]:
        filters.append(Lead.assigned_to == current_user.id)

    base_query = select(Lead)
    count_query = select(func.count(Lead.id))

    if search:
        search_expr = or_(Contact.name.ilike(f"%{search}%"), Contact.phone.ilike(f"%{search}%"))
        base_query = base_query.join(Contact).where(search_expr)
        count_query = count_query.select_from(Lead).join(Contact).where(search_expr)

    if filters:
        base_query = base_query.where(*filters)
        count_query = count_query.where(*filters)

    total = (await db.execute(count_query)).scalar() or 0

    data_query = (
        base_query
        .options(selectinload(Lead.contact), selectinload(Lead.assigned_agent))
        .order_by(Lead.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    result = await db.execute(data_query)
    items = [LeadResponse.model_validate(l) for l in result.scalars().all()]

    return LeadPageResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total else 1,
    )


@router.get("/board", response_model=dict)
async def kanban_board(
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Returns leads grouped by stage for the Kanban board."""
    stages = ["new", "contacted", "site_visit_scheduled", "site_visit_done", "negotiation", "won", "lost", "nurture"]
    query = (
        select(Lead)
        .options(selectinload(Lead.contact), selectinload(Lead.assigned_agent))
        .where(Lead.stage.in_(stages))
    )
    if current_user.role in ["agent", "call_agent"]:
        query = query.where(Lead.assigned_to == current_user.id)

    result = await db.execute(query)
    leads = result.scalars().all()

    board = {stage: [] for stage in stages}
    for lead in leads:
        board[lead.stage].append(LeadResponse.model_validate(lead))

    return board


@router.post("", response_model=LeadResponse)
async def create_lead(
    data: LeadCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role == "call_agent":
        raise HTTPException(status_code=403, detail="call_agent cannot create leads")

    # Get or create contact
    if data.contact_id:
        contact = await db.get(Contact, data.contact_id)
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
    elif data.phone:
        # Check duplicate
        result = await db.execute(select(Contact).where(Contact.phone == data.phone))
        contact = result.scalar_one_or_none()
        if not contact:
            contact = Contact(name=data.name or "Unknown", phone=data.phone, email=data.email, source=data.source)
            db.add(contact)
            await db.flush()
    else:
        raise HTTPException(status_code=400, detail="Either contact_id or phone is required")

    assignee_id = data.assigned_to or current_user.id
    if current_user.role == "agent" and assignee_id != current_user.id:
        raise HTTPException(status_code=403, detail="Agent can only assign leads to self")

    lead = Lead(
        contact_id=contact.id,
        source=data.source,
        stage="new",
        lead_score=data.lead_score,
        budget_min=data.budget_min,
        budget_max=data.budget_max,
        property_type_interest=data.property_type_interest,
        location_preference=data.location_preference,
        timeline=data.timeline,
        assigned_to=assignee_id,
        priority=data.priority,
        stage_changed_at=datetime.utcnow(),
    )
    db.add(lead)
    await db.flush()

    await log_activity(db, lead.id, contact.id, "lead_created", f"Lead created manually by {current_user.name}", performed_by=current_user.id)

    if lead.assigned_to:
        await create_notification(
            db,
            lead.assigned_to,
            title=f"New lead assigned: {contact.name}",
            body=f"A new lead was created from {data.source} and assigned to you.",
            notif_type="new_lead",
            link=f"/leads/{lead.id}",
        )

    try:
        from app.services.followup_engine import schedule_followup_sequence
        await schedule_followup_sequence(
            db,
            lead.id,
            contact.id,
            trigger="new_lead",
            agent_id=lead.assigned_to,
        )
    except Exception:
        pass

    lead.priya_memory_brief = await build_memory_brief(db, lead, contact)

    await db.commit()
    await db.refresh(lead)

    result = await db.execute(
        select(Lead).options(selectinload(Lead.contact), selectinload(Lead.assigned_agent)).where(Lead.id == lead.id)
    )
    return LeadResponse.model_validate(result.scalar_one())


@router.get("/{lead_id}", response_model=LeadResponse)
async def get_lead(lead_id: str, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    result = await db.execute(
        select(Lead).options(selectinload(Lead.contact), selectinload(Lead.assigned_agent)).where(Lead.id == lead_id)
    )
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    _ensure_lead_scope(current_user, lead)
    return LeadResponse.model_validate(lead)


@router.patch("/{lead_id}", response_model=LeadResponse)
async def update_lead(
    lead_id: str, data: LeadUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    _ensure_lead_scope(current_user, lead)

    if current_user.role == "call_agent":
        update_fields = set(data.model_dump(exclude_unset=True).keys())
        forbidden_fields = {"assigned_to", "priority", "lead_score"}
        if update_fields & forbidden_fields:
            raise HTTPException(status_code=403, detail="call_agent cannot edit assignment or priority fields")

    contact = await db.get(Contact, lead.contact_id)

    old_assigned_to = lead.assigned_to

    for field, value in data.model_dump(exclude_unset=True, exclude={"personal_notes"}).items():
        setattr(lead, field, value)
    lead.updated_at = datetime.utcnow()

    # Cascade assignment to pending tasks if lead assignment changed
    if "assigned_to" in data.model_dump(exclude_unset=True) and lead.assigned_to != old_assigned_to:
        from sqlalchemy import update
        from app.models.models import Task
        await db.execute(
            update(Task)
            .where(Task.lead_id == lead.id)
            .where(Task.status.in_(["pending", "overdue"]))
            .values(assigned_to=lead.assigned_to)
        )

    # personal_notes goes on the contact
    if data.personal_notes:
        if contact:
            contact.personal_notes = data.personal_notes
            lead.priya_memory_brief = await build_memory_brief(db, lead, contact)

    if lead.assigned_to and lead.assigned_to != old_assigned_to:
        await create_notification(
            db,
            lead.assigned_to,
            title="Lead assigned",
            body=f"{(contact.name if contact else 'A lead')} was assigned to you by {current_user.name}.",
            notif_type="new_lead",
            link=f"/leads/{lead.id}",
        )
    elif lead.assigned_to:
        await create_notification(
            db,
            lead.assigned_to,
            title="Lead info updated",
            body=f"{(contact.name if contact else 'Lead')} details were updated by {current_user.name}.",
            notif_type="reminder",
            link=f"/leads/{lead.id}",
        )

    await db.commit()
    result = await db.execute(
        select(Lead).options(selectinload(Lead.contact), selectinload(Lead.assigned_agent)).where(Lead.id == lead_id)
    )
    return LeadResponse.model_validate(result.scalar_one())


@router.patch("/{lead_id}/stage", response_model=LeadResponse)
async def update_stage(
    lead_id: str, data: StageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role == "call_agent":
        raise HTTPException(status_code=403, detail="call_agent cannot change lead stage")

    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    _ensure_lead_scope(current_user, lead)
    if data.stage == "lost" and not data.lost_reason:
        raise HTTPException(status_code=400, detail="lost_reason is required when marking a lead as lost")

    lead = await change_lead_stage(db, lead, data.stage, current_user.id, data.lost_reason)

    if lead.assigned_to:
        await create_notification(
            db,
            lead.assigned_to,
            title=f"Lead stage updated to {data.stage}",
            body=f"{current_user.name} moved this lead to {data.stage}.",
            notif_type="stage_change",
            link=f"/leads/{lead.id}",
        )

    await db.commit()

    result = await db.execute(
        select(Lead).options(selectinload(Lead.contact), selectinload(Lead.assigned_agent)).where(Lead.id == lead_id)
    )
    return LeadResponse.model_validate(result.scalar_one())


@router.get("/{lead_id}/timeline", response_model=list[ActivityResponse])
async def get_timeline(lead_id: str, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    _ensure_lead_scope(current_user, lead)

    result = await db.execute(
        select(Activity)
        .options(selectinload(Activity.performed_by_agent))
        .where(Activity.lead_id == lead_id)
        .order_by(Activity.performed_at.desc())
    )
    return [ActivityResponse.model_validate(a) for a in result.scalars().all()]


@router.post("/{lead_id}/note", response_model=ActivityResponse)
async def add_note(
    lead_id: str, data: NoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    _ensure_lead_scope(current_user, lead)

    activity = await log_activity(
        db, lead_id, lead.contact_id,
        activity_type="note",
        title="Note added",
        description=data.description,
        performed_by=current_user.id,
    )
    contact = await db.get(Contact, lead.contact_id)
    lead.priya_memory_brief = await build_memory_brief(db, lead, contact)

    if lead.assigned_to:
        await create_notification(
            db,
            lead.assigned_to,
            title="New note added",
            body=f"{current_user.name} added a note on this lead.",
            notif_type="reminder",
            link=f"/leads/{lead.id}",
        )

    await db.commit()
    await db.refresh(activity)
    return ActivityResponse.model_validate(activity)


@router.post("/{lead_id}/call-log", response_model=ActivityResponse)
async def log_call(
    lead_id: str, data: CallLogCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    _ensure_lead_scope(current_user, lead)

    lead.last_contacted_at = datetime.utcnow()
    lead.call_count += 1
    lead.updated_at = datetime.utcnow()

    activity = await log_activity(
        db, lead_id, lead.contact_id,
        activity_type="call",
        title=f"Call logged — {data.outcome}",
        description=data.description,
        outcome=data.outcome,
        performed_by=current_user.id,
        meta={"duration_seconds": data.duration_seconds},
    )
    contact = await db.get(Contact, lead.contact_id)
    lead.priya_memory_brief = await build_memory_brief(db, lead, contact)

    if lead.assigned_to:
        await create_notification(
            db,
            lead.assigned_to,
            title="Call log updated",
            body=f"{current_user.name} logged a call outcome: {data.outcome}.",
            notif_type="reminder",
            link=f"/leads/{lead.id}",
        )

    await db.commit()
    await db.refresh(activity)
    return ActivityResponse.model_validate(activity)


@router.post("/{lead_id}/whatsapp")
async def send_whatsapp_message(
    lead_id: str, data: WhatsAppSend,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    _ensure_lead_scope(current_user, lead)
    contact = await db.get(Contact, lead.contact_id)

    result = await send_whatsapp(
        to_phone=contact.phone,
        template=data.template,
        variables={"name": contact.name, "agent_name": current_user.name, "custom_message": data.custom_message or ""},
        db=db,
        lead_id=lead_id,
        contact_id=lead.contact_id,
        agent_id=current_user.id,
    )
    await db.commit()
    return result


@router.post("/{lead_id}/notify")
async def notify_lead_contact(
    lead_id: str,
    data: LeadNotifyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    _ensure_lead_scope(current_user, lead)
    contact = await db.get(Contact, lead.contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Lead contact not found")

    allowed_channels = {"whatsapp", "email"}
    channels = [channel.lower() for channel in data.channels if channel]
    if not channels:
        raise HTTPException(status_code=400, detail="At least one channel is required")
    if any(channel not in allowed_channels for channel in channels):
        raise HTTPException(status_code=400, detail="Only whatsapp and email channels are supported")

    if data.scheduled_at:
        scheduled_utc = _normalize_to_utc_naive_from_local(data.scheduled_at)
        if scheduled_utc <= datetime.utcnow():
            raise HTTPException(status_code=400, detail="scheduled_at must be in the future")

        from app.models.followup import FollowUp

        for channel in channels:
            db.add(
                FollowUp(
                    lead_id=lead.id,
                    contact_id=contact.id,
                    agent_id=current_user.id,
                    channel=channel,
                    template="custom",
                    message_body=data.message,
                    subject=data.subject,
                    scheduled_at=scheduled_utc,
                    status="pending",
                    triggered_by="manual",
                )
            )

        await db.commit()
        return {
            "status": "scheduled",
            "channels": channels,
            "scheduled_at_utc": scheduled_utc.isoformat(),
            "count": len(channels),
        }

    results: dict[str, dict] = {}

    for channel in channels:
        if channel == "whatsapp":
            results[channel] = await send_whatsapp(
                to_phone=contact.phone,
                template="custom",
                variables={
                    "name": contact.name,
                    "agent_name": current_user.name,
                    "custom_message": data.message,
                },
                db=db,
                lead_id=lead.id,
                contact_id=contact.id,
                agent_id=current_user.id,
            )
            continue

        if channel == "email":
            if not contact.email:
                results[channel] = {"sent": False, "error": "Lead contact does not have an email"}
                continue

            results[channel] = await send_email(
                to_email=contact.email,
                template="custom",
                variables={
                    "subject": data.subject or f"Update from {current_user.name}",
                    "body": data.message,
                    "name": contact.name,
                    "agent_name": current_user.name,
                },
                db=db,
                lead_id=lead.id,
                contact_id=contact.id,
                agent_id=current_user.id,
            )

    await db.commit()
    return {
        "status": "sent",
        "results": results,
    }


@router.get("/{lead_id}/property-matches", response_model=list[PropertyResponse])
async def property_matches(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    _ensure_lead_scope(current_user, lead)

    props = await find_matching_properties(
        db,
        budget_min=float(lead.budget_min) if lead.budget_min else None,
        budget_max=float(lead.budget_max) if lead.budget_max else None,
        property_type=lead.property_type_interest,
        location=lead.location_preference,
    )
    return [PropertyResponse.model_validate(p) for p in props]

@router.delete("/{lead_id}")
async def delete_lead(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admin can delete leads")
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    await _delete_leads_and_dependencies(db, [lead_id])
    await db.commit()
    return {"status": "deleted"}


@router.post("/bulk-delete")
async def bulk_delete_leads(
    data: LeadBulkDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admin can bulk delete leads")

    lead_ids = [lead_id.strip() for lead_id in data.lead_ids if isinstance(lead_id, str) and lead_id.strip()]
    lead_ids = list(dict.fromkeys(lead_ids))
    if not lead_ids:
        raise HTTPException(status_code=400, detail="lead_ids cannot be empty")

    deleted_count = await _delete_leads_and_dependencies(db, lead_ids)
    await db.commit()

    return {
        "status": "deleted",
        "requested": len(lead_ids),
        "deleted": deleted_count,
    }


# ─── MASTER PROFILE (Feature 3) ─────────────────────────────────────────────

@router.get("/{lead_id}/master-profile")
async def get_master_profile(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Feature 3: Get full master profile for a lead."""
    result = await db.execute(
        select(Lead)
        .options(selectinload(Lead.contact), selectinload(Lead.assigned_agent))
        .where(Lead.id == lead_id)
    )
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    _ensure_lead_scope(current_user, lead)

    contact = lead.contact
    profile = lead.master_profile or {}

    # Try to populate AI fields from campaign_leads if available
    from app.models.campaign_dashboard import CampaignLead as CDLead
    ai_data = {}
    if contact and contact.phone:
        phone_digits = contact.phone.replace("+", "").replace(" ", "")[-10:]
        try:
            phone_int = int(phone_digits) if phone_digits.isdigit() else None
        except (ValueError, TypeError):
            phone_int = None
        if phone_int:
            from sqlalchemy import cast, String
            cd_result = await db.execute(
                select(CDLead)
                .where(cast(CDLead.phone_number, String) == str(phone_int))
                .order_by(CDLead.updated_at.desc())
                .limit(1)
            )
            cd_lead = cd_result.scalar_one_or_none()
            if cd_lead:
                ai_data = {
                    "config_preference": cd_lead.config_interest,
                    "budget_range": cd_lead.budget_signal,
                    "site_visit_intent": "Yes" if cd_lead.site_visit_committed else ("Maybe" if cd_lead.site_visit_timeframe else "No"),
                    "primary_language": cd_lead.language_preference,
                    "objection_type": cd_lead.objection_type,
                    "intent_level": cd_lead.intent_level,
                    "ai_summary": cd_lead.enriched_summary,
                    "key_quote": cd_lead.key_quote,
                }

    # Compute stats
    task_result = await db.execute(select(Task).where(Task.lead_id == lead_id))
    all_tasks = task_result.scalars().all()
    total_tasks = len(all_tasks)
    done_tasks = sum(1 for t in all_tasks if t.status == "done")
    completion_rate = (done_tasks / total_tasks * 100) if total_tasks > 0 else 0.0

    activities_result = await db.execute(
        select(Activity)
        .where(Activity.lead_id == lead_id)
        .order_by(Activity.performed_at.asc())
    )
    all_activities = activities_result.scalars().all()
    first_contact = all_activities[0].performed_at.isoformat() if all_activities else None
    last_contact = all_activities[-1].performed_at.isoformat() if all_activities else None

    days_in_pipeline = (datetime.utcnow() - lead.created_at).days if lead.created_at else 0

    return {
        # AI fields
        **ai_data,
        # Manual fields from stored profile
        "full_name": profile.get("full_name", contact.name if contact else None),
        "email": profile.get("email", contact.email if contact else None),
        "alternate_phone": profile.get("alternate_phone"),
        "city": profile.get("city"),
        "locality": profile.get("locality"),
        "occupation": profile.get("occupation"),
        "occupation_other": profile.get("occupation_other"),
        "family_size": profile.get("family_size"),
        "current_living_situation": profile.get("current_living_situation"),
        "investment_purpose": profile.get("investment_purpose"),
        "source": profile.get("source", lead.source),
        "agent_notes": profile.get("agent_notes"),
        "priority_override": profile.get("priority_override"),
        "priority_override_reason": profile.get("priority_override_reason"),
        # Demographic fields (synced from task completion)
        "age_range": profile.get("age_range"),
        "income_range": profile.get("income_range"),
        "property_budget": profile.get("property_budget"),
        "preferred_location": profile.get("preferred_location"),
        "purchase_timeline": profile.get("purchase_timeline"),
        # Last call data (synced from task completion)
        "last_call_status": profile.get("last_call_status"),
        "last_call_interest": profile.get("last_call_interest"),
        "last_call_topics": profile.get("last_call_topics", []),
        # Computed
        "total_calls": lead.call_count,
        "first_contact_date": first_contact,
        "last_contact_date": last_contact,
        "days_in_pipeline": days_in_pipeline,
        "completion_rate": round(completion_rate, 1),
    }


@router.patch("/{lead_id}/master-profile")
async def update_master_profile(
    lead_id: str,
    data: MasterProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Feature 3: Update manual fields on the master profile."""
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    _ensure_lead_scope(current_user, lead)

    profile = lead.master_profile or {}
    incoming = data.model_dump(exclude_unset=True)

    if not incoming:
        return {"status": "ok", "profile": profile}

    allowed_fields = {
        "config_preference", "budget_range", "site_visit_intent", "primary_language",
        "objection_type", "intent_level", "ai_summary", "key_quote",
        "full_name", "email", "alternate_phone", "city", "locality",
        "occupation", "occupation_other", "family_size", "current_living_situation",
        "investment_purpose", "source", "agent_notes",
        "priority_override", "priority_override_reason",
        # Demographic fields
        "age_range", "income_range", "property_budget", "preferred_location",
        "purchase_timeline",
        # Last call data
        "last_call_status", "last_call_interest", "last_call_topics",
    }

    if "priority_override" in incoming or "priority_override_reason" in incoming:
        if current_user.role not in {"admin", "manager"}:
            raise HTTPException(status_code=403, detail="Only admin/manager can override priority")

        next_override = incoming.get("priority_override", profile.get("priority_override"))
        next_reason = incoming.get("priority_override_reason", profile.get("priority_override_reason"))
        if next_override and (not isinstance(next_reason, str) or len(next_reason.strip()) < 20):
            raise HTTPException(status_code=400, detail="priority_override_reason must be at least 20 characters")

    for key, value in incoming.items():
        if key in allowed_fields:
            profile[key] = value

    lead.master_profile = profile
    lead.updated_at = datetime.utcnow()

    # Sync full_name and email back to contact
    contact = await db.get(Contact, lead.contact_id)
    if contact:
        if "full_name" in incoming and incoming["full_name"]:
            contact.name = incoming["full_name"]
        if "email" in incoming and incoming["email"]:
            contact.email = incoming["email"]

    await db.commit()
    return {"status": "ok", "profile": profile}


# ─── LEAD REASSIGNMENT (Feature 7) ─────────────────────────────────────────

class LeadReassignRequest(BaseModel):
    agent_id: str
    reason: str = Field(min_length=20)


@router.post("/{lead_id}/reassign")
async def reassign_lead(
    lead_id: str,
    data: LeadReassignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Feature 7: Manually reassign a lead to another agent (admin/manager only)."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Admin/Manager only")

    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    assignee = await db.get(Agent, data.agent_id)
    if not assignee or not assignee.is_active:
        raise HTTPException(status_code=404, detail="Agent not found or inactive")

    old_assignee_id = lead.assigned_to
    old_assignee_name = None
    if old_assignee_id:
        old_assignee = await db.get(Agent, old_assignee_id)
        if old_assignee:
            old_assignee_name = old_assignee.name

    # Check if actually reassigning (different agent)
    if old_assignee_id == data.agent_id:
        return {"status": "ok", "message": "Lead already assigned to this agent"}

    lead.assigned_to = data.agent_id

    # Log activity
    contact = await db.get(Contact, lead.contact_id)
    activity = Activity(
        lead_id=lead.id,
        contact_id=lead.contact_id if contact else None,
        type="stage_change",
        title="Lead reassigned",
        description=f"Reassigned from {old_assignee_name or 'Unassigned'} to {assignee.name}. Reason: {data.reason}",
        performed_by=current_user.id,
        meta={
            "assignment_type": "manual_override",
            "previous_assignee": old_assignee_id,
            "new_assignee": data.agent_id,
            "reason": data.reason,
        }
    )
    db.add(activity)

    # Notify new assignee
    from app.services.lead_service import create_notification
    await create_notification(
        db,
        data.agent_id,
        title=f"Lead reassigned to you: {contact.name if contact else lead.id}",
        body=f"{current_user.name} reassigned this lead to you. Reason: {data.reason}",
        notif_type="new_lead",
        link=f"/leads/{lead.id}",
    )

    await db.commit()

    return {
        "status": "ok",
        "lead_id": lead.id,
        "previous_assignee": old_assignee_name,
        "new_assignee": assignee.name,
    }


# ─── CAMPAIGN LEAD ASSIGNMENT TABLE ─────────────────────────────────────────

class CampaignAssignmentTableResponse(BaseModel):
    total: int
    page: int
    limit: int
    total_pages: int
    leads: list[dict]


class CampaignBulkAssignPayload(BaseModel):
    lead_ids: list[str] = Field(min_length=1)
    agent_id: str
    reason: Optional[str] = None


@router.get("/campaign/{campaign_id}/assignment-table")
async def campaign_assignment_table(
    campaign_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    priority_tier: Optional[str] = Query(None),
    assigned: Optional[str] = Query(None),
    agent_name: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: Optional[str] = Query("asc"),
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Get assignment table for campaign leads (admin/manager only)."""
    if current_user.role not in {"admin", "manager"}:
        raise HTTPException(status_code=403, detail="Only admin or manager can access campaign assignment table")

    filters = [Lead.campaign_id == campaign_id]

    if priority_tier:
        filters.append(Lead.priority == priority_tier)
    if assigned == "assigned":
        filters.append(Lead.assigned_to.isnot(None))
    elif assigned == "unassigned":
        filters.append(or_(Lead.assigned_to.is_(None), Lead.assigned_to == ""))

    if search:
        like = f"%{search.strip()}%"
        contact_result = await db.execute(select(Contact.id).where(
            or_(Contact.name.ilike(like), Contact.phone.ilike(like))
        ))
        contact_ids = [r[0] for r in contact_result.all()]
        if contact_ids:
            filters.append(Lead.contact_id.in_(contact_ids))
        else:
            filters.append(Lead.id == "none")

    total = await db.scalar(select(func.count(Lead.id)).where(*filters))

    order_col = Lead.created_at
    if sort_by == "priority":
        order_col = Lead.priority
    elif sort_by == "lead_score":
        order_col = Lead.lead_score

    direction = desc if sort_dir == "desc" else asc

    rows = (
        await db.scalars(
            select(Lead)
            .options(selectinload(Lead.contact), selectinload(Lead.assigned_agent))
            .where(*filters)
            .order_by(direction(order_col))
            .offset((page - 1) * limit)
            .limit(limit)
        )
    ).all()

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": (total + limit - 1) // limit if total else 0,
        "leads": [
            {
                "id": lead.id,
                "name": lead.contact.name if lead.contact else "Unknown",
                "phone_number": lead.contact.phone if lead.contact else "N/A",
                "priority_tier": lead.priority,
                "lead_score": lead.lead_score,
                "assigned_agent": lead.assigned_agent.name if lead.assigned_agent else None,
                "intent_level": None,
                "dnd_flag": lead.dnd,
                "action_taken": lead.stage,
                "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
            }
            for lead in rows
        ],
    }


@router.post("/campaign/{campaign_id}/bulk-assign")
async def campaign_bulk_assign(
    campaign_id: str,
    payload: CampaignBulkAssignPayload,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Bulk-assign campaign leads to an agent (admin/manager only)."""
    if current_user.role not in {"admin", "manager"}:
        raise HTTPException(status_code=403, detail="Only admin or manager can assign campaign leads")

    agent = await db.get(Agent, payload.agent_id)
    if not agent or not agent.is_active:
        raise HTTPException(status_code=404, detail="Agent not found or inactive")

    result = await db.execute(
        select(Lead)
        .options(selectinload(Lead.contact), selectinload(Lead.assigned_agent))
        .where(
            Lead.campaign_id == campaign_id,
            Lead.id.in_(payload.lead_ids),
        )
    )
    leads = result.scalars().all()
    if not leads:
        raise HTTPException(status_code=404, detail="No matching leads found for this campaign")

    reassigned = 0
    updated = 0

    for lead in leads:
        if lead.assigned_to and lead.assigned_to != agent.id:
            reassigned += 1

    if reassigned > 0 and (not payload.reason or len(payload.reason) < 20):
        raise HTTPException(status_code=400, detail="Reassignment requires reason (min 20 chars)")

    for lead in leads:
        if lead.assigned_to == agent.id:
            continue

        previous_assignee = lead.assigned_to
        lead.assigned_to = agent.id
        lead.updated_at = datetime.utcnow()
        updated += 1

        db.add(
            Activity(
                lead_id=lead.id,
                type="assignment_update",
                description=f"Lead assigned to {agent.name} (bulk assignment)",
                performed_by=current_user.id,
                meta={
                    "assignment_type": "bulk_assign",
                    "previous_assignee": previous_assignee,
                    "new_assignee": agent.id,
                    "reason": payload.reason,
                },
            )
        )

    if updated > 0:
        await create_notification(
            db,
            agent.id,
            title=f"{updated} campaign leads assigned",
            body=f"{current_user.name} assigned {updated} lead(s) to you in campaign {campaign_id}." + (
                f" Reason: {payload.reason}" if payload.reason else ""
            ),
            notif_type="new_lead",
            link=f"/campaigns/{campaign_id}/dashboard",
        )

    await db.commit()

    return {
        "status": "ok",
        "assigned": updated,
        "reassigned": reassigned,
        "agent_name": agent.name,
        "agent_id": agent.id,
        "campaign_id": campaign_id,
    }


# ─── UPDATE LEAD PRIORITY (Admin only) ──────────────────────────────────────

class PriorityUpdateRequest(BaseModel):
    priority: str


@router.patch("/{lead_id}/priority")
async def update_lead_priority(
    lead_id: str,
    data: PriorityUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Update lead priority tier (admin/manager only)."""
    if current_user.role not in {"admin", "manager"}:
        raise HTTPException(status_code=403, detail="Only admin or manager can update lead priority")

    result = await db.execute(
        select(Lead).options(selectinload(Lead.contact)).where(Lead.id == lead_id)
    )
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    valid_priorities = ["P1", "P2", "P3", "P4", "P5", "high", "normal", "low"]
    if data.priority not in valid_priorities:
        raise HTTPException(status_code=400, detail=f"Invalid priority. Must be one of: {valid_priorities}")

    old_priority = lead.priority
    lead.priority = data.priority
    lead.updated_at = datetime.utcnow()

    # Log activity
    activity = Activity(
        lead_id=lead.id,
        contact_id=lead.contact_id,
        type="priority_change",
        title="Lead priority updated",
        description=f"Priority changed from {old_priority} to {data.priority} by {current_user.name}",
        performed_by=current_user.id,
        meta={"old_priority": old_priority, "new_priority": data.priority},
    )
    db.add(activity)

    # Notify assignee if exists
    if lead.assigned_to:
        from app.services.lead_service import create_notification
        await create_notification(
            db,
            lead.assigned_to,
            title=f"Lead priority updated to {data.priority}",
            body=f"{current_user.name} changed the priority of this lead from {old_priority} to {data.priority}.",
            notif_type="stage_change",
            link=f"/leads/{lead.id}",
        )

    await db.commit()

    result = await db.execute(
        select(Lead).options(selectinload(Lead.contact), selectinload(Lead.assigned_agent)).where(Lead.id == lead_id)
    )
    return LeadResponse.model_validate(result.scalar_one())
