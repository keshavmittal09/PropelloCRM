"""
AI Lead Analysis Engine
-----------------------
Uses Groq's LLM (same one Priya uses) to intelligently analyze leads.
Generates: score, recommended action, priority, engagement summary, risk flags.
"""
from datetime import datetime
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.config import settings
from app.models.lead import Lead
from app.models.contact import Contact
from app.models.models import Activity
import json
import logging
import httpx

logger = logging.getLogger(__name__)

ANALYSIS_SYSTEM_PROMPT = """You are an expert real estate CRM lead analyst. Analyze the lead data provided and return a JSON object with exactly these fields:

{
  "score": "hot" | "warm" | "cold",
  "score_reasoning": "1-2 sentence explanation of why this score",
  "recommended_action": "Specific next action the sales agent should take",
  "priority": "high" | "normal" | "low",
  "engagement_summary": "1-line human-readable assessment of this lead",
  "risk_flags": ["list of risk factors, empty if none"],
  "estimated_close_probability": 0-100,
  "suggested_followup_channel": "whatsapp" | "call" | "email" | "site_visit"
}

Scoring rules:
- HOT: Budget confirmed ≥50L, timeline immediate/1 month, has responded to calls, or has scheduled/done site visit
- WARM: Has budget info but longer timeline, or has engaged but not yet committed
- COLD: No budget info, no timeline, exploring only, or no response to outreach

Risk flags to check:
- No activity for 3+ days on a hot/warm lead
- Budget doesn't match available inventory price range
- Multiple calls with no progression in stage
- Lead has been in same stage for 7+ days
- No phone number or invalid contact info

Return ONLY the raw JSON. No markdown, no explanation outside the JSON."""


FOLLOWUP_SYSTEM_PROMPT = """You are Priya, the AI assistant for Propello Real Estate. Generate a personalized {channel} follow-up message for a buyer.

Rules:
- Be warm, professional, and conversational — not salesy
- Reference specific details about their requirements (budget, location, property type)
- If they've visited a property, ask for feedback
- If they've gone quiet, gently re-engage without pressure
- Keep WhatsApp messages under 160 words
- Keep email messages under 250 words with a clear subject line
- Use Indian English, casual but respectful tone
- Sign off as the assigned agent's name, or "Team Propello" if no agent

Return ONLY the message text. For email, format as:
Subject: [subject line]
---
[email body]"""


async def _call_groq(system_prompt: str, user_content: str, expect_json: bool = False) -> Optional[str]:
    """Call Groq's LLM API using httpx (OpenAI-compatible endpoint)."""
    if not settings.GROQ_API_KEY:
        logger.warning("GROQ_API_KEY not configured — AI analysis skipped")
        return None

    try:
        payload = {
            "model": settings.GROQ_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0.3,
            "max_tokens": 500,
        }
        if expect_json:
            payload["response_format"] = {"type": "json_object"}

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        logger.error(f"Groq API call failed: {e}")
        return None


def _build_lead_context(lead: Lead, contact: Contact, activities: list) -> str:
    """Build a rich context string for the AI to analyze."""
    lines = []
    lines.append(f"LEAD ANALYSIS REQUEST")
    lines.append(f"====================")
    lines.append(f"Contact: {contact.name} | Phone: {contact.phone} | Email: {contact.email or 'N/A'}")
    lines.append(f"Source: {lead.source} | Stage: {lead.stage} | Current Score: {lead.lead_score}")
    lines.append(f"Days in current stage: {lead.days_in_stage}")
    lines.append(f"Total calls: {lead.call_count}")

    if lead.budget_min or lead.budget_max:
        bmin = f"₹{lead.budget_min/100000:.0f}L" if lead.budget_min else "N/A"
        bmax = f"₹{lead.budget_max/100000:.0f}L" if lead.budget_max else "N/A"
        lines.append(f"Budget: {bmin} – {bmax}")
    else:
        lines.append(f"Budget: NOT PROVIDED")

    lines.append(f"Property type interest: {lead.property_type_interest or 'NOT PROVIDED'}")
    lines.append(f"Location preference: {lead.location_preference or 'NOT PROVIDED'}")
    lines.append(f"Timeline: {lead.timeline or 'NOT PROVIDED'}")
    lines.append(f"Priority: {lead.priority}")

    if lead.last_contacted_at:
        days_since = (datetime.utcnow() - lead.last_contacted_at).days
        lines.append(f"Last contacted: {days_since} day(s) ago")
    else:
        lines.append(f"Last contacted: NEVER")

    if lead.lost_reason:
        lines.append(f"Lost reason: {lead.lost_reason}")

    if contact.personal_notes:
        lines.append(f"\nPersonal notes: {contact.personal_notes}")

    if activities:
        lines.append(f"\nRECENT ACTIVITY LOG ({len(activities)} entries):")
        for act in activities[:8]:
            date_str = act.performed_at.strftime("%b %d %H:%M")
            lines.append(f"  [{date_str}] {act.type}: {act.title}" + (f" → {act.outcome}" if act.outcome else ""))

    return "\n".join(lines)


