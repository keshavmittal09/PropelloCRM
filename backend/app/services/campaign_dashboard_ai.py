from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


LEAD_REQUIRED_FIELDS = [
    "priority_tier",
    "lead_score",
    "intent_level",
    "engagement_quality",
    "drop_reason",
    "objection_type",
    "objection_handleable",
    "recommended_action",
    "callback_urgency_hours",
    "config_interest",
    "budget_signal",
    "language_preference",
    "pitch_reached",
    "closing_attempted",
    "whatsapp_number_captured",
    "site_visit_committed",
    "site_visit_timeframe",
    "ai_detected_by_user",
    "audio_quality_issue",
    "audio_loop_detected",
    "script_issue_detected",
    "retry_time_recommendation",
    "enriched_summary",
    "key_quote",
    "sales_coach_note",
    "transcript_depth",
    "user_engagement_ratio",
]


LEAD_SYSTEM_PROMPT = (
    "You are a real estate sales intelligence system for Krishna Group, Navi Mumbai. "
    "Product: G+45 tower, Kharghar Sector 34A, 1 min from Amanora Metro. "
    "Units: 2BHK from 1.25Cr, 3BHK from 1.6Cr, 4BHK also available. "
    "Campaign context: followup calls to Credai Expo visitors. "
    "Agent name: Niharika (AI voice agent). "
    "Respond ONLY with valid JSON. No markdown and no explanation outside JSON."
)


BATCH_SYSTEM_PROMPT = (
    "You are a senior sales operations analyst. You analyze AI-processed outbound call campaign data "
    "and generate strategic insights for a real estate sales team. "
    "Be specific, data-driven, and actionable. Respond ONLY with valid JSON."
)


CHAT_SYSTEM_PROMPT = (
    "You are a real estate sales intelligence assistant embedded in Propello AI CRM. "
    "Answer questions about the current call campaign concisely and directly. "
    "When recommending leads, include name, phone number, and reason. "
    "When proposing script fixes, provide concrete Hindi/English line examples."
)


