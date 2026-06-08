"""
AI Lead Analysis Engine
-----------------------
Uses Groq's LLM to intelligently analyze leads after every AI call.
Generates: numeric score (0-100), classification (hot/warm/cold), sentiment,
intent_level, interest_level, recommended_action, and risk flags.
Triggers HOT/WARM automation or COLD retry scheduling automatically.
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
  "numeric_score": 0-100,
  "score_reasoning": "1-2 sentence explanation of why this score",
  "sentiment": "positive" | "neutral" | "negative",
  "intent_level": "high" | "medium" | "low",
  "interest_level": "high" | "medium" | "low",
  "recommended_action": "Specific next action the sales agent should take",
  "priority": "high" | "normal" | "low",
  "engagement_summary": "1-line human-readable assessment of this lead",
  "risk_flags": ["list of risk factors, empty if none"],
  "estimated_close_probability": 0-100,
  "suggested_followup_channel": "whatsapp" | "call" | "email" | "site_visit"
}

Classification rules:
- HOT (score 80-100): High buying intent, requests pricing/demo, ready to speak with sales, confirmed budget ≥50L, timeline immediate/1 month
- WARM (score 50-79): Interested but needs follow-up, has budget info but longer timeline, engaged but not committed
- COLD (score 0-49): No current interest, no budget info, no timeline, exploring only, or no response to outreach

Sentiment rules:
- positive: Enthusiastic, asking questions, requesting info, positive language
- neutral: Matter-of-fact, cautious, non-committal
- negative: Reluctant, objections, not interested, rude or DND signals

Intent level:
- high: Actively looking, specific requirements, urgency, has timeline
- medium: Interested but vague, exploring
- low: Casual inquiry, no urgency, no specific needs

Interest level:
- high: Engaged in conversation, asked about price/features/visit
- medium: Responded but passive
- low: Minimal engagement, short responses, no follow-up questions

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
            "max_tokens": 600,
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
    lines.append(f"Retry count: {lead.retry_count}")

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

    if lead.last_call_summary:
        lines.append(f"\nLast call summary: {lead.last_call_summary}")

    if lead.last_call_interest:
        lines.append(f"Last call interest signal: {lead.last_call_interest}")

    if contact.personal_notes:
        lines.append(f"\nPersonal notes: {contact.personal_notes}")

    if activities:
        lines.append(f"\nRECENT ACTIVITY LOG ({len(activities)} entries):")
        for act in activities[:8]:
            date_str = act.performed_at.strftime("%b %d %H:%M")
            transcript_snippet = ""
            if act.transcript:
                transcript_snippet = f" | Transcript snippet: {act.transcript[:200]}"
            lines.append(
                f"  [{date_str}] {act.type}: {act.title}"
                + (f" → {act.outcome}" if act.outcome else "")
                + transcript_snippet
            )

    return "\n".join(lines)


async def analyze_lead(
    db: AsyncSession,
    lead: Lead,
    contact: Contact,
    transcript: Optional[str] = None,
    call_summary: Optional[str] = None,
    trigger_automation: bool = True,
) -> Optional[dict]:
    """
    Run AI analysis on a single lead after an AI call.
    Stores enriched fields on the lead, logs activity, and triggers automation.
    Returns the structured analysis dict or None if AI is unavailable.
    """
    # Store transcript/summary on lead if provided
    if transcript:
        lead.last_call_transcript = transcript
    if call_summary:
        lead.last_call_summary = call_summary

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

        # ── Apply AI recommendations to lead ─────────────────────────────────
        score = analysis.get("score")
        if score in ("hot", "warm", "cold"):
            lead.lead_score = score
        if analysis.get("priority") in ("high", "normal", "low"):
            lead.priority = analysis["priority"]

        # Store new enriched fields
        numeric_score = analysis.get("numeric_score")
        if numeric_score is not None:
            lead.call_score = int(min(max(numeric_score, 0), 100))

        lead.call_sentiment = analysis.get("sentiment")
        lead.intent_level = analysis.get("intent_level")
        lead.interest_level = analysis.get("interest_level")
        lead.ai_recommended_action = analysis.get("recommended_action")
        lead.last_ai_call_date = datetime.utcnow()
        lead.ai_analysis = analysis
        lead.ai_analyzed_at = datetime.utcnow()

        await db.flush()

        # ── Log AI analysis activity ──────────────────────────────────────────
        analysis_activity = Activity(
            lead_id=lead.id,
            contact_id=lead.contact_id,
            type="ai_analysis_generated",
            title=f"AI analysis: {score.upper()} (score {lead.call_score}/100)",
            description=(
                f"Sentiment: {lead.call_sentiment} | "
                f"Intent: {lead.intent_level} | "
                f"Interest: {lead.interest_level} | "
                f"Action: {lead.ai_recommended_action}"
            ),
            performed_at=datetime.utcnow(),
            meta={
                "score": score,
                "numeric_score": lead.call_score,
                "sentiment": lead.call_sentiment,
                "intent_level": lead.intent_level,
                "interest_level": lead.interest_level,
                "recommended_action": lead.ai_recommended_action,
                "risk_flags": analysis.get("risk_flags", []),
            },
        )
        db.add(analysis_activity)

        logger.info(f"AI analyzed lead {lead.id}: score={score}, numeric={lead.call_score}, sentiment={lead.call_sentiment}")

        # ── Trigger post-analysis automation ─────────────────────────────────
        if trigger_automation:
            try:
                from app.services.ai_workflow_service import handle_hot_warm_automation, schedule_cold_retry
                if score in ("hot", "warm"):
                    await handle_hot_warm_automation(db, lead, contact, analysis)
                elif score == "cold":
                    await schedule_cold_retry(db, lead)
            except Exception as e:
                logger.error(f"Workflow automation failed for lead {lead.id}: {e}")

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
            # Don't trigger automation during batch rescore to avoid spam
            analysis = await analyze_lead(db, lead, contact, trigger_automation=False)
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
