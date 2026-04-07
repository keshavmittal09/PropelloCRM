"""
Follow-Up Engine (Drip Campaign Orchestrator)
----------------------------------------------
Creates and executes automated follow-up sequences for leads based on
triggers like new_lead, stage_change, no_response, visit reminders, etc.
"""
from datetime import datetime, timedelta
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.followup import FollowUp
from app.models.lead import Lead
from app.models.contact import Contact
from app.models.agent import Agent
from app.services.email_service import send_email
from app.services.lead_service import log_activity, create_notification
import logging

logger = logging.getLogger(__name__)


# ─── SEQUENCE DEFINITIONS ────────────────────────────────────────────────────

SEQUENCES = {
    "new_lead": [
        {"channel": "whatsapp", "template": "follow_up", "delay_minutes": 15, "label": "15-min WhatsApp follow-up"},
        {"channel": "email", "template": "welcome", "delay_minutes": 15, "label": "15-min welcome email"},
        {"channel": "call", "template": None, "delay_minutes": 15, "label": "15-min call task"},
    ],
    "site_visit_scheduled": [
        {"channel": "whatsapp", "template": "site_visit_confirmation", "delay_hours": 0, "label": "Visit confirmation WhatsApp"},
        {"channel": "email", "template": "visit_confirmation", "delay_hours": 0, "label": "Visit confirmation email"},
    ],
    "visit_reminder": [
        {"channel": "whatsapp", "template": "general_followup", "delay_hours": 0, "label": "Visit reminder WhatsApp (24h before)"},
        {"channel": "email", "template": "visit_reminder", "delay_hours": 0, "label": "Visit reminder email"},
    ],
    "site_visit_done": [
        {"channel": "whatsapp", "template": "follow_up", "delay_hours": 4, "label": "Post-visit feedback WhatsApp"},
        {"channel": "email", "template": "post_visit", "delay_hours": 6, "label": "Post-visit feedback email"},
        {"channel": "whatsapp", "template": "general_followup", "delay_hours": 72, "label": "3-day follow-up WhatsApp"},
    ],
    "no_response": [
        {"channel": "whatsapp", "template": "general_followup", "delay_hours": 0, "label": "Re-engagement WhatsApp"},
        {"channel": "email", "template": "reengagement", "delay_hours": 24, "label": "Re-engagement email"},
    ],
    "reengagement": [
        {"channel": "whatsapp", "template": "new_listing_alert", "delay_hours": 0, "label": "New listing WhatsApp"},
        {"channel": "email", "template": "reengagement", "delay_hours": 48, "label": "Re-engagement email"},
    ],
}


async def schedule_followup_sequence(
    db: AsyncSession,
    lead_id: str,
    contact_id: str,
    trigger: str,
    agent_id: Optional[str] = None,
    base_time: Optional[datetime] = None,
):
    """
    Creates a sequence of follow-up records based on the trigger.
    Each follow-up has a scheduled_at time calculated from base_time + delay.
    """
    sequence = SEQUENCES.get(trigger, [])
    if not sequence:
        logger.warning(f"No follow-up sequence defined for trigger: {trigger}")
        return

    base = base_time or datetime.utcnow()

    for step in sequence:
        delay_hours = step.get("delay_hours", 0)
        delay_minutes = step.get("delay_minutes", 0)
        scheduled = base + timedelta(hours=delay_hours, minutes=delay_minutes)

        followup = FollowUp(
            lead_id=lead_id,
            contact_id=contact_id,
            agent_id=agent_id,
            channel=step["channel"],
            template=step.get("template"),
            scheduled_at=scheduled,
            status="pending",
            triggered_by=trigger if trigger in (
                "new_lead", "stage_change", "no_response", "visit_reminder",
                "post_visit", "reengagement", "manual", "ai_recommendation"
            ) else "manual",
        )
        db.add(followup)

    await db.flush()
    logger.info(f"Scheduled {len(sequence)} follow-ups for lead {lead_id} (trigger={trigger})")


async def execute_pending_followups(db: AsyncSession) -> int:
    """
    Called by the scheduler every 15 minutes.
    Finds follow-ups whose scheduled_at has passed and executes them.
    """
    now = datetime.utcnow()
    result = await db.execute(
        select(FollowUp)
        .where(FollowUp.status == "pending", FollowUp.scheduled_at <= now)
        .order_by(FollowUp.scheduled_at.asc())
        .limit(50)
    )
    pending = result.scalars().all()
    executed_count = 0

    for followup in pending:
        try:
            lead = await db.get(Lead, followup.lead_id)
            contact = await db.get(Contact, followup.contact_id) if followup.contact_id else None

            if not lead or not contact:
                followup.status = "failed"
                continue

            # Skip if lead is already won/lost
            if lead.stage in ("won", "lost"):
                followup.status = "cancelled"
                continue

            # Get agent info for templates
            agent = await db.get(Agent, followup.agent_id) if followup.agent_id else None
            agent_name = agent.name if agent else "Team Propello"

            variables = {
                "name": contact.name,
                "agent_name": agent_name,
                "phone": contact.phone,
            }

            if followup.channel == "whatsapp":
                from app.services.services import send_whatsapp
                await send_whatsapp(
                    to_phone=contact.phone,
                    template=followup.template or "general_followup",
                    variables=variables,
                    db=db,
                    lead_id=followup.lead_id,
                    contact_id=contact.id,
                    agent_id=followup.agent_id,
                )
                followup.status = "sent"

            elif followup.channel == "email" and contact.email:
                await send_email(
                    to_email=contact.email,
                    template=followup.template or "custom",
                    variables=variables,
                    db=db,
                    lead_id=followup.lead_id,
                    contact_id=contact.id,
                    agent_id=followup.agent_id,
                )
                followup.status = "sent"

            elif followup.channel == "call":
                # Create a call task for the agent
                from app.services.lead_service import create_auto_task
                await create_auto_task(
                    db, followup.lead_id,
                    title=f"Follow-up call with {contact.name}",
                    task_type="call",
                    assigned_to=followup.agent_id,
                    hours_from_now=0,
                    priority="high",
                )
                followup.status = "sent"

            elif followup.channel == "in_app" and followup.agent_id:
                await create_notification(
                    db, followup.agent_id,
                    title=f"Follow-up reminder: {contact.name}",
                    body=followup.message_body or f"Time to follow up with {contact.name}",
                    notif_type="reminder",
                    link=f"/leads/{followup.lead_id}",
                )
                followup.status = "sent"

            else:
                followup.status = "failed"

            followup.executed_at = now
            executed_count += 1

        except Exception as e:
            logger.error(f"Failed to execute follow-up {followup.id}: {e}")
            followup.status = "failed"
            followup.executed_at = now

    await db.commit()
    if executed_count > 0:
        logger.info(f"Executed {executed_count}/{len(pending)} follow-ups")
    return executed_count


async def cancel_pending_followups(db: AsyncSession, lead_id: str):
    """Cancel all pending follow-ups for a lead (e.g., when marked won/lost)."""
    result = await db.execute(
        select(FollowUp).where(
            FollowUp.lead_id == lead_id,
            FollowUp.status == "pending",
        )
    )
    pending = result.scalars().all()
    for f in pending:
        f.status = "cancelled"
    await db.flush()
    if pending:
        logger.info(f"Cancelled {len(pending)} pending follow-ups for lead {lead_id}")
