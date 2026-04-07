from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models.agent import Agent
from app.models.contact import Contact
from app.models.lead import Lead
from app.models.models import Activity, Task, Notification
from app.schemas.schemas import InboundLead
from app.services.memory_service import build_memory_brief
import json


STAGE_ORDER = ["new", "contacted", "site_visit_scheduled", "site_visit_done", "negotiation", "won", "lost", "nurture"]


def extract_appointment_context(data: InboundLead) -> Optional[str]:
    """Extract appointment intent from Priya payload notes/summary with tolerant matching."""
    snippets = [
        data.personal_notes or "",
        data.transcript_summary or "",
        data.timeline or "",
    ]
    combined = "\n".join(s for s in snippets if s).strip()
    if not combined:
        return None

    lowered = combined.lower()
    negative_markers = [
        "no schedule",
        "not scheduled",
        "no appointment",
        "not ready",
        "no visit",
    ]
    if any(marker in lowered for marker in negative_markers):
        return None

    intent_markers = [
        "appointment",
        "site visit",
        "visit",
        "schedule",
        "scheduled",
        "meeting",
        "tomorrow",
        "today",
        "weekend",
        "next week",
    ]
    if not any(marker in lowered for marker in intent_markers):
        return None

    for line in combined.splitlines():
        line_lower = line.lower()
        if any(marker in line_lower for marker in ["appointment", "visit", "schedule", "meeting"]):
            return line.strip()
    return combined[:220]


def auto_score(data: InboundLead) -> str:
    """Score a lead based on budget, timeline, and source signals."""
    if data.lead_score and data.lead_score in ("hot", "warm", "cold"):
        return data.lead_score
    score = "warm"
    if data.timeline in ("immediate", "1_month"):
        score = "hot"
    elif data.source == "priya_ai" and data.timeline in ("3_months",):
        score = "warm"
    elif data.source == "website" and not data.timeline:
        score = "cold"
    if data.budget_max and data.budget_max >= 10_000_000:  # >= 1Cr
        score = "hot"
    return score


async def find_contact_by_phone(db: AsyncSession, phone: str) -> Optional[Contact]:
    result = await db.execute(select(Contact).where(Contact.phone == phone))
    return result.scalar_one_or_none()


async def get_least_busy_agent(db: AsyncSession) -> Optional[str]:
    """Assign to agent with fewest active (non-won/lost) leads."""
    result = await db.execute(
        select(Agent.id, func.count(Lead.id).label("lead_count"))
        .outerjoin(Lead, and_(Lead.assigned_to == Agent.id, Lead.stage.notin_(["won", "lost", "nurture"])))
        .where(Agent.is_active == True, Agent.role == "agent")
        .group_by(Agent.id)
        .order_by("lead_count")
        .limit(1)
    )
    row = result.first()
    return row[0] if row else None


async def log_activity(
    db: AsyncSession,
    lead_id: str,
    contact_id: str,
    activity_type: str,
    title: str,
    description: Optional[str] = None,
    outcome: Optional[str] = None,
    performed_by: Optional[str] = None,
    meta: Optional[dict] = None,
):
    activity = Activity(
        lead_id=lead_id,
        contact_id=contact_id,
        type=activity_type,
        title=title,
        description=description,
        outcome=outcome,
        performed_by=performed_by,
        performed_at=datetime.utcnow(),
        meta=meta,
    )
    db.add(activity)
    await db.flush()
    return activity


async def create_auto_task(
    db: AsyncSession,
    lead_id: str,
    title: str,
    task_type: str,
    assigned_to: Optional[str],
    hours_from_now: int = 24,
    priority: str = "high",
):
    task = Task(
        lead_id=lead_id,
        title=title,
        task_type=task_type,
        assigned_to=assigned_to,
        due_at=datetime.utcnow() + timedelta(hours=hours_from_now),
        priority=priority,
        status="pending",
    )
    db.add(task)
    await db.flush()
    return task


async def create_notification(
    db: AsyncSession,
    agent_id: str,
    title: str,
    body: str,
    notif_type: str,
    link: Optional[str] = None,
):
    notif = Notification(
        agent_id=agent_id,
        title=title,
        body=body,
        type=notif_type,
        link=link,
    )
    db.add(notif)
    await db.flush()


