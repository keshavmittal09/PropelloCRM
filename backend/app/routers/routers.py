from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import case, or_, select
from sqlalchemy.orm import selectinload
from datetime import datetime, timedelta, timezone
from app.core.dependencies import get_db, get_current_user
from app.models.agent import Agent
from app.models.contact import Contact
from app.models.lead import Lead
from app.models.models import Property, Task, SiteVisit, Notification, Activity
from app.schemas.schemas import (
    ContactCreate, ContactUpdate, ContactResponse,
    PropertyCreate, PropertyUpdate, PropertyResponse,
    TaskCreate, TaskUpdate, TaskResponse,
    SiteVisitCreate, SiteVisitUpdate, SiteVisitResponse,
    NotificationResponse, MemoryResponse, LeadResponse
)
from app.services.services import (
    get_summary, get_funnel, get_source_stats, get_agent_stats,
    send_whatsapp
)
from app.services.memory_service import build_memory_brief
from app.services.lead_service import create_notification
import io

# ─── CONTACTS ────────────────────────────────────────────────────────────────

contacts_router = APIRouter()

@contacts_router.get("/lookup/{phone}", response_model=MemoryResponse)
async def lookup_by_phone(phone: str, db: AsyncSession = Depends(get_db)):
    """Used by Priya AI before every call — returns full memory context."""
    result = await db.execute(select(Contact).where(Contact.phone == phone))
    contact = result.scalar_one_or_none()
    if not contact:
        return MemoryResponse(phone=phone, is_returning_caller=False, contact=None, lead=None, priya_memory_brief=None, call_count=0)

    lead_result = await db.execute(
        select(Lead).options(selectinload(Lead.assigned_agent))
        .where(Lead.contact_id == contact.id)
        .where(Lead.stage.notin_(["won", "lost"]))
        .order_by(Lead.created_at.desc()).limit(1)
    )
    lead = lead_result.scalar_one_or_none()

    return MemoryResponse(
        phone=phone,
        is_returning_caller=True,
        contact=ContactResponse.model_validate(contact),
        lead=LeadResponse.model_validate(lead) if lead else None,
        priya_memory_brief=lead.priya_memory_brief if lead else None,
        call_count=lead.call_count if lead else 0,
    )

