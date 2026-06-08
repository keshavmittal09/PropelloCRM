"""
AI Workflow Service
-------------------
Handles post-call automation for HOT/WARM leads and COLD retry scheduling.

HOT (score 80-100):  WhatsApp → Assign caller → Create task → Log activity → Update status
WARM (score 50-79):  Same as HOT but lower priority
COLD (score <50):    Schedule retry callbacks at 24h / 3d / 7d intervals
Max retries (3):     Mark lead as Lost if still cold
"""
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models.lead import Lead
from app.models.contact import Contact
from app.models.agent import Agent
from app.models.models import Activity, Task
import logging

logger = logging.getLogger(__name__)

# Retry schedule in days
COLD_RETRY_DELAYS = [1, 3, 7]  # retry 1 → 24h, retry 2 → 3d, retry 3 → 7d
MAX_RETRIES = 3

# WhatsApp templates for hot/warm automation
HOT_LEAD_TEMPLATE = "hot_lead_outreach"
WARM_LEAD_TEMPLATE = "warm_lead_followup"


async def _get_available_caller(db: AsyncSession) -> Optional[Agent]:
    """Return the active caller/agent with the fewest open leads."""
    result = await db.execute(
        select(Agent.id, func.count(Lead.id).label("lead_count"))
        .outerjoin(Lead, and_(Lead.assigned_to == Agent.id, Lead.stage.notin_(["won", "lost", "nurture"])))
        .where(Agent.is_active == True, Agent.role.in_(["agent", "call_agent"]))
        .group_by(Agent.id)
        .order_by("lead_count")
        .limit(1)
    )
    row = result.first()
    if not row:
        return None
    return await db.get(Agent, row[0])


async def _log_activity(
    db: AsyncSession,
    lead: Lead,
    activity_type: str,
    title: str,
    description: str,
    performed_by: Optional[str] = None,
    meta: Optional[dict] = None,
) -> None:
    activity = Activity(
        lead_id=lead.id,
        contact_id=lead.contact_id,
        type=activity_type,
        title=title,
        description=description,
        performed_by=performed_by,
        performed_at=datetime.utcnow(),
        meta=meta or {},
    )
    db.add(activity)


async def _create_followup_task(
    db: AsyncSession,
    lead: Lead,
    agent_id: str,
    priority: str = "high",
    due_hours: int = 2,
) -> Task:
    due_at = datetime.utcnow() + timedelta(hours=due_hours)
    task = Task(
        lead_id=lead.id,
        title=f"Follow up with {lead.lead_score.upper()} lead",
        description=f"AI classified this lead as {lead.lead_score.upper()}. Contact them promptly.",
        task_type="call",
        assigned_to=agent_id,
        due_at=due_at,
        priority=priority,
        status="pending",
        created_by=agent_id,
    )
    db.add(task)
    return task


async def handle_hot_warm_automation(
    db: AsyncSession,
    lead: Lead,
    contact: Contact,
    analysis: dict,
) -> dict:
    """
    Triggered when a lead is classified as HOT or WARM after AI analysis.
    Steps:
      1. Send WhatsApp via existing integration
      2. Assign to available caller
      3. Create follow-up task
      4. Log activity events
      5. Update lead status fields
    Returns summary of actions taken.
    """
    score_label = lead.lead_score  # "hot" or "warm"
    numeric_score = analysis.get("numeric_score", 0)
    actions_taken = []

    # ── 1. Send WhatsApp ────────────────────────────────────────────────────────
    try:
        from app.services.services import send_whatsapp, WHATSAPP_TEMPLATES

        # Use existing templates; add new ones if needed
        template = "follow_up"
        if score_label == "hot":
            template = "welcome_new_lead"
        variables = {
            "name": contact.name,
            "agent_name": "Team Propello",
            "score": score_label.upper(),
        }
        wa_result = await send_whatsapp(
            to_phone=contact.phone,
            template=template,
            variables=variables,
            db=db,
            lead_id=lead.id,
            contact_id=contact.id,
        )
        if wa_result.get("sent"):
            lead.whatsapp_status = "sent"
            actions_taken.append("whatsapp_sent")

            # Log specific auto-sent activity
            await _log_activity(
                db, lead,
                activity_type="whatsapp_auto_sent",
                title=f"WhatsApp auto-sent to {score_label.upper()} lead",
                description=wa_result.get("message", ""),
                meta={"trigger": "ai_classification", "score": score_label, "template": template},
            )
    except Exception as e:
        logger.error(f"WhatsApp auto-send failed for lead {lead.id}: {e}")

    # ── 2. Assign to available caller ──────────────────────────────────────────
    assignee: Optional[Agent] = None
    try:
        assignee = await _get_available_caller(db)
        if assignee and lead.assigned_to != assignee.id:
            old_assignee = lead.assigned_to
            lead.assigned_to = assignee.id
            actions_taken.append(f"assigned_to:{assignee.name}")

            await _log_activity(
                db, lead,
                activity_type="assignment_update",
                title=f"Lead auto-assigned to {assignee.name}",
                description=f"AI classified as {score_label.upper()} (score {numeric_score}). Auto-assigned to {assignee.name}.",
                performed_by=assignee.id,
                meta={"previous_assignee": old_assignee, "new_assignee": assignee.id, "trigger": "ai_classification"},
            )

            # Notify the agent
            from app.services.lead_service import create_notification
            await create_notification(
                db,
                assignee.id,
                title=f"New {score_label.upper()} lead assigned: {contact.name}",
                body=f"AI scored this lead {score_label.upper()} ({numeric_score}/100). Contact immediately.",
                notif_type="new_lead",
                link=f"/leads/{lead.id}",
            )
        elif lead.assigned_to:
            assignee = await db.get(Agent, lead.assigned_to)
    except Exception as e:
        logger.error(f"Auto-assign failed for lead {lead.id}: {e}")

    # ── 3. Create follow-up task ────────────────────────────────────────────────
    try:
        if assignee:
            due_hours = 2 if score_label == "hot" else 24
            task = await _create_followup_task(
                db, lead, assignee.id,
                priority="high" if score_label == "hot" else "normal",
                due_hours=due_hours,
            )
            lead.next_followup_date = task.due_at
            actions_taken.append("followup_task_created")

            await _log_activity(
                db, lead,
                activity_type="classified",
                title=f"Follow-up task created for {score_label.upper()} lead",
                description=f"Auto follow-up scheduled in {due_hours}h for {assignee.name}.",
                performed_by=assignee.id,
                meta={"task_due_hours": due_hours, "classification": score_label},
            )
    except Exception as e:
        logger.error(f"Task creation failed for lead {lead.id}: {e}")

    # ── 4. Log classification activity ─────────────────────────────────────────
    await _log_activity(
        db, lead,
        activity_type="classified",
        title=f"AI classified as {score_label.upper()}",
        description=(
            f"Score: {numeric_score}/100 | "
            f"Sentiment: {analysis.get('sentiment', 'N/A')} | "
            f"Intent: {analysis.get('intent_level', 'N/A')} | "
            f"Interest: {analysis.get('interest_level', 'N/A')}"
        ),
        meta={"classification": score_label, "numeric_score": numeric_score, "analysis": analysis},
    )

    lead.updated_at = datetime.utcnow()
    logger.info(f"HOT/WARM automation complete for lead {lead.id}: {actions_taken}")
    return {"actions": actions_taken, "score": score_label, "assignee": assignee.name if assignee else None}


