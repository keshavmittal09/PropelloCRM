from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from datetime import datetime
from pydantic import BaseModel
from app.core.dependencies import get_db, get_current_user
from app.core.config import settings
from app.models.agent import Agent
from app.models.contact import Contact
from app.models.lead import Lead
from app.models.models import Activity, Task
from app.schemas.schemas import (
    InboundLead, InboundLeadResponse, LeadCreate, LeadUpdate,
    LeadResponse, StageUpdate, NoteCreate, CallLogCreate, ActivityResponse
)
from app.services.lead_service import process_inbound_lead, change_lead_stage, log_activity, create_auto_task, create_notification
from app.services.services import find_matching_properties, send_whatsapp
from app.services.memory_service import build_memory_brief
from app.schemas.schemas import WhatsAppSend, PropertyResponse

router = APIRouter()


class LeadPageResponse(BaseModel):
    items: list[LeadResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


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
        assigned_to=data.assigned_to or current_user.id,
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
    contact = await db.get(Contact, lead.contact_id)

    for field, value in data.model_dump(exclude_unset=True, exclude={"personal_notes"}).items():
        setattr(lead, field, value)
    lead.updated_at = datetime.utcnow()

    # personal_notes goes on the contact
    if data.personal_notes:
        if contact:
            contact.personal_notes = data.personal_notes
            lead.priya_memory_brief = await build_memory_brief(db, lead, contact)

    if lead.assigned_to:
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
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
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


@router.get("/{lead_id}/property-matches", response_model=list[PropertyResponse])
async def property_matches(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

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
    if current_user.role not in ["admin", "manager", "agent", "call_agent"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    from sqlalchemy import delete
    from app.models.models import Activity, Task, SiteVisit
    from app.models.followup import FollowUp
    await db.execute(delete(Activity).where(Activity.lead_id == lead_id))
    await db.execute(delete(Task).where(Task.lead_id == lead_id))
    await db.execute(delete(FollowUp).where(FollowUp.lead_id == lead_id))
    await db.execute(delete(SiteVisit).where(SiteVisit.lead_id == lead_id))
    await db.execute(delete(Lead).where(Lead.id == lead_id))
    await db.commit()
    return {"status": "deleted"}