@contacts_router.get("", response_model=list[ContactResponse])
async def list_contacts(
    search: Optional[str] = None,
    skip: int = 0, limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    query = select(Contact).order_by(Contact.created_at.desc())
    if search:
        query = query.where(or_(Contact.name.ilike(f"%{search}%"), Contact.phone.ilike(f"%{search}%")))
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return [ContactResponse.model_validate(c) for c in result.scalars().all()]

@contacts_router.post("", response_model=ContactResponse)
async def create_contact(data: ContactCreate, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    existing = await db.execute(select(Contact).where(Contact.phone == data.phone))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Contact with this phone already exists")
    contact = Contact(**data.model_dump())
    db.add(contact)
    await db.commit()
    await db.refresh(contact)
    return ContactResponse.model_validate(contact)

@contacts_router.get("/{contact_id}", response_model=ContactResponse)
async def get_contact(contact_id: str, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    contact = await db.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return ContactResponse.model_validate(contact)

@contacts_router.patch("/{contact_id}", response_model=ContactResponse)
async def update_contact(contact_id: str, data: ContactUpdate, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    contact = await db.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(contact, k, v)
    contact.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(contact)
    return ContactResponse.model_validate(contact)


# ─── PROPERTIES ──────────────────────────────────────────────────────────────

properties_router = APIRouter()

@properties_router.get("", response_model=list[PropertyResponse])
async def list_properties(
    status: Optional[str] = None,
    type: Optional[str] = None,
    city: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    skip: int = 0, limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    query = select(Property).order_by(Property.created_at.desc())
    if status:
        query = query.where(Property.status == status)
    if type:
        query = query.where(Property.type == type)
    if city:
        query = query.where(Property.city.ilike(f"%{city}%"))
    if min_price:
        query = query.where(Property.price >= min_price)
    if max_price:
        query = query.where(Property.price <= max_price)
    result = await db.execute(query.offset(skip).limit(limit))
    return [PropertyResponse.model_validate(p) for p in result.scalars().all()]

@properties_router.post("", response_model=PropertyResponse)
async def create_property(data: PropertyCreate, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    import json
    prop = Property(
        **data.model_dump(exclude={"amenities", "media_urls"}),
        amenities=json.dumps(data.amenities or []),
        media_urls=json.dumps(data.media_urls or []),
        listed_by=current_user.id,
    )
    db.add(prop)
    await db.commit()
    await db.refresh(prop)
    return PropertyResponse.model_validate(prop)

@properties_router.get("/{property_id}", response_model=PropertyResponse)
async def get_property(property_id: str, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    prop = await db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    return PropertyResponse.model_validate(prop)

@properties_router.patch("/{property_id}", response_model=PropertyResponse)
async def update_property(property_id: str, data: PropertyUpdate, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    prop = await db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(prop, k, v)
    prop.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(prop)
    return PropertyResponse.model_validate(prop)


# ─── TASKS ───────────────────────────────────────────────────────────────────

tasks_router = APIRouter()


def _normalize_naive_datetime(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is not None and value.utcoffset() is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _task_query_options():
    return (
        selectinload(Task.assigned_agent),
        selectinload(Task.lead).selectinload(Lead.contact),
        selectinload(Task.lead).selectinload(Lead.assigned_agent),
    )


async def _load_task_for_response(db: AsyncSession, task_id: str) -> Task:
    result = await db.execute(
        select(Task)
        .options(*_task_query_options())
        .where(Task.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task

@tasks_router.get("", response_model=list[TaskResponse])
async def list_tasks(
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    lead_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    now = datetime.utcnow()
    priority_order = case(
        (Task.priority == "high", 0),
        (Task.priority == "normal", 1),
        (Task.priority == "low", 2),
        else_=3,
    )
    query = (
        select(Task)
        .options(*_task_query_options())
        .order_by(priority_order.asc(), Task.due_at.asc(), Task.created_at.desc())
    )
    if current_user.role != "admin":
        query = query.where(Task.assigned_to == current_user.id)
    if status == "overdue":
        query = query.where(
            Task.due_at.is_not(None),
            Task.due_at < now,
            Task.status.in_(["pending", "overdue"]),
        )
    elif status == "pending":
        query = query.where(
            Task.status == "pending",
            or_(Task.due_at.is_(None), Task.due_at >= now),
        )
    elif status:
        query = query.where(Task.status == status)
    if assigned_to and current_user.role == "admin":
        query = query.where(Task.assigned_to == assigned_to)
    if lead_id:
        query = query.where(Task.lead_id == lead_id)
    result = await db.execute(query)
    tasks = result.scalars().all()

    # Keep task state fresh even when the scheduler hasn't run yet.
    if status == "overdue":
        needs_commit = False
        for task in tasks:
            if task.status == "pending":
                task.status = "overdue"
                needs_commit = True
        if needs_commit:
            await db.commit()

    return [TaskResponse.model_validate(t) for t in tasks]

@tasks_router.get("/today", response_model=list[TaskResponse])
async def todays_tasks(db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    today_end = datetime.utcnow().replace(hour=23, minute=59, second=59)
    priority_order = case(
        (Task.priority == "high", 0),
        (Task.priority == "normal", 1),
        (Task.priority == "low", 2),
        else_=3,
    )
    query = (
        select(Task)
        .options(*_task_query_options())
        .where(Task.status == "pending")
        .where(Task.due_at <= today_end)
        .order_by(priority_order.asc(), Task.due_at.asc())
    )
    if current_user.role != "admin":
        query = query.where(Task.assigned_to == current_user.id)

    result = await db.execute(query)
    return [TaskResponse.model_validate(t) for t in result.scalars().all()]

@tasks_router.get("/overdue", response_model=list[TaskResponse])
async def overdue_tasks(db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    now = datetime.utcnow()
    priority_order = case(
        (Task.priority == "high", 0),
        (Task.priority == "normal", 1),
        (Task.priority == "low", 2),
        else_=3,
    )
    query = (
        select(Task)
        .options(*_task_query_options())
        .where(
            Task.due_at.is_not(None),
            Task.due_at < now,
            Task.status.in_(["pending", "overdue"]),
        )
        .order_by(priority_order.asc(), Task.due_at.asc())
    )
    if current_user.role != "admin":
        query = query.where(Task.assigned_to == current_user.id)

    result = await db.execute(query)
    tasks = result.scalars().all()
    needs_commit = False
    for task in tasks:
        if task.status == "pending":
            task.status = "overdue"
            needs_commit = True
    if needs_commit:
        await db.commit()

    return [TaskResponse.model_validate(t) for t in tasks]

@tasks_router.post("", response_model=TaskResponse)
async def create_task(data: TaskCreate, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    payload = data.model_dump()
    payload["due_at"] = _normalize_naive_datetime(payload.get("due_at"))
    if current_user.role != "admin":
        if payload.get("assigned_to") and payload.get("assigned_to") != current_user.id:
            raise HTTPException(status_code=403, detail="Only admin can assign tasks to other users")
        payload["assigned_to"] = current_user.id

    task = Task(**payload, created_by=current_user.id)
    db.add(task)
    await db.flush()

    if task.assigned_to:
        await create_notification(
            db,
            task.assigned_to,
            title="New task assigned",
            body=task.title,
            notif_type="task_due",
            link=f"/tasks",
        )

    await db.commit()
    response_task = await _load_task_for_response(db, task.id)
    return TaskResponse.model_validate(response_task)

@tasks_router.patch("/{task_id}/complete", response_model=TaskResponse)
async def complete_task(task_id: str, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if current_user.role != "admin" and task.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to complete this task")

    task.status = "done"
    task.completed_at = datetime.utcnow()

    # Log as activity on the lead
    lead = await db.get(Lead, task.lead_id)
    if lead:
        from app.services.lead_service import log_activity
        await log_activity(db, task.lead_id, lead.contact_id, "task_completed", f"Task completed: {task.title}", performed_by=current_user.id)

    if task.assigned_to:
        await create_notification(
            db,
            task.assigned_to,
            title="Task completed",
            body=f"{current_user.name} completed: {task.title}",
            notif_type="reminder",
            link="/tasks",
        )

    await db.commit()
    response_task = await _load_task_for_response(db, task.id)
    return TaskResponse.model_validate(response_task)

@tasks_router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(task_id: str, data: TaskUpdate, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    is_admin_scope = current_user.role == "admin"
    if not is_admin_scope and task.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to edit this task")

    update_payload = data.model_dump(exclude_unset=True)
    if "due_at" in update_payload:
        update_payload["due_at"] = _normalize_naive_datetime(update_payload.get("due_at"))
    if not is_admin_scope and "assigned_to" in update_payload and update_payload.get("assigned_to") != current_user.id:
        raise HTTPException(status_code=403, detail="Only admin can assign tasks to other users")

    for k, v in update_payload.items():
        setattr(task, k, v)

    if task.assigned_to:
        await create_notification(
            db,
            task.assigned_to,
            title="Task updated",
            body=f"{current_user.name} updated task: {task.title}",
            notif_type="reminder",
            link="/tasks",
        )

    await db.commit()
    response_task = await _load_task_for_response(db, task.id)
    return TaskResponse.model_validate(response_task)


# ─── SITE VISITS ─────────────────────────────────────────────────────────────

visits_router = APIRouter()

@visits_router.get("", response_model=list[SiteVisitResponse])
async def list_visits(
    lead_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db), 
    current_user: Agent = Depends(get_current_user)
):
    query = (
        select(SiteVisit)
        .options(
            selectinload(SiteVisit.lead).selectinload(Lead.contact),
            selectinload(SiteVisit.lead).selectinload(Lead.assigned_agent),
        )
        .order_by(SiteVisit.scheduled_at.asc())
    )
    if current_user.role in ["agent", "call_agent"]:
        query = query.where(SiteVisit.agent_id == current_user.id)
    if lead_id:
        query = query.where(SiteVisit.lead_id == lead_id)
    result = await db.execute(query)
    visits = []
    for v in result.scalars().all():
        lead = v.lead
        contact = lead.contact if lead else None
        agent = lead.assigned_agent if lead else None
        visits.append(
            SiteVisitResponse(
                id=v.id,
                lead_id=v.lead_id,
                property_id=v.property_id,
                scheduled_at=v.scheduled_at,
                agent_id=v.agent_id,
                status=v.status,
                client_confirmed=v.client_confirmed,
                notes=v.notes,
                created_at=v.created_at,
                lead_contact_name=contact.name if contact else None,
                lead_contact_phone=contact.phone if contact else None,
                agent_name=agent.name if agent else None,
            )
        )
    return visits

@visits_router.post("", response_model=SiteVisitResponse)
async def schedule_visit(data: SiteVisitCreate, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    visit = SiteVisit(**data.model_dump(exclude={"agent_id"}), agent_id=data.agent_id or current_user.id)
    db.add(visit)

    # Auto stage-change and WhatsApp notification
    lead = await db.get(Lead, data.lead_id)
    if lead:
        from app.services.lead_service import change_lead_stage
        await change_lead_stage(db, lead, "site_visit_scheduled", current_user.id)
        contact = await db.get(Contact, lead.contact_id)
        if visit.agent_id:
            await create_notification(
                db,
                visit.agent_id,
                title="Site visit scheduled",
                body=f"A site visit was scheduled for lead {lead.id}.",
                notif_type="reminder",
                link=f"/leads/{lead.id}",
            )
        if contact:
            await send_whatsapp(
                to_phone=contact.phone,
                template="site_visit_confirmation",
                variables={
                    "name": contact.name,
                    "date": data.scheduled_at.strftime("%B %d, %Y"),
                    "time": data.scheduled_at.strftime("%I:%M %p"),
                    "agent_name": current_user.name,
                },
                db=db, lead_id=lead.id, contact_id=contact.id, agent_id=current_user.id,
            )

    await db.commit()
    await db.refresh(visit)
    return SiteVisitResponse.model_validate(visit)

@visits_router.patch("/{visit_id}", response_model=SiteVisitResponse)
async def update_visit(visit_id: str, data: SiteVisitUpdate, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    result = await db.execute(
        select(SiteVisit)
        .options(
            selectinload(SiteVisit.lead).selectinload(Lead.contact),
            selectinload(SiteVisit.lead).selectinload(Lead.assigned_agent),
        )
        .where(SiteVisit.id == visit_id)
    )
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(visit, k, v)
    if data.status == "done":
        lead = await db.get(Lead, visit.lead_id)
        if lead:
            from app.services.lead_service import change_lead_stage
            await change_lead_stage(db, lead, "site_visit_done", current_user.id)

    if visit.agent_id:
        await create_notification(
            db,
            visit.agent_id,
            title="Visit updated",
            body=f"Visit status changed to {visit.status}.",
            notif_type="reminder",
            link=f"/leads/{visit.lead_id}",
        )

    await db.commit()
    await db.refresh(visit)
    lead = visit.lead
    contact = lead.contact if lead else None
    agent = lead.assigned_agent if lead else None
    return SiteVisitResponse(
        id=visit.id,
        lead_id=visit.lead_id,
        property_id=visit.property_id,
        scheduled_at=visit.scheduled_at,
        agent_id=visit.agent_id,
        status=visit.status,
        client_confirmed=visit.client_confirmed,
        notes=visit.notes,
        created_at=visit.created_at,
        lead_contact_name=contact.name if contact else None,
        lead_contact_phone=contact.phone if contact else None,
        agent_name=agent.name if agent else None,
    )


# ─── ANALYTICS ───────────────────────────────────────────────────────────────

analytics_router = APIRouter()

@analytics_router.get("/summary")
async def summary(days: int = 30, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    return await get_summary(db, days)

@analytics_router.get("/funnel")
async def funnel(db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    return await get_funnel(db)

@analytics_router.get("/by-source")
async def by_source(db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    return await get_source_stats(db)

@analytics_router.get("/agent-performance")
async def agent_performance(db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager/Admin only")
    return await get_agent_stats(db)


# ─── NOTIFICATIONS ───────────────────────────────────────────────────────────

notifications_router = APIRouter()

@notifications_router.get("", response_model=list[NotificationResponse])
async def list_notifications(db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    result = await db.execute(
        select(Notification)
        .where(Notification.agent_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(30)
    )
    return [NotificationResponse.model_validate(n) for n in result.scalars().all()]

@notifications_router.patch("/read-all")
async def read_all(db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    result = await db.execute(
        select(Notification).where(Notification.agent_id == current_user.id, Notification.is_read == False)
    )
    for n in result.scalars().all():
        n.is_read = True
    await db.commit()
    return {"status": "ok"}