async def schedule_cold_retry(db: AsyncSession, lead: Lead) -> Optional[datetime]:
    """
    Schedule the next AI callback retry for a COLD lead.
    Respects retry 1→24h, retry 2→3d, retry 3→7d.
    After max retries: marks lead as Lost.
    Returns the scheduled next_call_date, or None if max retries reached.
    """
    current_retry = lead.retry_count

    if current_retry >= MAX_RETRIES:
        # Max retries reached → mark as Lost
        lead.max_retries_reached = True
        lead.stage = "lost"
        lead.lost_reason = "No interest after maximum AI call retries"
        lead.updated_at = datetime.utcnow()

        await _log_activity(
            db, lead,
            activity_type="classified",
            title="Lead marked Lost — max retries reached",
            description=f"After {MAX_RETRIES} AI call retries, lead showed no interest. Status set to Lost.",
            meta={"retry_count": current_retry, "max_retries": MAX_RETRIES},
        )
        logger.info(f"Lead {lead.id} marked Lost after {MAX_RETRIES} cold retries")
        return None

    delay_days = COLD_RETRY_DELAYS[current_retry]
    next_date = datetime.utcnow() + timedelta(days=delay_days)
    lead.next_call_date = next_date
    lead.updated_at = datetime.utcnow()

    await _log_activity(
        db, lead,
        activity_type="retry_scheduled",
        title=f"Cold retry #{current_retry + 1} scheduled",
        description=f"Lead is COLD. Retry #{current_retry + 1} AI call scheduled in {delay_days} day(s) on {next_date.strftime('%b %d, %Y')}.",
        meta={"retry_number": current_retry + 1, "delay_days": delay_days, "next_call_date": next_date.isoformat()},
    )

    logger.info(f"Cold retry #{current_retry + 1} scheduled for lead {lead.id} on {next_date}")
    return next_date


async def execute_cold_retries(db: AsyncSession) -> int:
    """
    Job: find all COLD leads whose next_call_date has passed and trigger re-analysis.
    Called by the scheduler every hour.
    Returns count of leads processed.
    """
    now = datetime.utcnow()
    result = await db.execute(
        select(Lead).where(
            Lead.lead_score == "cold",
            Lead.next_call_date <= now,
            Lead.next_call_date.isnot(None),
            Lead.max_retries_reached == False,
            Lead.stage.notin_(["won", "lost"]),
        )
    )
    leads = result.scalars().all()
    count = 0

    for lead in leads:
        try:
            contact = await db.get(Contact, lead.contact_id)
            if not contact:
                continue

            # Increment retry count
            lead.retry_count += 1
            lead.last_ai_call_date = now
            lead.next_call_date = None  # Clear until next retry is scheduled

            # Log retry attempt
            await _log_activity(
                db, lead,
                activity_type="ai_call_completed",
                title=f"AI retry call #{lead.retry_count}",
                description=f"Cold lead retry call #{lead.retry_count} initiated.",
                meta={"retry_count": lead.retry_count},
            )

            # Re-run AI analysis
            from app.services.ai_analyzer import analyze_lead
            analysis = await analyze_lead(db, lead, contact)

            if analysis:
                new_score = analysis.get("score", "cold")

                if new_score in ("hot", "warm"):
                    # Interest detected — trigger HOT/WARM automation
                    logger.info(f"Cold lead {lead.id} upgraded to {new_score} after retry #{lead.retry_count}")
                    await handle_hot_warm_automation(db, lead, contact, analysis)
                else:
                    # Still cold — schedule next retry or mark lost
                    await schedule_cold_retry(db, lead)

            count += 1
        except Exception as e:
            logger.error(f"Cold retry execution failed for lead {lead.id}: {e}")

    if count > 0:
        await db.commit()
        logger.info(f"Cold retry job: processed {count} leads")

    return count
