from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, case
from datetime import datetime, timedelta
from app.models.models import Property, Activity, Task, Notification
from app.models.lead import Lead
from app.models.agent import Agent
from app.models.contact import Contact
from app.core.config import settings
import httpx
import re


# ─── PROPERTY MATCH SERVICE ──────────────────────────────────────────────────

async def find_matching_properties(
    db: AsyncSession,
    budget_min: Optional[float],
    budget_max: Optional[float],
    property_type: Optional[str],
    location: Optional[str],
    limit: int = 5,
) -> List[Property]:
    """Find properties matching a lead's requirements."""
    query = select(Property).where(Property.status == "available")

    if budget_max:
        query = query.where(Property.price <= budget_max * 1.1)  # 10% flex
    if budget_min:
        query = query.where(Property.price >= budget_min * 0.9)
    if property_type:
        query = query.where(Property.type == property_type)
    if location:
        query = query.where(
            Property.locality.ilike(f"%{location}%") |
            Property.city.ilike(f"%{location}%")
        )

    query = query.order_by(Property.created_at.desc()).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


# ─── WHATSAPP SERVICE ────────────────────────────────────────────────────────

WHATSAPP_TEMPLATES = {
    "site_visit_confirmation": "Hi {name}, your site visit is confirmed for {date} at {time}. Our agent {agent_name} will meet you there. See you soon! 🏠",
    "follow_up": "Hi {name}, this is {agent_name} from Propello. Just checking in — have you had a chance to think about the properties we discussed? Happy to answer any questions. 😊",
    "new_listing_alert": "Hi {name}, a new {property_type} just listed in {location} at ₹{price}. It matches your requirements. Shall I share the brochure? 🏡",
    "brochure_send": "Hi {name}, as promised here's more info about {property_name}. Feel free to reach out with any questions!",
    "general_followup": "Hi {name}, just following up from our previous conversation. Are you still looking for a property? We have some great new options. Let me know if you'd like to schedule a call. 📞",
    "visit_reminder_24h": "Hi {name}, friendly reminder — your site visit is tomorrow! Our agent {agent_name} will be there to show you around. Looking forward to seeing you! 🏗️",
    "post_visit_feedback": "Hi {name}, thank you for visiting! We'd love to hear your thoughts. How did you find the property? Any questions? Your agent {agent_name} is here to help. 💬",
    "dormant_reengagement": "Hi {name}, it's been a while since we last connected! We have some exciting new listings that match your preferences. Would you like to schedule a quick call? No pressure — just keeping you in the loop. 🌟",
    "welcome_new_lead": "Hi {name}, welcome to Propello! 🎉 I'm {agent_name}, your dedicated property advisor. I'll be helping you find the perfect home. Let's schedule a quick call to understand your needs better!",
    # Internal agent templates
    "agent_new_lead": "🔔 New {score} lead: {name} | Budget: {budget} | Location: {location} | Source: {source}. Contact within 24h.",
    "agent_task_reminder": "⚡ Task due: {task_title}. Lead: {name}. Priority: {priority}.",
    "agent_stage_update": "📊 Lead update: {name} moved to {stage}. Score: {score}.",
}


async def send_whatsapp(
    to_phone: str,
    template: str,
    variables: dict,
    db: AsyncSession,
    lead_id: str,
    contact_id: str,
    agent_id: Optional[str] = None,
):
    """Send WhatsApp message via configured provider and log activity."""
    message_body = WHATSAPP_TEMPLATES.get(template, variables.get("custom_message", ""))
    for key, value in variables.items():
        message_body = message_body.replace(f"{{{key}}}", str(value))

    sent, error = await send_whatsapp_text(to_phone=to_phone, message_body=message_body)

    # Always log the activity regardless of send status
    from app.services.lead_service import log_activity
    await log_activity(
        db=db,
        lead_id=lead_id,
        contact_id=contact_id,
        activity_type="whatsapp",
        title=f"WhatsApp sent: {template}",
        description=message_body,
        outcome="sent" if sent else f"failed: {error}",
        performed_by=agent_id,
        meta={"template": template, "sent": sent},
    )

    return {"sent": sent, "message": message_body, "error": error}