async def analyze_lead(db: AsyncSession, lead: Lead, contact: Contact) -> Optional[dict]:
    """
    Run AI analysis on a single lead.
    Returns the structured analysis dict or None if AI is unavailable.
    """
    # Fetch recent activities
    result = await db.execute(
        select(Activity)
        .where(Activity.lead_id == lead.id)
        .order_by(Activity.performed_at.desc())
        .limit(10)
    )
    activities = result.scalars().all()

    context = _build_lead_context(lead, contact, activities)
    raw_response = await _call_groq(ANALYSIS_SYSTEM_PROMPT, context, expect_json=True)

    if not raw_response:
        logger.warning("AI analysis skipped for lead %s: no Groq response", lead.id)
        return None

    try:
        # Strip markdown code fences if present
        cleaned = raw_response.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        analysis = json.loads(cleaned)

        # Apply the AI's recommendations back to the lead
        if analysis.get("score") in ("hot", "warm", "cold"):
            lead.lead_score = analysis["score"]
        if analysis.get("priority") in ("high", "normal", "low"):
            lead.priority = analysis["priority"]

        lead.ai_analysis = analysis
        lead.ai_analyzed_at = datetime.utcnow()
        await db.flush()

        logger.info(f"AI analyzed lead {lead.id}: score={analysis.get('score')}, priority={analysis.get('priority')}")
        return analysis

    except (json.JSONDecodeError, KeyError) as e:
        logger.error(f"Failed to parse AI analysis response: {e}\nRaw: {raw_response[:500]}")
        return None


async def batch_analyze(db: AsyncSession, limit: int = 50) -> int:
    """Re-analyze all active leads that haven't been scored in 24h."""
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(hours=24)

    result = await db.execute(
        select(Lead)
        .where(
            Lead.stage.notin_(["won", "lost"]),
            (Lead.ai_analyzed_at.is_(None)) | (Lead.ai_analyzed_at < cutoff),
        )
        .order_by(Lead.updated_at.desc())
        .limit(limit)
    )
    leads = result.scalars().all()
    count = 0

    for lead in leads:
        contact = await db.get(Contact, lead.contact_id)
        if contact:
            analysis = await analyze_lead(db, lead, contact)
            if analysis:
                count += 1

    await db.commit()
    logger.info(f"Batch AI analysis complete: {count}/{len(leads)} leads analyzed")
    return count


async def suggest_followup_message(
    db: AsyncSession,
    lead: Lead,
    contact: Contact,
    channel: str = "whatsapp",
    agent_name: str = "Team Propello",
) -> Optional[str]:
    """Generate a personalized follow-up message using AI."""
    result = await db.execute(
        select(Activity)
        .where(Activity.lead_id == lead.id)
        .order_by(Activity.performed_at.desc())
        .limit(5)
    )
    activities = result.scalars().all()

    context = _build_lead_context(lead, contact, activities)
    context += f"\n\nAgent name: {agent_name}"
    context += f"\nChannel: {channel}"

    prompt = FOLLOWUP_SYSTEM_PROMPT.replace("{channel}", channel)
    message = await _call_groq(prompt, context)
    if message:
        return message
    return None