async def process_inbound_lead(db: AsyncSession, data: InboundLead) -> dict:
    """
    Main inbound handler. Called from webhook endpoint.
    Handles dedup, create/update, scoring, assignment, tasks, notifications.
    Returns: {lead_id, contact_id, is_returning_caller, lead_score, assigned_to}
    """
    is_returning = False

    # 1. Check duplicate by phone
    existing_contact = await find_contact_by_phone(db, data.phone)

    if existing_contact:
        is_returning = True
        contact = existing_contact
        # Update personal notes if new info
        if data.personal_notes:
            existing_notes = contact.personal_notes or ""
            contact.personal_notes = f"{existing_notes}\n[{datetime.utcnow().date()}] {data.personal_notes}".strip()
        await db.flush()

        # Find most recent active lead for this contact
        result = await db.execute(
            select(Lead)
            .where(Lead.contact_id == contact.id)
            .where(Lead.stage.notin_(["won", "lost"]))
            .order_by(Lead.created_at.desc())
            .limit(1)
        )
        existing_lead = result.scalar_one_or_none()

        if existing_lead:
            # Duplicate from same or different source
            existing_lead.call_count += 1
            existing_lead.last_contacted_at = datetime.utcnow()
            existing_lead.updated_at = datetime.utcnow()
            # Update score if incoming is hotter
            score_rank = {"hot": 3, "warm": 2, "cold": 1}
            new_score = auto_score(data)
            if score_rank.get(new_score, 0) > score_rank.get(existing_lead.lead_score, 0):
                existing_lead.lead_score = new_score

            await log_activity(
                db, existing_lead.id, contact.id,
                activity_type="priya_call" if data.source == "priya_ai" else "note",
                title=f"Returning contact via {data.source}",
                description=data.transcript_summary,
                outcome="returning_caller",
                meta={"source": data.source, "call_duration": data.call_duration_seconds, "duplicate": True},
            )

            # Rebuild Priya memory brief
            existing_lead.priya_memory_brief = await build_memory_brief(db, existing_lead, contact)
            await db.commit()

            return {
                "lead_id": existing_lead.id,
                "contact_id": contact.id,
                "is_returning_caller": True,
                "lead_score": existing_lead.lead_score,
                "assigned_to": existing_lead.assigned_to,
            }

    else:
        # Brand new contact
        contact = Contact(
            name=data.name,
            phone=data.phone,
            email=data.email,
            type="buyer",
            source=data.source,
            personal_notes=data.personal_notes,
        )
        db.add(contact)
        await db.flush()

    # 2. Create new lead
    assigned_to = await get_least_busy_agent(db)
    lead_score = auto_score(data)

    lead = Lead(
        contact_id=contact.id,
        source=data.source,
        stage="new",
        lead_score=lead_score,
        budget_min=data.budget_min,
        budget_max=data.budget_max,
        property_type_interest=data.property_type,
        location_preference=data.location_preference,
        timeline=data.timeline,
        assigned_to=assigned_to,
        call_count=1 if data.source == "priya_ai" else 0,
        last_contacted_at=datetime.utcnow() if data.source == "priya_ai" else None,
        stage_changed_at=datetime.utcnow(),
    )
    db.add(lead)
    await db.flush()

    # 2.5 Auto-create SiteVisit if Priya extracted appointment
    appointment_context = extract_appointment_context(data) if data.source == "priya_ai" else None
    if appointment_context:
        from app.models.models import SiteVisit
        visit = SiteVisit(
            lead_id=lead.id,
            scheduled_at=datetime.utcnow() + timedelta(days=1),
            agent_id=assigned_to,
            notes=f"AI extracted appointment intent: {appointment_context}. Please verify exact time.",
            status="scheduled",
        )
        db.add(visit)
        lead.stage = "site_visit_scheduled"
        await db.flush()

    # 3. Log creation activity
    await log_activity(
        db, lead.id, contact.id,
        activity_type="lead_created",
        title=f"Lead created via {data.source}",
        description=data.transcript_summary,
        meta={"source": data.source, "call_duration": data.call_duration_seconds},
    )

    # 4. Auto-task: first contact within 24h
    await create_auto_task(
        db, lead.id,
        title=f"First contact — call {data.name} within 24 hours",
        task_type="call",
        assigned_to=assigned_to,
        hours_from_now=24,
        priority="high" if lead_score == "hot" else "normal",
    )

    # 5. Notify assigned agent (in-app + WhatsApp)
    if assigned_to:
        await create_notification(
            db, assigned_to,
            title=f"New {lead_score.upper()} lead: {data.name}",
            body=f"From {data.source}. Budget: ₹{(data.budget_min or 0)/100000:.0f}L–{(data.budget_max or 0)/100000:.0f}L. {data.location_preference or ''}",
            notif_type="new_lead",
            link=f"/leads/{lead.id}",
        )
        # WhatsApp notification to agent
        try:
            from app.services.agent_notifier import notify_agent_new_lead
            agent = await db.get(Agent, assigned_to)
            if agent:
                await notify_agent_new_lead(db, agent, lead, contact)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Agent WA notification failed: {e}")

    # 6. Build initial Priya memory brief
    lead.priya_memory_brief = await build_memory_brief(db, lead, contact)

    # 7. AI Analysis (async, non-blocking)
    try:
        from app.services.ai_analyzer import analyze_lead
        await analyze_lead(db, lead, contact)
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"AI analysis failed: {e}")

    # 8. Schedule automated follow-up sequence
    try:
        from app.services.followup_engine import schedule_followup_sequence
        await schedule_followup_sequence(
            db, lead.id, contact.id,
            trigger="new_lead",
            agent_id=assigned_to,
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Follow-up scheduling failed: {e}")

    await db.commit()

    return {
        "lead_id": lead.id,
        "contact_id": contact.id,
        "is_returning_caller": is_returning,
        "lead_score": lead_score,
        "assigned_to": assigned_to,
    }


async def change_lead_stage(
    db: AsyncSession,
    lead: Lead,
    new_stage: str,
    agent_id: str,
    lost_reason: Optional[str] = None,
) -> Lead:
    """Move a lead stage. Logs activity + auto-creates next task."""
    old_stage = lead.stage
    lead.stage = new_stage
    lead.stage_changed_at = datetime.utcnow()
    lead.days_in_stage = 0
    lead.updated_at = datetime.utcnow()

    if new_stage == "lost":
        lead.lost_reason = lost_reason

    contact = await db.get(Contact, lead.contact_id)
    contact_id = lead.contact_id
    contact_name = contact.name if contact else "Unknown"

    await log_activity(
        db, lead.id, contact_id,
        activity_type="stage_change",
        title=f"Stage changed: {old_stage} → {new_stage}",
        performed_by=agent_id,
        meta={"old_stage": old_stage, "new_stage": new_stage, "lost_reason": lost_reason},
    )

    # Auto-tasks per stage
    task_map = {
        "site_visit_scheduled": ("Send visit confirmation on WhatsApp", "whatsapp", 2, "high"),
        "site_visit_done": ("Follow up on visit feedback within 48 hours", "call", 48, "high"),
        "lost": ("Schedule re-engagement in 60 days", "call", 60 * 24, "low"),
        "won": None,
    }

    if new_stage in task_map and task_map[new_stage]:
        title, ttype, hours, priority = task_map[new_stage]
        await create_auto_task(db, lead.id, title, ttype, lead.assigned_to, hours, priority)

    # Rebuild memory brief
    if contact:
        lead.priya_memory_brief = await build_memory_brief(db, lead, contact)

    # Agent WhatsApp notification for stage change
    try:
        from app.services.agent_notifier import notify_agent_stage_change
        if lead.assigned_to:
            agent = await db.get(Agent, lead.assigned_to)
            if agent and contact:
                await notify_agent_stage_change(db, agent, lead, contact, old_stage, new_stage)
    except Exception:
        pass

    # Schedule follow-up sequence for the new stage
    try:
        from app.services.followup_engine import schedule_followup_sequence, cancel_pending_followups
        if new_stage in ("won", "lost"):
            await cancel_pending_followups(db, lead.id)
        elif new_stage in ("site_visit_scheduled", "site_visit_done"):
            await schedule_followup_sequence(
                db, lead.id, contact_id,
                trigger=new_stage,
                agent_id=lead.assigned_to,
            )
    except Exception:
        pass

    await db.flush()
    return lead
