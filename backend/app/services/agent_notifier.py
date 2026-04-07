"""
Agent WhatsApp Notifier
-----------------------
Sends WhatsApp notifications to agents/managers about new leads,
task assignments, stage changes, escalations, and daily digests.
"""
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.config import settings
from app.models.agent import Agent
from app.models.lead import Lead
from app.models.contact import Contact
from app.models.models import Task
from app.services.services import send_whatsapp_text
import logging

logger = logging.getLogger(__name__)


async def _send_agent_whatsapp(phone: str, message: str) -> bool:
    """Send a WhatsApp message to an agent's personal number via configured provider."""
    if not phone:
        logger.info(f"[AgentWA Mock] To: {phone}\n{message}")
        return False

    try:
        sent, error = await send_whatsapp_text(to_phone=phone, message_body=message)
        if not sent and error:
            logger.error(f"Agent WhatsApp failed: {error}")
        return sent
    except Exception as e:
        logger.error(f"Agent WhatsApp send error: {e}")
        return False


async def notify_agent_new_lead(db: AsyncSession, agent: Agent, lead: Lead, contact: Contact):
    """Notify an agent about a new lead assignment."""
    budget_str = ""
    if lead.budget_min or lead.budget_max:
        bmin = f"₹{lead.budget_min/100000:.0f}L" if lead.budget_min else "?"
        bmax = f"₹{lead.budget_max/100000:.0f}L" if lead.budget_max else "?"
        budget_str = f"Budget: {bmin}–{bmax}"

    message = (
        f"🔔 *New {lead.lead_score.upper()} Lead Assigned*\n\n"
        f"👤 {contact.name}\n"
        f"📞 {contact.phone}\n"
        f"📍 {lead.location_preference or 'Not specified'}\n"
        f"💰 {budget_str or 'Budget not specified'}\n"
        f"📲 Source: {lead.source.replace('_', ' ').title()}\n\n"
        f"⏰ Please contact within 24 hours.\n"
        f"Open CRM: {settings.FRONTEND_URL}/leads/{lead.id}"
    )

    if agent.phone:
        await _send_agent_whatsapp(agent.phone, message)


async def notify_agent_task_due(db: AsyncSession, agent: Agent, task: Task):
    """Notify an agent about an upcoming/overdue task."""
    message = (
        f"⚡ *Task {'Overdue' if task.status == 'overdue' else 'Due Soon'}*\n\n"
        f"📋 {task.title}\n"
        f"🔴 Priority: {task.priority.upper()}\n"
        f"📅 Due: {task.due_at.strftime('%b %d, %I:%M %p') if task.due_at else 'N/A'}\n\n"
        f"Open CRM: {settings.FRONTEND_URL}/leads/{task.lead_id}"
    )

    if agent.phone:
        await _send_agent_whatsapp(agent.phone, message)


async def notify_agent_stage_change(
    db: AsyncSession, agent: Agent, lead: Lead, contact: Contact,
    old_stage: str, new_stage: str
):
    """Notify an agent about a lead stage change."""
    stage_emoji = {
        "new": "🆕", "contacted": "📞", "site_visit_scheduled": "📅",
        "site_visit_done": "✅", "negotiation": "🤝", "won": "🏆", "lost": "❌", "nurture": "🌱"
    }
    emoji = stage_emoji.get(new_stage, "📊")

    message = (
        f"{emoji} *Lead Stage Update*\n\n"
        f"👤 {contact.name}\n"
        f"📊 {old_stage.replace('_', ' ').title()} → *{new_stage.replace('_', ' ').title()}*\n"
        f"🔥 Score: {lead.lead_score.upper()}\n\n"
        f"Open CRM: {settings.FRONTEND_URL}/leads/{lead.id}"
    )

    if agent.phone:
        await _send_agent_whatsapp(agent.phone, message)


async def notify_manager_escalation(db: AsyncSession, lead: Lead, contact: Contact, reason: str):
    """Escalate to all managers when a lead needs attention."""
    result = await db.execute(
        select(Agent).where(Agent.role.in_(["admin", "manager"]), Agent.is_active == True)
    )
    managers = result.scalars().all()

    message = (
        f"⚠️ *Lead Escalation*\n\n"
        f"👤 {contact.name} ({lead.lead_score.upper()})\n"
        f"📌 Reason: {reason}\n"
        f"📊 Stage: {lead.stage.replace('_', ' ').title()}\n"
        f"📅 Days in stage: {lead.days_in_stage}\n\n"
        f"Open CRM: {settings.FRONTEND_URL}/leads/{lead.id}"
    )

    for mgr in managers:
        if mgr.phone:
            await _send_agent_whatsapp(mgr.phone, message)


async def send_daily_digest(db: AsyncSession):
    """Send morning digest to each active agent via WhatsApp."""
    result = await db.execute(
        select(Agent).where(Agent.is_active == True, Agent.phone.isnot(None))
    )
    agents = result.scalars().all()

    for agent in agents:
        # Count pending tasks
        tasks_result = await db.execute(
            select(func.count(Task.id)).where(
                Task.assigned_to == agent.id,
                Task.status.in_(["pending", "overdue"]),
            )
        )
        task_count = tasks_result.scalar() or 0

        # Count overdue tasks
        overdue_result = await db.execute(
            select(func.count(Task.id)).where(
                Task.assigned_to == agent.id,
                Task.status == "overdue",
            )
        )
        overdue_count = overdue_result.scalar() or 0

        # Count hot leads
        hot_result = await db.execute(
            select(func.count(Lead.id)).where(
                Lead.assigned_to == agent.id,
                Lead.lead_score == "hot",
                Lead.stage.notin_(["won", "lost"]),
            )
        )
        hot_count = hot_result.scalar() or 0

        # Count total active leads
        active_result = await db.execute(
            select(func.count(Lead.id)).where(
                Lead.assigned_to == agent.id,
                Lead.stage.notin_(["won", "lost"]),
            )
        )
        active_count = active_result.scalar() or 0

        message = (
            f"☀️ *Good Morning, {agent.name.split(' ')[0]}!*\n\n"
            f"Here's your day at a glance:\n\n"
            f"📋 Tasks pending: *{task_count}*" + (f" ({overdue_count} overdue ⚠️)" if overdue_count else "") + "\n"
            f"🔥 Hot leads: *{hot_count}*\n"
            f"📊 Active leads: *{active_count}*\n\n"
            f"Open CRM: {settings.FRONTEND_URL}"
        )

        await _send_agent_whatsapp(agent.phone, message)

    logger.info(f"Daily digest sent to {len(agents)} agents")