def _normalize_phone_for_whatsapp(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    if not digits:
        return ""

    # If phone includes country code already, keep it. Else prefix default country code.
    cc = settings.WHATSAPP_DEFAULT_COUNTRY_CODE.strip("+") or "91"
    if digits.startswith(cc):
        return digits
    if len(digits) == 10:
        return f"{cc}{digits}"
    return digits


async def send_whatsapp_text(to_phone: str, message_body: str) -> tuple[bool, Optional[str]]:
    """Send plain WhatsApp text message using WATI first, then Twilio fallback."""
    sent = False
    error = None
    normalized = _normalize_phone_for_whatsapp(to_phone)

    if not normalized:
        return False, "Invalid phone number"

    # WATI primary provider
    if settings.WATI_API_KEY and settings.WATI_BASE_URL:
        try:
            wati_url = settings.WATI_BASE_URL.rstrip("/")
            auth_value = settings.WATI_API_KEY.strip()
            if not auth_value.lower().startswith("bearer "):
                auth_value = f"Bearer {auth_value}"

            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    f"{wati_url}/api/v1/sendSessionMessage/{normalized}",
                    headers={
                        "Authorization": auth_value,
                        "Content-Type": "application/json",
                    },
                    json={"messageText": message_body},
                )

            sent = response.status_code in (200, 201, 202)
            if sent:
                return True, None
            error = f"WATI {response.status_code}: {response.text[:200]}"
        except Exception as e:
            error = f"WATI error: {e}"

    # Twilio fallback provider
    if settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json",
                    auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN),
                    data={
                        "From": settings.TWILIO_WHATSAPP_FROM,
                        "To": f"whatsapp:+{normalized}",
                        "Body": message_body,
                    },
                )
            sent = response.status_code == 201
            if sent:
                return True, None
            return False, f"Twilio {response.status_code}: {response.text[:200]}"
        except Exception as e:
            return False, f"Twilio error: {e}"

    return False, error or "No WhatsApp provider configured (set WATI or Twilio env vars)"


# ─── ANALYTICS SERVICE ───────────────────────────────────────────────────────

async def get_summary(db: AsyncSession, days: int = 30) -> dict:
    from_date = datetime.utcnow() - timedelta(days=days)

    total = await db.execute(select(func.count(Lead.id)))
    total_count = total.scalar()

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0)
    new_today = await db.execute(
        select(func.count(Lead.id)).where(Lead.created_at >= today_start)
    )

    hot = await db.execute(
        select(func.count(Lead.id)).where(Lead.lead_score == "hot", Lead.stage.notin_(["won", "lost"]))
    )

    won = await db.execute(
        select(func.count(Lead.id)).where(Lead.stage == "won", Lead.updated_at >= from_date)
    )

    lost = await db.execute(
        select(func.count(Lead.id)).where(Lead.stage == "lost", Lead.updated_at >= from_date)
    )

    pipeline_value = await db.execute(
        select(func.sum(Lead.budget_max))
        .where(Lead.stage.notin_(["won", "lost", "nurture"]))
        .where(Lead.budget_max.isnot(None))
    )

    return {
        "total_leads": total_count or 0,
        "new_leads_today": new_today.scalar() or 0,
        "hot_leads": hot.scalar() or 0,
        "won_this_month": won.scalar() or 0,
        "lost_this_month": lost.scalar() or 0,
        "pipeline_value": float(pipeline_value.scalar() or 0),
    }


async def get_funnel(db: AsyncSession) -> List[dict]:
    stages = ["new", "contacted", "site_visit_scheduled", "site_visit_done", "negotiation", "won", "lost"]
    result = await db.execute(
        select(Lead.stage, func.count(Lead.id).label("count"))
        .where(Lead.stage.in_(stages))
        .group_by(Lead.stage)
    )
    counts = {row[0]: row[1] for row in result.all()}
    total = sum(counts.values()) or 1

    return [
        {
            "stage": stage,
            "count": counts.get(stage, 0),
            "percentage": round((counts.get(stage, 0) / total) * 100, 1),
        }
        for stage in stages
    ]


async def get_source_stats(db: AsyncSession) -> List[dict]:
    result = await db.execute(
        select(
            Lead.source,
            func.count(Lead.id).label("count"),
            func.sum(case((Lead.stage == "won", 1), else_=0)).label("won"),
        ).group_by(Lead.source)
    )
    rows = result.all()
    return [
        {
            "source": r[0],
            "count": r[1],
            "won": r[2] or 0,
            "conversion_rate": round((r[2] or 0) / r[1] * 100, 1) if r[1] > 0 else 0,
        }
        for r in rows
    ]


async def get_agent_stats(db: AsyncSession) -> List[dict]:
    result = await db.execute(
        select(
            Agent.id,
            Agent.name,
            func.count(Lead.id).label("total_leads"),
            func.sum(case((Lead.stage == "won", 1), else_=0)).label("won"),
        )
        .outerjoin(Lead, Lead.assigned_to == Agent.id)
        .where(Agent.is_active == True)
        .group_by(Agent.id, Agent.name)
    )
    rows = result.all()

    stats = []
    for r in rows:
        tasks_done = await db.execute(
            select(func.count(Task.id))
            .where(Task.assigned_to == r[0], Task.status == "done")
        )
        stats.append({
            "agent_id": r[0],
            "agent_name": r[1],
            "total_leads": r[2] or 0,
            "won": r[3] or 0,
            "tasks_done": tasks_done.scalar() or 0,
            "conversion_rate": round((r[3] or 0) / (r[2] or 1) * 100, 1),
        })

    return sorted(stats, key=lambda x: x["won"], reverse=True)
