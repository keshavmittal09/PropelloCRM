"""
Campaign AI Analyzer
---------------------
Uses Groq's LLM to analyze individual campaign calls and generate deep insights.
Only processes connected calls (with real transcripts).
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.lead import Lead
from app.models.models import Activity
from app.services.campaign_service import _safe_str, _is_connected

import httpx

logger = logging.getLogger(__name__)

CAMPAIGN_ANALYSIS_PROMPT = """You are an expert real estate call campaign analyst. Analyze this AI agent call transcript and return a JSON object with exactly these fields:

{
  "engagement_level": "high" | "medium" | "low" | "none",
  "intent_signals": ["list of detected intent signals, e.g. 'site_visit_interest', 'price_inquiry', 'config_discussed', 'budget_mentioned'"],
  "objections": ["list of objections raised, e.g. 'busy_right_now', 'not_interested', 'already_invested', 'too_expensive'"],
  "recoverable_objection": true | false,
  "recommended_callback_time": "evening" | "morning" | "weekend" | null,
  "script_issues_detected": ["list of script problems, e.g. 'audio_loop', 'monologue_heavy', 'no_objection_handling', 'too_fast', 'no_personalization'"],
  "lead_quality_assessment": "1-2 sentence assessment of this lead's potential",
  "suggested_next_action": "Specific actionable step for the human calling agent",
  "close_probability": 0-100
}

Context:
- This is an AI agent (Niharika) from Krishna Group calling leads who visited their Credai Expo booth
- The property is a G+45 tower in Kharghar with 2/3/4 BHK options
- Goal: schedule a site visit and capture WhatsApp number for brochure
- Transcripts are in Hindi-English mix (Hinglish)

Scoring:
- HIGH engagement: Asked questions, discussed specifics, agreed to visit/callback
- MEDIUM engagement: Listened but noncommittal, asked to call back
- LOW engagement: Gave one-word answers, was rushed
- NONE: Did not engage at all

Return ONLY the raw JSON. No markdown, no explanation outside the JSON."""


async def _call_groq(system_prompt: str, user_content: str) -> Optional[str]:
    """Call Groq's LLM API."""
    if not settings.GROQ_API_KEY:
        logger.warning("GROQ_API_KEY not configured — campaign AI analysis skipped")
        return None

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    "temperature": 0.2,
                    "max_tokens": 600,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        logger.error(f"Groq API call failed for campaign analysis: {e}")
        return None


def _build_call_context(activity: Activity) -> str:
    """Build context string for a single campaign call."""
    meta = activity.meta or {}
    quality = meta.get("call_conversation_quality", {})

    lines = [
        "CAMPAIGN CALL ANALYSIS REQUEST",
        "=" * 30,
        f"Lead Name: {activity.description or 'Unknown'}",
        f"Call Eval Tag: {activity.call_eval_tag or 'N/A'}",
        f"Attempt Number: {meta.get('attempt_number', 'N/A')}",
        f"Retries: {meta.get('num_of_retries', 'N/A')}",
    ]

    if isinstance(quality, dict) and quality:
        lines.append(f"\nQuality Scores:")
        lines.append(f"  Clarity: {quality.get('clarity', 'N/A')}/10")
        lines.append(f"  Professionalism: {quality.get('professionalism', 'N/A')}/10")
        lines.append(f"  Problem Resolution: {quality.get('problem_resolution', 'N/A')}/10")
        lines.append(f"  Overall: {quality.get('overall_quality', 'N/A')}/10")

    entities = meta.get("extracted_entities", {})
    if isinstance(entities, dict) and entities:
        lines.append(f"\nExtracted Entities:")
        for k, v in entities.items():
            if v and str(v).lower() not in ("null", "none", ""):
                lines.append(f"  {k}: {v}")

    if activity.call_summary:
        lines.append(f"\nCall Summary:\n{activity.call_summary}")

    if activity.transcript:
        # Truncate very long transcripts to save tokens
        transcript = activity.transcript[:3000]
        if len(activity.transcript) > 3000:
            transcript += "\n... [transcript truncated]"
        lines.append(f"\nFull Transcript:\n{transcript}")

    return "\n".join(lines)


async def analyze_campaign_call(activity: Activity) -> Optional[dict]:
    """Analyze a single campaign call using Groq."""
    if not _is_connected(activity.transcript or ""):
        return None

    context = _build_call_context(activity)
    raw_response = await _call_groq(CAMPAIGN_ANALYSIS_PROMPT, context)

    if not raw_response:
        return None

    try:
        cleaned = raw_response.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        analysis = json.loads(cleaned)
        return analysis
    except (json.JSONDecodeError, KeyError) as e:
        logger.error(f"Failed to parse campaign AI response: {e}\nRaw: {raw_response[:500]}")
        return None


async def batch_analyze_campaign(campaign_id: str, db: AsyncSession) -> dict:
    """Run AI analysis on all connected calls in a campaign."""
    if not settings.CAMPAIGN_AI_ENABLED:
        return {"analyzed": 0, "skipped": 0, "errors": 0, "message": "Campaign AI analysis is disabled"}

    if not settings.GROQ_API_KEY:
        return {"analyzed": 0, "skipped": 0, "errors": 0, "message": "GROQ_API_KEY not configured"}

    result = await db.execute(
        select(Activity)
        .where(Activity.campaign_id == campaign_id)
        .where(Activity.type == "campaign_call")
        .order_by(Activity.performed_at.asc())
    )
    activities = result.scalars().all()

    analyzed = 0
    skipped = 0
    errors = 0

    for activity in activities:
        # Skip no-connect calls
        if not _is_connected(activity.transcript or ""):
            skipped += 1
            continue

        # Skip already-analyzed calls
        meta = activity.meta or {}
        if meta.get("ai_analysis"):
            skipped += 1
            continue

        try:
            analysis = await analyze_campaign_call(activity)
            if analysis:
                # Store AI analysis in activity meta
                updated_meta = dict(meta)
                updated_meta["ai_analysis"] = analysis
                activity.meta = updated_meta

                # Also update the lead's ai_analysis field
                lead = await db.get(Lead, activity.lead_id)
                if lead:
                    lead.ai_analysis = analysis
                    from datetime import datetime
                    lead.ai_analyzed_at = datetime.utcnow()

                analyzed += 1
            else:
                errors += 1
        except Exception as e:
            logger.error(f"Failed to analyze campaign call {activity.id}: {e}")
            errors += 1

    await db.flush()
    await db.commit()

    logger.info(f"Campaign AI analysis: {analyzed} analyzed, {skipped} skipped, {errors} errors")
    return {
        "analyzed": analyzed,
        "skipped": skipped,
        "errors": errors,
        "message": f"Analyzed {analyzed} calls successfully"
    }