SCRIPT_SYSTEM_PROMPT = (
    "You generate personalized callback scripts for human real estate sales agents. "
    "Product: G+45 tower, Kharghar Sector 34A, Navi Mumbai, 2BHK 1.25Cr, 3BHK 1.6Cr, 1 min Amanora Metro. "
    "Be conversational, brief, and specific to the lead's situation."
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value > 0
    return _text(value).lower() in {"1", "true", "yes", "y"}


def _safe_hint_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if value is None:
        return {}
    raw = _text(value)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    except Exception:
        return {}


def _extract_whatsapp_number(text_blob: str) -> Optional[str]:
    # Captures common Indian mobile patterns with optional country code.
    candidates = re.findall(r"(?:\+?91[-\s]?)?([6-9]\d{9})", text_blob)
    return candidates[0] if candidates else None


def _infer_language(transcript: str) -> str:
    if not transcript:
        return "mixed"

    devanagari_count = len(re.findall(r"[\u0900-\u097F]", transcript))
    latin_words = len(re.findall(r"[A-Za-z]{3,}", transcript))

    if devanagari_count > 20 and latin_words <= 8:
        return "hindi"
    if devanagari_count == 0:
        return "english"
    return "mixed"


def _infer_transcript_depth(transcript: str) -> str:
    length = len(transcript)
    if length <= 80:
        return "very_short"
    if length <= 250:
        return "short"
    if length <= 700:
        return "medium"
    if length <= 1500:
        return "long"
    return "very_long"


def _infer_user_engagement_ratio(transcript: str) -> str:
    # Tries to estimate user participation from speaker markers.
    user_turns = len(re.findall(r"\b(user|customer|client|caller|lead)\b", transcript, flags=re.IGNORECASE))
    agent_turns = len(re.findall(r"\b(agent|niharika|assistant|bot|system)\b", transcript, flags=re.IGNORECASE))
    total = max(1, user_turns + agent_turns)
    ratio = user_turns / total
    if ratio >= 0.45:
        return "high"
    if ratio >= 0.22:
        return "medium"
    return "low"


def _heuristic_lead_analysis(lead: dict[str, Any]) -> dict[str, Any]:
    raise RuntimeError("Enterprise mode: preset lead-analysis fallback is disabled")

    transcript = _text(lead.get("transcript"))
    summary = _text(lead.get("summary"))
    entities = _safe_hint_dict(lead.get("extracted_entities"))
    quality = _safe_hint_dict(lead.get("call_conversation_quality"))
    tag = _text(lead.get("call_eval_tag")).lower()

    text_blob = f"{transcript}\n{summary}\n{json.dumps(entities, ensure_ascii=False)}".lower()

    no_pickup = not transcript or len(transcript) < 30 or "no answer" in text_blob
    explicit_refusal = any(
        token in text_blob
        for token in [
            "not interested",
            "don't call",
            "do not call",
            "mat call",
            "nahi chahiye",
            "remove my number",
        ]
    )
    wrong_person = any(token in text_blob for token in ["wrong number", "galat number", "wrong person", "not this person"])
    busy = any(token in text_blob for token in ["busy", "meeting", "call later", "baad mein", "later"])
    ai_detected = any(token in text_blob for token in ["ai", "bot", "robot", "recorded voice", "automated"])
    language_barrier = any(token in text_blob for token in ["hindi mein", "english mein", "samajh nahi", "didn't understand"])
    site_visit = any(token in text_blob for token in ["site visit", "visit", "aake dekhenge", "milte", "come see"])
    asked_config = any(token in text_blob for token in ["2bhk", "3bhk", "4bhk", "bhk"])
    asked_budget = any(token in text_blob for token in ["budget", "lakh", "cr", "crore", "price", "emi"])
    whatsapp_mentioned = "whatsapp" in text_blob

    clarity = int(float(quality.get("clarity", 0) or 0))
    overall = int(float(quality.get("overall_quality", 0) or 0))
    audio_issue = clarity > 0 and clarity <= 3
    audio_loop = any(token in text_blob for token in ["hello hello", "loop", "repeat", "echo"]) or _to_bool(quality.get("loop_detected"))

    wa_number = _extract_whatsapp_number(text_blob) if whatsapp_mentioned else None

    if wrong_person:
        intent_level = "wrong_person"
    elif no_pickup:
        intent_level = "unreachable"
    elif site_visit or asked_config or asked_budget or tag == "yes":
        intent_level = "hot"
    elif busy:
        intent_level = "warm"
    else:
        intent_level = "cold"

    depth = _infer_transcript_depth(transcript)
    if depth in {"long", "very_long"} and tag == "yes":
        engagement_quality = "deep"
    elif depth in {"medium", "long"}:
        engagement_quality = "surface"
    elif depth in {"short"}:
        engagement_quality = "minimal"
    else:
        engagement_quality = "none"

    if explicit_refusal:
        drop_reason = "explicit_refusal"
    elif wrong_person:
        drop_reason = "wrong_person"
    elif language_barrier:
        drop_reason = "language_barrier"
    elif ai_detected:
        drop_reason = "ai_detected"
    elif audio_issue or audio_loop:
        drop_reason = "audio_failure"
    elif no_pickup:
        drop_reason = "no_pickup"
    elif busy:
        drop_reason = "scheduling_conflict"
    elif intent_level == "cold":
        drop_reason = "disengaged"
    else:
        drop_reason = None

    if wrong_person:
        objection_type = "wrong_person"
    elif explicit_refusal:
        objection_type = "not_interested"
    elif busy:
        objection_type = "busy"
    elif "already" in text_blob and ("bought" in text_blob or "invested" in text_blob):
        objection_type = "already_bought"
    elif "location" in text_blob or "kharghar" in text_blob and "far" in text_blob:
        objection_type = "location_mismatch"
    else:
        objection_type = None

    objection_handleable = objection_type in {"busy", "location_mismatch"}

    config_candidates = []
    for key in ("Configuration_Preference", "config", "bhk", "configuration"):
        value = _text(entities.get(key))
        if value:
            config_candidates.append(value)
    config_text = " ".join(config_candidates + [text_blob])
    has_2 = "2bhk" in config_text or "2 bhk" in config_text
    has_3 = "3bhk" in config_text or "3 bhk" in config_text
    has_4 = "4bhk" in config_text or "4 bhk" in config_text
    if has_2 and has_3:
        config_interest = "2BHK+3BHK"
    elif has_4:
        config_interest = "4BHK"
    elif has_3:
        config_interest = "3BHK"
    elif has_2:
        config_interest = "2BHK"
    else:
        config_interest = None

    if asked_budget:
        budget_signal = "high" if any(token in text_blob for token in ["1.5", "1.6", "2cr", "2 cr", "2 crore"]) else "medium"
    else:
        budget_signal = "none"

    language_preference = _infer_language(transcript)
    pitch_reached = any(token in text_blob for token in ["kharghar", "g+45", "amenora", "2bhk", "3bhk", "tower"])
    closing_attempted = any(token in text_blob for token in ["visit", "whatsapp", "brochure", "schedule", "callback"])
    site_visit_timeframe = "this_week" if site_visit else ("2_weeks" if busy and intent_level in {"hot", "warm"} else None)

    if explicit_refusal:
        recommended_action = "add_dnc"
    elif wrong_person:
        recommended_action = "remove_from_list"
    elif language_barrier:
        recommended_action = "retry_english"
    elif busy:
        recommended_action = "retry_evening"
    elif site_visit and wa_number:
        recommended_action = "call_now"
    elif whatsapp_mentioned:
        recommended_action = "send_whatsapp"
    elif intent_level in {"hot", "warm"}:
        recommended_action = "schedule_callback"
    else:
        recommended_action = "escalate_human"

    if recommended_action == "call_now":
        callback_urgency_hours = 2
    elif recommended_action in {"schedule_callback", "retry_evening"}:
        callback_urgency_hours = 24
    elif recommended_action in {"send_whatsapp", "retry_english"}:
        callback_urgency_hours = 48
    elif recommended_action in {"add_dnc", "remove_from_list"}:
        callback_urgency_hours = None
    else:
        callback_urgency_hours = 72

    base_score = 0
    if intent_level == "hot":
        base_score += 40
    elif intent_level == "warm":
        base_score += 25
    elif intent_level == "cold":
        base_score += 10

    if site_visit:
        base_score += 20
    if wa_number:
        base_score += 10
    if tag == "yes":
        base_score += 10
    if engagement_quality == "deep":
        base_score += 12
    elif engagement_quality == "surface":
        base_score += 7
    elif engagement_quality == "minimal":
        base_score += 3

    if explicit_refusal:
        base_score -= 40
    if wrong_person:
        base_score -= 45
    if no_pickup:
        base_score -= 25
    if ai_detected:
        base_score -= 8

    lead_score = max(0, min(100, int(base_score)))

    if lead_score >= 85:
        priority_tier = "P1"
    elif lead_score >= 70:
        priority_tier = "P2"
    elif lead_score >= 55:
        priority_tier = "P3"
    elif lead_score >= 35:
        priority_tier = "P4"
    else:
        priority_tier = "P5"

    script_issue_detected = None
    if audio_loop:
        script_issue_detected = "loop"
    elif language_barrier and language_preference != "english":
        script_issue_detected = "wrong_language"
    elif not closing_attempted and engagement_quality in {"surface", "deep"}:
        script_issue_detected = "weak_close"
    elif engagement_quality == "none":
        script_issue_detected = "no_exit"

    retry_time_recommendation = None
    if recommended_action == "retry_evening":
        retry_time_recommendation = "evening"
    elif recommended_action in {"schedule_callback", "retry_english"}:
        retry_time_recommendation = "afternoon"
    elif recommended_action == "call_now":
        retry_time_recommendation = "morning"

    key_quote = None
    user_lines = [ln.strip() for ln in transcript.splitlines() if re.search(r"\b(user|customer|client|caller|lead)\b", ln, flags=re.IGNORECASE)]
    if user_lines:
        key_quote = max(user_lines, key=len)[:240]

    if explicit_refusal:
        sales_coach_note = "Mark as DNC immediately and stop retries to protect compliance and brand trust."
    elif busy:
        sales_coach_note = "Open with a 10-second context reminder and ask for a precise callback slot."
    elif site_visit:
        sales_coach_note = "Confirm date/time in one call and send brochure to WhatsApp right after."
    elif language_barrier:
        sales_coach_note = "Switch to preferred language in first sentence and avoid long monologues."
    else:
        sales_coach_note = "Use a short benefit-led opener, then ask one qualifying question before pitching."

    enriched_summary = (
        f"Lead intent is {intent_level}. "
        f"Engagement was {engagement_quality}. "
        f"Recommended next step: {recommended_action.replace('_', ' ')}."
    )

    user_engagement_ratio = _infer_user_engagement_ratio(transcript)

    result = {
        "priority_tier": priority_tier,
        "lead_score": lead_score,
        "intent_level": intent_level,
        "engagement_quality": engagement_quality,
        "drop_reason": drop_reason,
        "objection_type": objection_type,
        "objection_handleable": objection_handleable,
        "recommended_action": recommended_action,
        "callback_urgency_hours": callback_urgency_hours,
        "config_interest": config_interest,
        "budget_signal": budget_signal,
        "language_preference": language_preference,
        "pitch_reached": pitch_reached,
        "closing_attempted": closing_attempted,
        "whatsapp_number_captured": wa_number,
        "site_visit_committed": site_visit,
        "site_visit_timeframe": site_visit_timeframe,
        "ai_detected_by_user": ai_detected,
        "audio_quality_issue": audio_issue,
        "audio_loop_detected": audio_loop,
        "script_issue_detected": script_issue_detected,
        "retry_time_recommendation": retry_time_recommendation,
        "enriched_summary": enriched_summary,
        "key_quote": key_quote,
        "sales_coach_note": sales_coach_note,
        "transcript_depth": _infer_transcript_depth(transcript),
        "user_engagement_ratio": user_engagement_ratio,
    }

    return _normalize_lead_output(result)


def _fallback_batch_insights(campaign_name: str, compact_leads: list[dict[str, Any]]) -> dict[str, Any]:
    raise RuntimeError("Enterprise mode: preset batch-insights fallback is disabled")

    total = len(compact_leads)
    if total == 0:
        return {
            "campaign_health_score": 0,
            "campaign_health_label": "critical",
            "funnel": {
                "pitch_reach_rate_pct": 0,
                "conversion_rate_pct": 0,
                "biggest_dropoff_stage": "no_data",
                "dropoff_fix": "Upload a valid campaign sheet to generate insights.",
            },
            "top_insights": [],
            "objection_breakdown": [],
            "missed_opportunities": [],
            "script_issues": [],
            "time_analysis": {
                "best_hour": "n/a",
                "worst_hour": "n/a",
                "untested_windows": ["09:00-12:00", "18:00-20:00"],
                "recommendation": "No calls available for analysis yet.",
            },
            "retry_analysis": {
                "retry_effectiveness": "static",
                "recommendation": "No retry signal available.",
            },
            "language_split": {
                "hindi_pct": 0,
                "english_pct": 0,
                "mixed_pct": 0,
                "recommendation": "No language signal available.",
            },
            "three_things_today": [
                "Upload validated call sheets.",
                "Confirm call timings per campaign.",
                "Assign P1/P2 leads first.",
            ],
            "next_campaign_changes": [
                "Use clear opening + qualification script.",
                "Capture WhatsApp number in every connected call.",
                "Tag objections consistently.",
            ],
        }

    pitch_reached = sum(1 for row in compact_leads if _to_bool(row.get("pitch_reached")))
    conversions = sum(1 for row in compact_leads if _to_bool(row.get("site_visit_committed")))
    p1 = sum(1 for row in compact_leads if _text(row.get("priority_tier")) == "P1")
    p2 = sum(1 for row in compact_leads if _text(row.get("priority_tier")) == "P2")
    no_pickup = sum(1 for row in compact_leads if _text(row.get("drop_reason")) == "no_pickup")

    language_counts = {"hindi": 0, "english": 0, "mixed": 0}
    for row in compact_leads:
        key = _text(row.get("language_preference")).lower() or "mixed"
        if key not in language_counts:
            key = "mixed"
        language_counts[key] += 1

    avg_score = sum(int(row.get("lead_score") or 0) for row in compact_leads) / total
    health_score = max(0, min(100, round(avg_score)))
    if health_score >= 80:
        health_label = "excellent"
    elif health_score >= 65:
        health_label = "good"
    elif health_score >= 50:
        health_label = "fair"
    elif health_score >= 35:
        health_label = "poor"
    else:
        health_label = "critical"

    objection_map: dict[str, int] = {}
    for row in compact_leads:
        key = _text(row.get("objection_type")) or "none"
        objection_map[key] = objection_map.get(key, 0) + 1

    script_map: dict[str, int] = {}
    for row in compact_leads:
        key = _text(row.get("script_issue_detected"))
        if key:
            script_map[key] = script_map.get(key, 0) + 1

    return {
        "campaign_health_score": health_score,
        "campaign_health_label": health_label,
        "funnel": {
            "pitch_reach_rate_pct": round((pitch_reached / total) * 100, 1),
            "conversion_rate_pct": round((conversions / total) * 100, 1),
            "biggest_dropoff_stage": "dial_to_connect" if no_pickup > (total * 0.3) else "connect_to_visit",
            "dropoff_fix": "Prioritize evening retries and stronger opening hooks in first 20 seconds.",
        },
        "top_insights": [
            {
                "id": 1,
                "title": "Prioritize highest intent first",
                "finding": f"{p1 + p2} leads are P1/P2 and require immediate callbacks.",
                "action": "Assign all P1/P2 leads to available call agents within 2 hours.",
                "priority": "immediate",
                "category": "automation",
                "affected_count": p1 + p2,
                "impact": "high",
            },
            {
                "id": 2,
                "title": "Reduce no-pickup leakage",
                "finding": f"{no_pickup} leads dropped as no_pickup in this batch.",
                "action": "Retry no-pickup leads in evening window and send WhatsApp pre-call text.",
                "priority": "this_week",
                "category": "timing",
                "affected_count": no_pickup,
                "impact": "medium",
            },
        ],
        "objection_breakdown": [
            {
                "type": objection,
                "count": count,
                "handleable_pct": 100 if objection in {"busy", "location_mismatch"} else 30,
                "suggested_response": "Totally understood. Quick 30-second summary and I will schedule at your preferred time.",
            }
            for objection, count in sorted(objection_map.items(), key=lambda x: x[1], reverse=True)[:6]
        ],
        "missed_opportunities": [
            {
                "lead_name": _text(row.get("name")) or "Unnamed",
                "reason": "High intent but not marked for immediate callback",
                "action": "Call within 2 hours and push brochure + site visit slot",
                "priority_should_be": "P2",
            }
            for row in compact_leads
            if _text(row.get("intent_level")) == "hot" and not _to_bool(row.get("site_visit_committed"))
        ][:5],
        "script_issues": [
            {
                "issue": issue,
                "count": count,
                "severity": "high" if count >= 5 else "medium",
                "fix": "Add concise objection rebuttal and explicit callback close.",
            }
            for issue, count in sorted(script_map.items(), key=lambda x: x[1], reverse=True)
        ],
        "time_analysis": {
            "best_hour": "18:00",
            "worst_hour": "11:00",
            "untested_windows": ["08:00-10:00", "20:00-21:00"],
            "recommendation": "Test evening retries for all no-connect leads.",
        },
        "retry_analysis": {
            "retry_effectiveness": "static",
            "recommendation": "Shift retries to alternate windows instead of same-hour retries.",
        },
        "language_split": {
            "hindi_pct": round((language_counts["hindi"] / total) * 100, 1),
            "english_pct": round((language_counts["english"] / total) * 100, 1),
            "mixed_pct": round((language_counts["mixed"] / total) * 100, 1),
            "recommendation": "Route mixed-language leads to agents comfortable in Hinglish.",
        },
        "three_things_today": [
            "Call P1/P2 leads within 2 hours.",
            "Resolve all unresolved red flags before next dial cycle.",
            "Apply updated callback scripts for busy/not-interested objections.",
        ],
        "next_campaign_changes": [
            "Use time-windowed retry strategy.",
            "Capture WhatsApp in first connected minute.",
            "Track script issue tags for QA feedback loops.",
        ],
    }


def _fallback_chat_answer(question: str, batch_context: dict[str, Any]) -> str:
    raise RuntimeError("Enterprise mode: preset chat fallback is disabled")

    batch = batch_context.get("batch") if isinstance(batch_context, dict) else {}
    top_leads = batch_context.get("top_p1_leads") if isinstance(batch_context, dict) else []
    lead_lines = []
    if isinstance(top_leads, list):
        for lead in top_leads[:5]:
            if isinstance(lead, dict):
                name = _text(lead.get("name")) or "Unnamed"
                phone = _text(lead.get("phone_number")) or "N/A"
                reason = _text(lead.get("reason")) or "High priority"
                lead_lines.append(f"- {name} ({phone}): {reason}")

    if not lead_lines:
        lead_lines.append("- No high-priority leads available in current batch context.")

    return (
        f"AI response fallback active. Question: {question.strip()}\n\n"
        f"Campaign: {_text(getattr(batch, 'name', None)) if not isinstance(batch, dict) else _text(batch.get('name'))}\n"
        f"Total leads: {_text(batch.get('total_leads') if isinstance(batch, dict) else '')}\n"
        "Top callback targets:\n"
        + "\n".join(lead_lines)
    )


def _fallback_script(lead: dict[str, Any]) -> str:
    raise RuntimeError("Enterprise mode: preset script fallback is disabled")

    name = _text(lead.get("name")) or "sir/ma'am"
    summary = _text(lead.get("enriched_summary") or lead.get("summary"))
    objection = _text(lead.get("objection_type"))
    config = _text(lead.get("config_interest")) or "2/3/4 BHK options"
    hindi = _text(lead.get("language_preference")).lower() != "english"

    if hindi:
        return (
            f"Namaste {name}, main Krishna Group se bol raha/rahi hoon. Pichli call mein {summary or 'aap se connection short raha'} \n"
            f"Aapke liye {config} options available hain, Amanora Metro se 1 minute location par.\n"
            f"Agar abhi busy hain ({objection or 'no issue'}), to main aapke convenient time par 2-minute callback schedule kar deta/deti hoon.\n"
            "Agar theek lage to brochure WhatsApp par share kar doon aur ek short site visit slot lock kar dein?"
        )

    return (
        f"Hi {name}, this is Krishna Group following up from our last call. {summary or 'We had a brief connection earlier.'}\n"
        f"We have relevant {config} inventory in Kharghar near Amanora Metro.\n"
        f"If now is not ideal ({objection or 'no worries'}), I can call at your preferred time for a quick 2-minute walkthrough.\n"
        "Would you like the brochure on WhatsApp and a tentative site-visit slot this week?"
    )


async def _groq_message(system_prompt: str, user_prompt: str, max_tokens: int = 1200, expect_json: bool = False) -> Optional[str]:
    if not settings.CAMPAIGN_AI_ENABLED:
        logger.warning("Campaign Groq pipeline disabled by config")
        return None

    if not settings.GROQ_API_KEY:
        logger.warning("GROQ_API_KEY is not configured")
        return None

    try:
        payload: dict[str, Any] = {
            "model": settings.GROQ_MODEL,
            "max_tokens": max_tokens,
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if expect_json:
            payload["response_format"] = {"type": "json_object"}

        async with httpx.AsyncClient(timeout=75.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "content-type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        logger.error("Groq API call failed: %s", exc)
        return None

    choices = payload.get("choices") or []
    if not choices:
        return None

    first = choices[0] if isinstance(choices, list) else {}
    message = first.get("message") if isinstance(first, dict) else {}
    text = message.get("content") if isinstance(message, dict) else None
    if not text:
        return None
    return str(text).strip()


def _clean_json_text(raw_text: str) -> str:
    cleaned = (raw_text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


def _parse_json(raw_text: str) -> dict[str, Any]:
    cleaned = _clean_json_text(raw_text)
    return json.loads(cleaned)


def _safe_json_hint(value: Any) -> str:
    if value is None:
        return "{}"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    text = str(value).strip()
    if not text:
        return "{}"
    try:
        loaded = json.loads(text)
        return json.dumps(loaded, ensure_ascii=False)
    except Exception:
        return json.dumps({"raw": text}, ensure_ascii=False)


def _normalize_lead_output(data: dict[str, Any]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for key in LEAD_REQUIRED_FIELDS:
        output[key] = data.get(key)

    # Safety overrides from pcrmFINAL
    if output.get("drop_reason") == "explicit_refusal":
        output["priority_tier"] = "P5"

    has_visit = bool(output.get("site_visit_committed"))
    has_wa = bool(str(output.get("whatsapp_number_captured") or "").strip())
    if has_visit and has_wa:
        output["priority_tier"] = "P1"

    try:
        score = int(output.get("lead_score") or 0)
    except Exception:
        score = 0
    output["lead_score"] = max(0, min(score, 100))

    return output


async def analyze_lead_with_claude(lead: dict[str, Any]) -> Optional[dict[str, Any]]:
    user_prompt = (
        "Analyze this outbound real estate sales call transcript.\n\n"
        f"Lead: {lead.get('name') or ''} | Attempt: {lead.get('attempt_number') or ''} | Time: {lead.get('call_dialing_at') or ''}\n"
        f"VaaniVoice eval tag: {lead.get('call_eval_tag') or ''}\n"
        f"VaaniVoice entities hint: {_safe_json_hint(lead.get('extracted_entities'))}\n"
        f"VaaniVoice quality scores: {_safe_json_hint(lead.get('call_conversation_quality'))}\n\n"
        "FULL TRANSCRIPT:\n"
        f"{lead.get('transcript') or ''}\n\n"
        "Return exactly this JSON (all fields required, null where not applicable):\n"
        "{\n"
        "  \"priority_tier\": \"P1|P2|P3|P4|P5\",\n"
        "  \"lead_score\": 0,\n"
        "  \"intent_level\": \"hot|warm|cold|unreachable|wrong_person\",\n"
        "  \"engagement_quality\": \"deep|surface|minimal|none\",\n"
        "  \"drop_reason\": \"audio_failure|explicit_refusal|scheduling_conflict|wrong_person|disengaged|language_barrier|no_pickup|ai_detected|null\",\n"
        "  \"objection_type\": \"busy|not_interested|wrong_person|location_mismatch|already_bought|null\",\n"
        "  \"objection_handleable\": true,\n"
        "  \"recommended_action\": \"call_now|send_whatsapp|schedule_callback|retry_evening|retry_english|escalate_human|add_dnc|remove_from_list\",\n"
        "  \"callback_urgency_hours\": 24,\n"
        "  \"config_interest\": \"2BHK|3BHK|4BHK|2BHK+3BHK|null\",\n"
        "  \"budget_signal\": \"high|medium|low|none\",\n"
        "  \"language_preference\": \"hindi|english|mixed\",\n"
        "  \"pitch_reached\": false,\n"
        "  \"closing_attempted\": false,\n"
        "  \"whatsapp_number_captured\": null,\n"
        "  \"site_visit_committed\": false,\n"
        "  \"site_visit_timeframe\": \"this_week|2_weeks|month|null\",\n"
        "  \"ai_detected_by_user\": false,\n"
        "  \"audio_quality_issue\": false,\n"
        "  \"audio_loop_detected\": false,\n"
        "  \"script_issue_detected\": \"loop|no_exit|wrong_language|over_talking|weak_close|null\",\n"
        "  \"retry_time_recommendation\": \"morning|afternoon|evening|null\",\n"
        "  \"enriched_summary\": \"2-3 sentence summary\",\n"
        "  \"key_quote\": null,\n"
        "  \"sales_coach_note\": \"one specific actionable note\",\n"
        "  \"transcript_depth\": \"very_short|short|medium|long|very_long\",\n"
        "  \"user_engagement_ratio\": \"high|medium|low\"\n"
        "}"
    )

    raw = await _groq_message(LEAD_SYSTEM_PROMPT, user_prompt, max_tokens=1200, expect_json=True)
    if not raw:
        return None

    try:
        parsed = _parse_json(raw)
    except Exception as exc:
        logger.error("Failed to parse lead AI JSON: %s", exc)
        return None

    return _normalize_lead_output(parsed)


async def generate_batch_insights_with_claude(campaign_name: str, compact_leads: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    user_prompt = (
        "Analyze this campaign batch and generate strategic insights.\n\n"
        f"Total leads: {len(compact_leads)}\n"
        f"Campaign: {campaign_name}\n\n"
        "Per-lead AI analysis data:\n"
        f"{json.dumps(compact_leads, ensure_ascii=False)}\n\n"
        "Return exactly this JSON:\n"
        "{\n"
        "  \"campaign_health_score\": 0,\n"
        "  \"campaign_health_label\": \"critical|poor|fair|good|excellent\",\n"
        "  \"funnel\": {\n"
        "    \"pitch_reach_rate_pct\": 0,\n"
        "    \"conversion_rate_pct\": 0,\n"
        "    \"biggest_dropoff_stage\": \"string\",\n"
        "    \"dropoff_fix\": \"string\"\n"
        "  },\n"
        "  \"top_insights\": [\n"
        "    {\n"
        "      \"id\": 1,\n"
        "      \"title\": \"short title\",\n"
        "      \"finding\": \"specific finding\",\n"
        "      \"action\": \"exact action\",\n"
        "      \"priority\": \"immediate|this_week|next_campaign\",\n"
        "      \"category\": \"script|timing|data_quality|automation|agent_training|missed_opportunity\",\n"
        "      \"affected_count\": 0,\n"
        "      \"impact\": \"high|medium|low\"\n"
        "    }\n"
        "  ],\n"
        "  \"objection_breakdown\": [],\n"
        "  \"missed_opportunities\": [],\n"
        "  \"script_issues\": [],\n"
        "  \"time_analysis\": {\n"
        "    \"best_hour\": \"string\",\n"
        "    \"worst_hour\": \"string\",\n"
        "    \"untested_windows\": [\"string\"],\n"
        "    \"recommendation\": \"string\"\n"
        "  },\n"
        "  \"retry_analysis\": {\n"
        "    \"retry_effectiveness\": \"improving|static|worsening\",\n"
        "    \"recommendation\": \"string\"\n"
        "  },\n"
        "  \"language_split\": {\n"
        "    \"hindi_pct\": 0,\n"
        "    \"english_pct\": 0,\n"
        "    \"mixed_pct\": 0,\n"
        "    \"recommendation\": \"string\"\n"
        "  },\n"
        "  \"three_things_today\": [\"string\", \"string\", \"string\"],\n"
        "  \"next_campaign_changes\": [\"string\", \"string\", \"string\"]\n"
        "}"
    )

    raw = await _groq_message(BATCH_SYSTEM_PROMPT, user_prompt, max_tokens=1400, expect_json=True)
    if not raw:
        return None

    try:
        return _parse_json(raw)
    except Exception as exc:
        logger.error("Failed to parse batch insights JSON: %s", exc)
        return None


async def campaign_chat_with_claude(question: str, batch_context: dict[str, Any], history: list[dict[str, str]]) -> Optional[str]:
    if not question.strip():
        return None

    compact_history = [m for m in history[-10:] if isinstance(m, dict) and m.get("role") in ("user", "assistant") and m.get("content")]

    conversation_blob = ""
    for msg in compact_history:
        conversation_blob += f"{msg['role'].upper()}: {msg['content']}\n"

    user_prompt = (
        "Campaign data:\n"
        f"{json.dumps(batch_context, ensure_ascii=False)}\n\n"
        "Conversation history:\n"
        f"{conversation_blob}\n"
        f"Question: {question}"
    )

    response = await _groq_message(CHAT_SYSTEM_PROMPT, user_prompt, max_tokens=1100)
    if response:
        return response
    return None


async def callback_script_with_claude(lead: dict[str, Any]) -> Optional[str]:
    language = "English" if str(lead.get("language_preference") or "").lower() == "english" else "Hindi"
    user_prompt = (
        "Generate a callback script for a human sales agent.\n\n"
        f"Lead: {lead.get('name') or ''} | Attempt: {lead.get('attempt_number') or ''}\n"
        f"Previous call: {lead.get('enriched_summary') or lead.get('summary') or ''}\n"
        f"Drop reason: {lead.get('drop_reason') or ''}\n"
        f"Objection: {lead.get('objection_type') or ''} (handleable: {lead.get('objection_handleable')})\n"
        f"Config interest: {lead.get('config_interest') or 'unknown'}\n"
        f"Language: {lead.get('language_preference') or ''}\n"
        f"Key quote from lead: \"{lead.get('key_quote') or 'none'}\"\n"
        f"Coach note: {lead.get('sales_coach_note') or ''}\n\n"
        "Write: (1) Opening line, (2) Bridge line, (3) Value hook, (4) Soft close, (5) Objection handler. "
        f"Max 150 words. Language: {language}."
    )

    response = await _groq_message(SCRIPT_SYSTEM_PROMPT, user_prompt, max_tokens=700)
    if response:
        return response
    return None


async def analyze_lead_with_groq(lead: dict[str, Any]) -> Optional[dict[str, Any]]:
    return await analyze_lead_with_claude(lead)


async def generate_batch_insights_with_groq(campaign_name: str, compact_leads: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    return await generate_batch_insights_with_claude(campaign_name, compact_leads)


async def campaign_chat_with_groq(question: str, batch_context: dict[str, Any], history: list[dict[str, str]]) -> Optional[str]:
    return await campaign_chat_with_claude(question, batch_context, history)


async def callback_script_with_groq(lead: dict[str, Any]) -> Optional[str]:
    return await callback_script_with_claude(lead)
