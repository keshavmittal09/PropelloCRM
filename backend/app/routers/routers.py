from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, Field
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
    NotificationResponse, MemoryResponse, LeadResponse, AdminBroadcastRequest,
    TaskCompleteWithRemarkRequest, MasterProfileUpdate, MasterProfileResponse,
    DNCFlagRequest, TaskCompleteDemographicRequest, TaskCompleteDemographicResponse,
)
from app.services.services import (
    get_summary, get_funnel, get_source_stats, get_agent_stats,
    send_whatsapp, is_sales_scoped_admin, live_sales_agent_ids,
)
from app.services.memory_service import build_memory_brief
from app.services.lead_service import create_notification
from app.services.demographic_service import create_followup_from_completion, sync_demographics_to_lead
from app.services.notification_dispatcher import notify_task_assignment_multichannel
from app.services.notification_dispatcher import send_admin_broadcast
import io

# ─── CONTACTS ────────────────────────────────────────────────────────────────

contacts_router = APIRouter()


def _require_non_call_agent(current_user: Agent) -> None:
    if current_user.role == "call_agent":
        raise HTTPException(status_code=403, detail="call_agent cannot access this endpoint")

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
    _require_non_call_agent(current_user)

    query = select(Contact).order_by(Contact.created_at.desc())
    if search:
        query = query.where(or_(Contact.name.ilike(f"%{search}%"), Contact.phone.ilike(f"%{search}%")))
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return [ContactResponse.model_validate(c) for c in result.scalars().all()]

@contacts_router.post("", response_model=ContactResponse)
async def create_contact(data: ContactCreate, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    _require_non_call_agent(current_user)

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
    _require_non_call_agent(current_user)

    contact = await db.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return ContactResponse.model_validate(contact)

@contacts_router.patch("/{contact_id}", response_model=ContactResponse)
async def update_contact(contact_id: str, data: ContactUpdate, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    _require_non_call_agent(current_user)

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
    _require_non_call_agent(current_user)

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
    _require_non_call_agent(current_user)

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
    _require_non_call_agent(current_user)

    prop = await db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    return PropertyResponse.model_validate(prop)

@properties_router.patch("/{property_id}", response_model=PropertyResponse)
async def update_property(property_id: str, data: PropertyUpdate, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    _require_non_call_agent(current_user)

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


# Call outcomes that mean "nobody picked up / needs a callback" — the lead still
# owes us a call, so the task stays in Pending for a redial instead of being
# closed as Done.
NO_ANSWER_STATUSES = {
    "no_answer", "no-answer", "noanswer", "not_answered", "unanswered",
    "callback", "call_back_later", "call back later", "callbacklater",
}


async def _load_task_for_response(db: AsyncSession, task_id: str) -> Task:
    # Expire identity-map objects first so the eager loaders below actually run.
    # Otherwise the already-loaded task is returned WITHOUT its relationships, and
    # serializing lead.contact triggers an async lazy-load (greenlet_spawn error).
    db.expire_all()
    result = await db.execute(
        select(Task)
        .options(*_task_query_options())
        .where(Task.id == task_id)
        .execution_options(populate_existing=True)
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
    if current_user.role == "call_agent":
        raise HTTPException(status_code=403, detail="call_agent must use /api/me/tasks")

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
    if current_user.role in {"agent", "call_agent"}:
        query = query.where(Task.assigned_to == current_user.id)
    # Sales-scoped admins (Krishna group) only see the live sales team's tasks.
    if is_sales_scoped_admin(current_user):
        query = query.where(Task.assigned_to.in_(live_sales_agent_ids()))
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
    if current_user.role == "call_agent":
        raise HTTPException(status_code=403, detail="call_agent must use /api/me/tasks")

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = datetime.utcnow().replace(hour=23, minute=59, second=59, microsecond=999999)
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
        .where(Task.due_at >= today_start)
        .where(Task.due_at <= today_end)
        .order_by(priority_order.asc(), Task.due_at.asc())
    )
    if current_user.role in {"agent", "call_agent"}:
        query = query.where(Task.assigned_to == current_user.id)
    if is_sales_scoped_admin(current_user):
        query = query.where(Task.assigned_to.in_(live_sales_agent_ids()))

    result = await db.execute(query)
    return [TaskResponse.model_validate(t) for t in result.scalars().all()]

@tasks_router.get("/overdue", response_model=list[TaskResponse])
async def overdue_tasks(db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    if current_user.role == "call_agent":
        raise HTTPException(status_code=403, detail="call_agent must use /api/me/tasks")

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
    if current_user.role in {"agent", "call_agent"}:
        query = query.where(Task.assigned_to == current_user.id)
    if is_sales_scoped_admin(current_user):
        query = query.where(Task.assigned_to.in_(live_sales_agent_ids()))

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
    if current_user.role == "call_agent":
        raise HTTPException(status_code=403, detail="call_agent cannot create tasks")
    if current_user.role == "agent":
        if payload.get("assigned_to") and payload.get("assigned_to") != current_user.id:
            raise HTTPException(status_code=403, detail="Only admin/manager can assign tasks to other users")
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
        try:
            await notify_task_assignment_multichannel(
                db,
                task,
                actor_name=current_user.name,
                actor_id=current_user.id,
                event_type="task_created",
                source="manual",
                changed_fields=list(payload.keys()),
            )
        except Exception:
            pass

    await db.commit()
    response_task = await _load_task_for_response(db, task.id)
    return TaskResponse.model_validate(response_task)

@tasks_router.patch("/{task_id}/complete", response_model=TaskResponse)
async def complete_task(task_id: str, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if current_user.role in {"agent", "call_agent"} and task.assigned_to != current_user.id:
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
        try:
            await notify_task_assignment_multichannel(
                db,
                task,
                actor_name=current_user.name,
                actor_id=current_user.id,
                event_type="task_completed",
                source="manual",
                changed_fields=["status", "completed_at"],
            )
        except Exception:
            pass

    await db.commit()
    response_task = await _load_task_for_response(db, task.id)
    return TaskResponse.model_validate(response_task)


async def _score_and_rank_in_background(task_id: str, agent_id: str | None, remark_text: str):
    """Slow work (Groq AI scoring + performance recompute) run AFTER the response
    is sent, in its own DB session, so task completion returns instantly."""
    from app.db.base import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        try:
            task = await session.get(Task, task_id)
            if task:
                from app.services.remark_quality_service import evaluate_and_update_task
                await evaluate_and_update_task(session, task, remark_text)
            if agent_id:
                from app.services.performance_service import update_agent_performance_live
                await update_agent_performance_live(session, agent_id, days=30)
            await session.commit()
        except Exception:
            await session.rollback()


@tasks_router.patch("/{task_id}/complete-with-remark", response_model=TaskResponse)
async def complete_task_with_remark(
    task_id: str,
    data: TaskCompleteWithRemarkRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Feature 1+2: Complete a task with remark + optional demographic form data."""
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if current_user.role in {"agent", "call_agent"} and task.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to complete this task")

    lead = await db.get(Lead, task.lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    # Capture identifiers as plain values up front. If the enrichment block below
    # fails and rolls back, the `task` ORM object becomes expired — and touching
    # any of its attributes afterwards would emit IO synchronously and raise
    # MissingGreenlet (a 500). Use these locals after the try/except instead.
    task_assigned_to = task.assigned_to

    # "No answer" is not a finished call — the agent still has to ring them back.
    # Keep the task in Pending (with the outcome recorded) instead of closing it.
    call_status_norm = (data.call_status or "").strip().lower()
    needs_callback = call_status_norm in NO_ANSWER_STATUSES

    # --- Essential completion: commit first so the outcome is definitely saved
    # even if any of the optional enrichment below fails. ---
    task.status = "pending" if needs_callback else "done"
    task.completed_at = None if needs_callback else datetime.utcnow()
    if needs_callback:
        # No due date keeps it under Pending (not Overdue) so it's ready to redial.
        task.due_at = None
    task.completion_remark = data.remark_text
    task.completion_tags = data.preset_tags
    # Store the agent's heat + call status as structured data in this same (reliable)
    # commit, so the dashboard Hot/Warm/Cold/Callback counts survive even if the later
    # enrichment rolls back.
    task.completion_interest = (data.interest_level or "").strip().lower() or None
    task.completion_call_status = call_status_norm or None
    lead.last_remark = data.remark_text[:120]
    lead.last_interaction_at = datetime.utcnow()
    lead.last_contacted_at = datetime.utcnow()
    await db.commit()

    # Capture plain values now. If a block below fails and we rollback, ORM
    # attribute access on the expired task/lead would itself raise greenlet
    # errors — so never touch task.* / lead.* after a rollback; use these.
    task_assigned_to = task.assigned_to
    task_title = task.title
    task_lead_id = task.lead_id
    lead_contact_id = lead.contact_id

    # --- Follow-up task: its OWN transaction, so a failure anywhere else can
    # never roll it back. This is the record the reminder + auto-AI-call job
    # fires on, so it must be created reliably. ---
    followup_task_id = None
    if data.next_followup_at:
        try:
            fresh_lead = await db.get(Lead, task_lead_id)
            if fresh_lead is not None:
                ft = await create_followup_from_completion(
                    db, fresh_lead, data.next_followup_at, current_user.id
                )
                await db.commit()
                if ft is not None:
                    followup_task_id = ft.id
        except Exception as e:
            await db.rollback()
            import logging
            logging.getLogger(__name__).warning(
                "Follow-up task creation failed for %s: %s", task_id, e, exc_info=True
            )

    # --- Best-effort enrichment: demographics, activity log (admin visibility)
    # and notification. AI scoring + performance run in the background so the
    # request never waits on the slow Groq call. ---
    try:
        # Re-fetch: a rollback above would have expired these objects.
        lead = await db.get(Lead, task_lead_id)
        updated_lead_fields = await sync_demographics_to_lead(
            db=db,
            lead=lead,
            demographics=data.demographics,
            call_status=data.call_status,
            interest_level=data.interest_level,
            topics_discussed=data.topics_discussed or [],
            note=data.note or data.remark_text,
            agent_id=current_user.id,
        )

        tag_str = ", ".join(data.preset_tags) if data.preset_tags else ""
        description = data.remark_text
        if tag_str:
            description = f"[Tags: {tag_str}] {description}"

        activity = Activity(
            lead_id=task_lead_id,
            contact_id=lead_contact_id,
            type="task_completion_remark",
            title=f"Task completed: {task_title}",
            description=description,
            performed_by=current_user.id,
            meta={
                "task_id": task_id,
                "interest_level": (data.interest_level or "").strip().lower() or None,
                "call_status": (data.call_status or "").strip().lower() or None,
                "preset_tags": data.preset_tags,
                "remark_text": data.remark_text,
                "updated_lead_fields": updated_lead_fields,
                "next_followup_at": data.next_followup_at.isoformat() if data.next_followup_at else None,
                "followup_task_id": followup_task_id,
            },
        )
        db.add(activity)

        if task_assigned_to:
            await create_notification(
                db,
                task_assigned_to,
                title="Task completed with remark",
                body=f"{current_user.name} completed: {task_title}",
                notif_type="reminder",
                link="/tasks",
            )

        await db.commit()
    except Exception as e:
        await db.rollback()
        import logging
        # Use task_id (a plain str), not task.id — after rollback the ORM object
        # is expired and attribute access would raise MissingGreenlet.
        logging.getLogger(__name__).warning("Task completion enrichment failed for %s: %s", task_id, e, exc_info=True)

    # Slow AI scoring + performance recompute happen after the response is sent.
    background_tasks.add_task(_score_and_rank_in_background, task_id, task_assigned_to, data.remark_text)

    response_task = await _load_task_for_response(db, task_id)
    return TaskResponse.model_validate(response_task)


@tasks_router.post("/{task_id}/complete-demographic", response_model=TaskCompleteDemographicResponse)
async def complete_task_demographic(
    task_id: str,
    data: TaskCompleteDemographicRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """
    Mobile Feature 2: Complete a task with structured demographic form.
    Replaces the remark-based completion for call_agent flows.
    """
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if current_user.role in {"agent", "call_agent"} and task.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to complete this task")

    # "No answer" keeps the task in Pending so the agent can ring back (see
    # complete-with-remark).
    call_status_norm = (data.call_status or "").strip().lower()
    needs_callback = call_status_norm in NO_ANSWER_STATUSES

    task.status = "pending" if needs_callback else "done"
    task.completed_at = None if needs_callback else datetime.utcnow()
    if needs_callback:
        task.due_at = None
    # Structured heat + call status for the dashboard (see complete-with-remark).
    task.completion_interest = (data.interest_level or "").strip().lower() or None
    task.completion_call_status = call_status_norm or None

    # Get the lead
    lead = await db.get(Lead, task.lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    # Sync demographics
    from app.services.demographic_service import sync_demographics_to_lead, create_followup_from_completion

    updated_fields = await sync_demographics_to_lead(
        db=db,
        lead=lead,
        demographics=data.demographics,
        call_status=data.call_status,
        interest_level=data.interest_level,
        topics_discussed=data.topics_discussed or [],
        note=data.note,
        agent_id=current_user.id,
    )

    # Create follow-up task if next_followup_at provided
    next_followup_task = None
    if data.next_followup_at and data.call_status == "connected":
        next_followup_task = await create_followup_from_completion(
            db=db,
            lead=lead,
            next_followup_at=data.next_followup_at,
            agent_id=current_user.id,
        )

    # Log a timeline activity so this completion (and its interest marking) shows in
    # the lead's profile history — same as the web complete-with-remark path.
    interest_clean = (data.interest_level or "").strip().lower() or None
    desc_parts = [f"Call status: {data.call_status}"]
    if interest_clean:
        desc_parts.append(f"Interest: {interest_clean}")
    if data.topics_discussed:
        desc_parts.append(f"Discussed: {', '.join(data.topics_discussed)}")
    if data.note:
        desc_parts.append(f"Note: {data.note}")
    db.add(Activity(
        lead_id=task.lead_id,
        contact_id=lead.contact_id,
        type="task_completion_remark",
        title=f"Task completed: {task.title}",
        description=". ".join(desc_parts),
        performed_by=current_user.id,
        meta={
            "task_id": task.id,
            "interest_level": interest_clean,
            "call_status": (data.call_status or "").strip().lower() or None,
            "topics_discussed": data.topics_discussed,
            "updated_lead_fields": updated_fields,
        },
    ))

    # Update performance
    if task.assigned_to:
        try:
            from app.services.performance_service import update_agent_performance_live
            await update_agent_performance_live(db, task.assigned_to, days=30)
        except Exception:
            pass

    # Notify
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

    return TaskCompleteDemographicResponse(
        task_id=task.id,
        lead_id=lead.id,
        updated_fields=updated_fields,
        next_followup_id=next_followup_task.id if next_followup_task else None,
    )


@tasks_router.post("/flag-dnc")
async def flag_dnc(
    data: DNCFlagRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Feature 2: Flag lead as DNC from task completion."""
    lead = await db.get(Lead, data.lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if current_user.role in {"agent", "call_agent"} and lead.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to flag this lead")
        
    lead.dnd = data.mark_dnd
    if data.mark_dnd:
        lead.priority = "P5"
        lead.stage = "lost"
        lead.lost_reason = "Do Not Call / Not Interested"
        
        # Also flag in CampaignLead if it exists
        from app.models.campaign_dashboard import CampaignLead
        from sqlalchemy import select
        campaign_lead = await db.scalar(select(CampaignLead).where(CampaignLead.lead_id == data.lead_id))
        if campaign_lead:
            campaign_lead.dnd_flag = True
            campaign_lead.priority_tier = "P5"
            campaign_lead.action_taken = "Marked DNC"
            
        # Log activity
        from app.services.lead_service import log_activity
        activity = Activity(
            lead_id=lead.id,
            contact_id=lead.contact_id,
            type="system",
            title="Lead Marked as DNC",
            description=f"Agent {current_user.name} marked lead as Do Not Call.",
            performed_by=current_user.id,
        )
        db.add(activity)

    await db.commit()
    return {"status": "ok", "lead_id": data.lead_id, "dnd": data.mark_dnd}






@tasks_router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(task_id: str, data: TaskUpdate, db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if current_user.role == "call_agent":
        raise HTTPException(status_code=403, detail="call_agent cannot edit tasks")

    is_manager_scope = current_user.role in {"admin", "manager"}
    if not is_manager_scope and task.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to edit this task")

    previous_values = {
        "assigned_to": task.assigned_to,
        "due_at": task.due_at,
        "priority": task.priority,
        "status": task.status,
        "title": task.title,
        "description": task.description,
    }

    update_payload = data.model_dump(exclude_unset=True)
    if "due_at" in update_payload:
        update_payload["due_at"] = _normalize_naive_datetime(update_payload.get("due_at"))
    if not is_manager_scope and "assigned_to" in update_payload and update_payload.get("assigned_to") != current_user.id:
        raise HTTPException(status_code=403, detail="Only admin/manager can assign tasks to other users")

    for k, v in update_payload.items():
        setattr(task, k, v)

    changed_fields = [
        field
        for field, old_value in previous_values.items()
        if old_value != getattr(task, field)
    ]

    if task.assigned_to:
        await create_notification(
            db,
            task.assigned_to,
            title="Task updated",
            body=f"{current_user.name} updated task: {task.title}",
            notif_type="reminder",
            link="/tasks",
        )
        meaningful_fields = {"assigned_to", "due_at", "priority", "status", "title", "description"}
        if any(field in meaningful_fields for field in changed_fields):
            try:
                await notify_task_assignment_multichannel(
                    db,
                    task,
                    actor_name=current_user.name,
                    actor_id=current_user.id,
                    event_type="task_updated",
                    source="manual",
                    changed_fields=changed_fields,
                )
            except Exception:
                pass

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
    _require_non_call_agent(current_user)

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
    _require_non_call_agent(current_user)

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
    _require_non_call_agent(current_user)

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
    # Admin & reception see the whole live sales team (~210 assigned leads).
    # A sales agent (agent/call_agent/manager) sees only their own assigned
    # leads and their own hot/warm/cold call categorisation.
    scope_agent_id = None if current_user.role in ("admin", "reception") else current_user.id
    return await get_summary(db, days, scope_agent_id=scope_agent_id)

@analytics_router.get("/funnel")
async def funnel(db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager/Admin only")
    return await get_funnel(db)

@analytics_router.get("/by-source")
async def by_source(db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    if current_user.role not in ("admin", "manager", "reception"):
        raise HTTPException(status_code=403, detail="Manager/Admin only")
    return await get_source_stats(db)

@analytics_router.get("/agent-performance")
async def agent_performance(db: AsyncSession = Depends(get_db), current_user: Agent = Depends(get_current_user)):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager/Admin only")
    from app.services.services import get_agent_stats
    return await get_agent_stats(db)

@analytics_router.get("/meta")
async def get_meta_stats(days: int = 30, db: AsyncSession = Depends(get_db)):
    from app.services.services import get_marketing_stats
    return await get_marketing_stats(db, days)


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


@notifications_router.post("/broadcast")
async def broadcast_notification(
    data: AdminBroadcastRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    channels = [channel.lower() for channel in data.channels if channel]
    if not channels:
        raise HTTPException(status_code=400, detail="At least one channel is required")

    allowed_channels = {"in_app", "whatsapp", "email"}
    if any(channel not in allowed_channels for channel in channels):
        raise HTTPException(status_code=400, detail="Invalid channel. Use in_app, whatsapp, or email")

    query = select(Agent).where(Agent.is_active == True, Agent.role.in_(["agent", "call_agent", "manager"]))

    if data.target_agent_ids:
        query = query.where(Agent.id.in_(data.target_agent_ids))
    elif not data.all_agents:
        raise HTTPException(status_code=400, detail="Provide target_agent_ids or set all_agents=true")

    result = await db.execute(query)
    recipients = result.scalars().all()
    if not recipients:
        raise HTTPException(status_code=404, detail="No recipients found")

    dispatch = await send_admin_broadcast(
        db,
        sender=current_user,
        recipients=recipients,
        message=data.message,
        subject=data.subject,
        channels=channels,
    )

    await db.commit()
    return {
        "status": "sent",
        "result": dispatch,
    }


class NotificationDispatchRequest(BaseModel):
    agent_id: str
    lead_count: int = Field(ge=1)
    campaign_id: str
    campaign_name: Optional[str] = None
    top_lead_name: Optional[str] = None
    top_lead_priority: Optional[str] = None


@notifications_router.post("/dispatch")
async def dispatch_assignment_notification(
    data: NotificationDispatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Admin/Manager only")

    from app.services.notification_dispatcher import notify_campaign_assignment_summary

    result = await notify_campaign_assignment_summary(
        db,
        agent_id=data.agent_id,
        lead_count=data.lead_count,
        campaign_id=data.campaign_id,
        campaign_name=data.campaign_name,
        top_lead_name=data.top_lead_name,
        top_lead_priority=data.top_lead_priority,
    )
    await db.commit()
    return {"status": "ok", "result": result}
