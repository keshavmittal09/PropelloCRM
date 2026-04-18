"""
Campaign Analytics Service
---------------------------
Computes dashboard analytics, insights, and agent assignments from campaign data.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.agent import Agent
from app.models.campaign import Campaign
from app.models.lead import Lead
from app.models.models import Activity
from app.services.campaign_service import _safe_str, _load_entities, _load_quality, _is_connected

logger = logging.getLogger(__name__)


async def compute_campaign_analytics(campaign_id: str, db: AsyncSession) -> dict:
    """Compute full analytics for a campaign dashboard."""
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        return {}

    # Get all activities for this campaign
    result = await db.execute(
        select(Activity)
        .where(Activity.campaign_id == campaign_id)
        .where(Activity.type == "campaign_call")
        .order_by(Activity.performed_at.asc())
    )
    activities = result.scalars().all()

    if not activities:
        return _empty_analytics(campaign_id, campaign.name)

    # Core metrics
    total_dialed = len(activities)
    connected = 0
    eval_yes = 0
    eval_no = 0
    eval_empty = 0
    quality_scores: list[dict] = []
    attempt_stats: dict[int, dict] = {}
    tier_distribution: dict[str, int] = {}
    transcript_buckets: dict[str, list[float]] = {
        "< 300": [], "300-700": [], "700-1500": [], "1500+": []
    }

    for act in activities:
        meta = act.meta or {}
        is_conn = meta.get("is_connected", False)

        if is_conn:
            connected += 1

        # Eval tag
        tag = _safe_str(act.call_eval_tag).lower()
        if tag == "yes":
            eval_yes += 1
        elif tag == "no":
            eval_no += 1
        else:
            eval_empty += 1

        # Quality scores
        q = meta.get("call_conversation_quality", {})
        if isinstance(q, dict) and q:
            quality_scores.append(q)

        # Attempt stats
        attempt = int(meta.get("attempt_number", 1) or 1)
        if attempt not in attempt_stats:
            attempt_stats[attempt] = {"total": 0, "connected": 0}
        attempt_stats[attempt]["total"] += 1
        if is_conn:
            attempt_stats[attempt]["connected"] += 1

        # Tier distribution
        tier = meta.get("priority_tier", "P7")
        tier_distribution[tier] = tier_distribution.get(tier, 0) + 1

        # Transcript length buckets
        t_len = int(meta.get("transcript_length", 0) or 0)
        overall_q = float(q.get("overall_quality", 0) or 0) if isinstance(q, dict) else 0.0
        if t_len < 300:
            transcript_buckets["< 300"].append(overall_q)
        elif t_len < 700:
            transcript_buckets["300-700"].append(overall_q)
        elif t_len < 1500:
            transcript_buckets["700-1500"].append(overall_q)
        else:
            transcript_buckets["1500+"].append(overall_q)

    # Averages
    def _avg(vals: list[float]) -> float:
        return round(sum(vals) / len(vals), 1) if vals else 0.0

    avg_clarity = _avg([q.get("clarity", 0) for q in quality_scores])
    avg_professionalism = _avg([q.get("professionalism", 0) for q in quality_scores])
    avg_problem_resolution = _avg([q.get("problem_resolution", 0) for q in quality_scores])
    avg_overall_quality = _avg([q.get("overall_quality", 0) for q in quality_scores])

    # Build attempt stats list
    attempt_stats_list = []
    for a in sorted(attempt_stats.keys()):
        s = attempt_stats[a]
        rate = round(s["connected"] / s["total"] * 100, 1) if s["total"] > 0 else 0.0
        attempt_stats_list.append({
            "attempt": a, "total": s["total"],
            "connected": s["connected"], "rate": rate
        })

    # Transcript bucket list
    bucket_list = []
    for name, vals in transcript_buckets.items():
        bucket_list.append({
            "bucket": name,
            "count": len(vals),
            "avg_quality": _avg(vals)
        })

    # Hot/warm/cold from tier distribution
    hot_tiers = tier_distribution.get("P1", 0) + tier_distribution.get("P2", 0)
    warm_tiers = tier_distribution.get("P3", 0) + tier_distribution.get("P4", 0)
    cold_tiers = (tier_distribution.get("P5", 0) + tier_distribution.get("P6", 0)
                  + tier_distribution.get("P7", 0))

    # Compute insights
    insights = _compute_insights(
        activities, total_dialed, connected, eval_yes, eval_no,
        quality_scores, attempt_stats, avg_problem_resolution,
        avg_overall_quality, transcript_buckets
    )

    return {
        "campaign_id": campaign_id,
        "campaign_name": campaign.name,
        "total_dialed": total_dialed,
        "total_connected": connected,
        "connection_rate": round(connected / total_dialed * 100, 1) if total_dialed > 0 else 0.0,
        "eval_yes": eval_yes,
        "eval_no": eval_no,
        "eval_empty": eval_empty,
        "avg_clarity": avg_clarity,
        "avg_professionalism": avg_professionalism,
        "avg_problem_resolution": avg_problem_resolution,
        "avg_overall_quality": avg_overall_quality,
        "attempt_stats": attempt_stats_list,
        "tier_distribution": tier_distribution,
        "hot_count": hot_tiers,
        "warm_count": warm_tiers,
        "cold_count": cold_tiers,
        "insights": insights,
        "transcript_length_buckets": bucket_list,
    }


def _empty_analytics(campaign_id: str, name: str) -> dict:
    return {
        "campaign_id": campaign_id, "campaign_name": name,
        "total_dialed": 0, "total_connected": 0, "connection_rate": 0.0,
        "eval_yes": 0, "eval_no": 0, "eval_empty": 0,
        "avg_clarity": 0, "avg_professionalism": 0,
        "avg_problem_resolution": 0, "avg_overall_quality": 0,
        "attempt_stats": [], "tier_distribution": {},
        "hot_count": 0, "warm_count": 0, "cold_count": 0,
        "insights": [], "transcript_length_buckets": [],
    }


# ─── INSIGHT ENGINE ──────────────────────────────────────────────────────────

def _compute_insights(
    activities: list,
    total_dialed: int,
    connected: int,
    eval_yes: int,
    eval_no: int,
    quality_scores: list[dict],
    attempt_stats: dict,
    avg_problem_resolution: float,
    avg_overall_quality: float,
    transcript_buckets: dict,
) -> list[dict]:
    """Compute 15 actionable insights from campaign data."""
    insights: list[dict] = []
    not_connected = total_dialed - connected

    # 1. Connection Rate
    conn_rate = round(connected / total_dialed * 100, 1) if total_dialed > 0 else 0
    severity = "critical" if conn_rate < 25 else ("warning" if conn_rate < 50 else "info")
    insights.append({
        "id": "connection_rate",
        "title": "Connection Rate",
        "description": f"Only {connected} out of {total_dialed} calls connected ({conn_rate}%). "
                       f"{not_connected} calls resulted in no answer.",
        "severity": severity,
        "metric_value": f"{conn_rate}%",
        "recommendation": "Test evening time slots (18:00–20:00) for better connection rates. "
                          "Consider SMS pre-notification before calling."
    })

    # 2. Attempt Decay
    attempt_list = sorted(attempt_stats.items())
    if len(attempt_list) >= 2:
        first = attempt_list[0][1]
        last = attempt_list[-1][1]
        first_rate = round(first["connected"] / first["total"] * 100, 1) if first["total"] > 0 else 0
        last_rate = round(last["connected"] / last["total"] * 100, 1) if last["total"] > 0 else 0
        decay = round(first_rate - last_rate, 1)
        insights.append({
            "id": "attempt_decay",
            "title": "Retry Effectiveness Decay",
            "description": f"Connection rate drops from {first_rate}% on attempt 1 to {last_rate}% on attempt {attempt_list[-1][0]}. "
                           f"A {decay} percentage point decline.",
            "severity": "warning" if decay > 10 else "info",
            "metric_value": f"-{decay}pp",
            "recommendation": "Shift retry attempts to different time windows (morning ↔ evening). "
                              "Same-window retries show diminishing returns."
        })

    # 3. Transcript Length ↔ Quality
    long_calls = transcript_buckets.get("1500+", [])
    short_calls = transcript_buckets.get("< 300", [])
    if long_calls and short_calls:
        long_avg = round(sum(long_calls) / len(long_calls), 1)
        short_avg = round(sum(short_calls) / len(short_calls), 1)
        uplift = round(((long_avg - short_avg) / short_avg) * 100) if short_avg > 0 else 0
        insights.append({
            "id": "transcript_quality_correlation",
            "title": "Conversation Length → Quality",
            "description": f"Calls >1500 chars avg quality {long_avg}/10 vs calls <300 chars avg {short_avg}/10. "
                           f"Longer conversations correlate with {uplift}% higher quality.",
            "severity": "info",
            "metric_value": f"{long_avg} vs {short_avg}",
            "recommendation": "Prioritize re-calling leads whose calls lasted >2 minutes. "
                              "Connected but dropped early (<30 sec) calls are high-priority callbacks."
        })

    # 4. Problem Resolution Gap
    if avg_problem_resolution < 4:
        insights.append({
            "id": "problem_resolution_gap",
            "title": "Problem Resolution Score Critical",
            "description": f"Average problem_resolution score is {avg_problem_resolution}/10 — the weakest quality dimension. "
                           f"This indicates the agent script lacks objection handling.",
            "severity": "critical",
            "metric_value": f"{avg_problem_resolution}/10",
            "recommendation": "Add specific objection handling scripts for common pushbacks: "
                              "'meeting right now', 'out of station', 'will check with family'. "
                              "Each needs a concrete callback offer."
        })

    # 5. Eval Tag Conversion
    eval_conn_rate = round(eval_yes / connected * 100, 1) if connected > 0 else 0
    insights.append({
        "id": "eval_conversion",
        "title": "Objective Achievement Rate",
        "description": f"Only {eval_yes} out of {connected} connected calls met the call objective ({eval_conn_rate}%). "
                       f"{eval_no} calls explicitly failed the objective.",
        "severity": "critical" if eval_conn_rate < 5 else ("warning" if eval_conn_rate < 20 else "info"),
        "metric_value": f"{eval_conn_rate}%",
        "recommendation": "Review the agent script for clarity. Ensure the call objective "
                          "(site visit / WA capture) is attempted within first 60 seconds of connection."
    })

    # 6. Time Window Gap
    has_timestamps = False
    time_slots: dict[str, int] = {}
    for act in activities:
        meta = act.meta or {}
        dial_at = meta.get("call_dialing_at", "")
        if dial_at and "T" not in str(dial_at) and " " in str(dial_at):
            try:
                hour = int(str(dial_at).split(" ")[1].split(":")[0])
                slot = f"{hour:02d}:00"
                time_slots[slot] = time_slots.get(slot, 0) + 1
                has_timestamps = True
            except Exception:
                pass

    if has_timestamps and time_slots:
        covered = sorted(time_slots.keys())
        insights.append({
            "id": "time_window_analysis",
            "title": "Time Window Coverage",
            "description": f"All calls concentrated in {covered[0]}–{covered[-1]} window. "
                           f"Evening (18:00–20:00) and morning (09:00–10:00) slots untested.",
            "severity": "warning",
            "metric_value": f"{covered[0]}–{covered[-1]}",
            "recommendation": "Run A/B test: schedule 30% of calls in 18:00–20:00 evening window. "
                              "Real estate leads typically answer better during evenings."
        })

    # 7. Audio Issue Detection
    low_clarity_count = sum(1 for q in quality_scores if q.get("clarity", 10) < 3)
    if low_clarity_count > 0:
        insights.append({
            "id": "audio_issues",
            "title": "Audio Quality Issues Detected",
            "description": f"{low_clarity_count} calls had clarity score < 3/10, indicating systemic audio problems "
                           f"(echo, loop, or network issues).",
            "severity": "critical" if low_clarity_count > 5 else "warning",
            "metric_value": f"{low_clarity_count} calls",
            "recommendation": "Investigate VaaniVoice audio pipeline. Check for echo cancellation settings "
                              "and network latency. These calls represent lost opportunities."
        })

    # 8. Entity Extraction Rate
    entity_count = 0
    config_count = 0
    wa_count = 0
    for act in activities:
        meta = act.meta or {}
        if not meta.get("is_connected", False):
            continue
        ent = meta.get("extracted_entities", {})
        if isinstance(ent, dict) and any(v for v in ent.values() if v and str(v).lower() not in ("", "null", "no", "none")):
            entity_count += 1
        if isinstance(ent, dict) and ent.get("Configuration_Preference"):
            config_count += 1
        if isinstance(ent, dict) and _safe_str(ent.get("whatsapp_followup", "")).lower() == "yes":
            wa_count += 1

    if connected > 0:
        insights.append({
            "id": "entity_extraction_rate",
            "title": "Lead Info Capture Rate",
            "description": f"Configuration preference captured in {config_count}/{connected} connected calls ({round(config_count/connected*100,1)}%). "
                           f"WhatsApp number captured in {wa_count}/{connected} calls ({round(wa_count/connected*100,1)}%).",
            "severity": "warning" if config_count < connected * 0.1 else "info",
            "metric_value": f"{config_count} configs, {wa_count} WA",
            "recommendation": "Ensure the script prompts for BHK preference and WhatsApp number "
                              "within the first 2 minutes of every connected call."
        })

    # 9. Professionalism vs Problem Resolution Gap
    if quality_scores:
        avg_prof = round(sum(q.get("professionalism", 0) for q in quality_scores) / len(quality_scores), 1)
        if avg_prof - avg_problem_resolution > 3:
            insights.append({
                "id": "prof_vs_resolution_gap",
                "title": "Professionalism ↔ Resolution Gap",
                "description": f"Professionalism averages {avg_prof}/10 but problem resolution is only {avg_problem_resolution}/10. "
                               f"The agent sounds good but lacks substance in handling queries.",
                "severity": "warning",
                "metric_value": f"{avg_prof} vs {avg_problem_resolution}",
                "recommendation": "Add FAQ responses to the script: pricing ranges, EMI options, "
                                  "carpet area details, location advantages. The agent needs answers, not just politeness."
            })

    # 10. Missed Opportunities
    missed = 0
    for act in activities:
        meta = act.meta or {}
        q = meta.get("call_conversation_quality", {})
        if isinstance(q, dict) and float(q.get("overall_quality", 0) or 0) >= 6:
            if _safe_str(act.call_eval_tag).lower() == "no":
                missed += 1

    if missed > 0:
        insights.append({
            "id": "missed_opportunities",
            "title": "Missed Opportunity Leads",
            "description": f"{missed} calls had quality ≥ 6/10 but eval=No — these are leads where the conversation "
                           f"went well but the objective wasn't met. Possible scoring calibration issue.",
            "severity": "warning",
            "metric_value": f"{missed} leads",
            "recommendation": "Manually review these leads. They likely need a human callback "
                              "to close what the AI agent started well. Treat as P2 priority."
        })

    # 11. No-Connect Retry Strategy
    if not_connected > total_dialed * 0.5:
        insights.append({
            "id": "no_connect_strategy",
            "title": "High No-Connect Rate Strategy",
            "description": f"{not_connected} calls ({round(not_connected/total_dialed*100)}%) resulted in no connection. "
                           f"This is the biggest opportunity loss in this campaign.",
            "severity": "critical",
            "metric_value": f"{not_connected} calls",
            "recommendation": "Implement staggered retry: attempt 2 at +4 hours, attempt 3 at next-day evening. "
                              "Pre-qualify with SMS: 'Hi [Name], Krishna Group calling about Credai visit. Good time?'"
        })

    # 12. High-Value Leads Count
    p1_p2 = sum(1 for act in activities
                if (act.meta or {}).get("priority_tier") in ("P1", "P2"))
    if p1_p2 > 0:
        insights.append({
            "id": "high_value_leads",
            "title": "Actionable Hot Leads",
            "description": f"{p1_p2} leads classified as P1/P2 (immediate action required). "
                           f"These leads showed concrete interest signals and should be called within 1–2 hours.",
            "severity": "critical",
            "metric_value": f"{p1_p2} leads",
            "recommendation": "Assign all P1/P2 leads to your most experienced calling agent immediately. "
                              "Do NOT delay — site visit leads lose interest after 4 hours."
        })

    # 13. Script Effectiveness
    if quality_scores:
        high_quality = sum(1 for q in quality_scores if q.get("overall_quality", 0) >= 7)
        effectiveness = round(high_quality / len(quality_scores) * 100, 1)
        insights.append({
            "id": "script_effectiveness",
            "title": "Script Effectiveness Score",
            "description": f"{high_quality} out of {len(quality_scores)} calls achieved quality ≥ 7/10 ({effectiveness}%). "
                           f"Average overall quality: {avg_overall_quality}/10.",
            "severity": "warning" if effectiveness < 30 else "info",
            "metric_value": f"{effectiveness}%",
            "recommendation": "Benchmark target: 40% of calls should achieve quality ≥ 7. "
                              "Focus script improvements on problem_resolution (currently weakest)."
        })

    # 14. Campaign ROI Indicator
    if connected > 0:
        action_rate = round((eval_yes + p1_p2) / connected * 100, 1) if (eval_yes + p1_p2) > 0 else 0
        insights.append({
            "id": "campaign_roi",
            "title": "Campaign Conversion Funnel",
            "description": f"Funnel: {total_dialed} dialed → {connected} connected ({conn_rate}%) → "
                           f"{eval_yes + p1_p2} actionable ({action_rate}% of connected).",
            "severity": "info",
            "metric_value": f"{total_dialed} → {connected} → {eval_yes + p1_p2}",
            "recommendation": "Focus on improving the connected → actionable conversion. "
                              "Current bottleneck is the pitch delivery and objection handling."
        })

    # 15. DNC Risk
    dnc_risk = 0
    for act in activities:
        if act.call_summary:
            s = act.call_summary.lower()
            if any(w in s for w in ["don't call", "do not call", "remove", "stop calling"]):
                dnc_risk += 1
    if dnc_risk > 0:
        insights.append({
            "id": "dnc_risk",
            "title": "DNC Compliance Risk",
            "description": f"{dnc_risk} leads explicitly asked to not be called again. "
                           f"These must be flagged for DNC compliance immediately.",
            "severity": "critical",
            "metric_value": f"{dnc_risk} leads",
            "recommendation": "Add these numbers to DNC list immediately. Continuing to call "
                              "risks regulatory action. Implement DNC check BEFORE dialing."
        })

    return insights


# ─── LEAD DETAIL RETRIEVAL ───────────────────────────────────────────────────

async def get_campaign_leads_detail(
    campaign_id: str,
    db: AsyncSession,
    tier_filter: str | None = None,
    search: str | None = None,
) -> list[dict]:
    """Get detailed lead information for the campaign dashboard."""
    # Get all campaign activities
    result = await db.execute(
        select(Activity)
        .where(Activity.campaign_id == campaign_id)
        .where(Activity.type == "campaign_call")
        .order_by(Activity.performed_at.asc())
    )
    activities = result.scalars().all()

    # Get corresponding leads with contacts
    lead_ids = list(set(act.lead_id for act in activities if act.lead_id))
    if not lead_ids:
        return []

    leads_result = await db.execute(
        select(Lead)
        .options(selectinload(Lead.contact), selectinload(Lead.assigned_agent))
        .where(Lead.id.in_(lead_ids))
    )
    leads_map = {lead.id: lead for lead in leads_result.scalars().all()}

    details = []
    for act in activities:
        lead = leads_map.get(act.lead_id)
        if not lead:
            continue

        meta = act.meta or {}
        p_tier = meta.get("priority_tier", "P7")
        p_score = int(meta.get("priority_score", 0) or 0)

        # Apply tier filter
        if tier_filter and p_tier != tier_filter:
            continue

        # Apply search filter
        name = lead.contact.name if lead.contact else "Unknown"
        phone = lead.contact.phone if lead.contact else ""
        if search:
            search_l = search.lower()
            if search_l not in name.lower() and search_l not in phone:
                continue

        detail = {
            "lead_id": lead.id,
            "name": name,
            "phone": phone,
            "priority_tier": p_tier,
            "priority_score": p_score,
            "lead_score": lead.lead_score,
            "stage": lead.stage,
            "attempt_number": int(meta.get("attempt_number", 1) or 1),
            "call_eval_tag": _safe_str(act.call_eval_tag),
            "summary": _safe_str(act.call_summary),
            "transcript": _safe_str(act.transcript),
            "recording_url": _safe_str(act.recording_url),
            "extracted_entities": meta.get("extracted_entities", {}),
            "call_quality": meta.get("call_conversation_quality", {}),
            "call_dialing_at": meta.get("call_dialing_at"),
            "user_picked_up": meta.get("user_picked_up"),
            "num_of_retries": int(meta.get("num_of_retries", 0) or 0),
            "ai_analysis": lead.ai_analysis,
            "assigned_agent_name": lead.assigned_agent.name if lead.assigned_agent else None,
            "assigned_agent_id": lead.assigned_to,
            "action": "updated" if lead.updated_at != lead.created_at else "created",
        }
        details.append(detail)

    # Sort by priority tier (P1 first) then score descending
    tier_order = {"P1": 0, "P2": 1, "P3": 2, "P4": 3, "P5": 4, "P6": 5, "P7": 6}
    details.sort(key=lambda d: (tier_order.get(d["priority_tier"], 9), -d["priority_score"]))

    return details


# ─── AGENT AUTO-ASSIGNMENT ───────────────────────────────────────────────────

async def compute_agent_assignments(
    campaign_id: str,
    db: AsyncSession,
) -> list[dict]:
    """Auto-distribute campaign leads to agents with 'call' in their name or role.
    P1+P2 → first agent, P3+P4 → second agent, P5+ → third agent.
    If fewer than 3 agents, round-robin."""
    # Find call agents
    result = await db.execute(
        select(Agent)
        .where(Agent.is_active == True)
        .order_by(Agent.created_at.asc())
    )
    all_agents = result.scalars().all()

    # Filter to agents with "call" in name (case-insensitive)
    call_agents = [a for a in all_agents if "call" in a.name.lower()]

    # Fallback: if no "call" agents found, use all active agents
    if not call_agents:
        call_agents = list(all_agents)

    if not call_agents:
        return []

    # Get lead details
    leads = await get_campaign_leads_detail(campaign_id, db)
    if not leads:
        return [{
            "agent_id": a.id, "agent_name": a.name,
            "lead_count": 0, "tier_breakdown": {}, "leads": []
        } for a in call_agents[:3]]

    # Distribute based on tier
    num_agents = min(len(call_agents), 3)
    assignments: dict[str, list[dict]] = {call_agents[i].id: [] for i in range(num_agents)}

    for lead in leads:
        tier = lead["priority_tier"]
        if num_agents >= 3:
            if tier in ("P1", "P2"):
                target_agent = call_agents[0]
            elif tier in ("P3", "P4"):
                target_agent = call_agents[1]
            else:
                target_agent = call_agents[2]
        elif num_agents == 2:
            if tier in ("P1", "P2", "P3"):
                target_agent = call_agents[0]
            else:
                target_agent = call_agents[1]
        else:
            target_agent = call_agents[0]

        assignments[target_agent.id].append(lead)

    result_list = []
    for i in range(num_agents):
        agent = call_agents[i]
        agent_leads = assignments.get(agent.id, [])
        tier_breakdown: dict[str, int] = {}
        for l in agent_leads:
            t = l["priority_tier"]
            tier_breakdown[t] = tier_breakdown.get(t, 0) + 1

        result_list.append({
            "agent_id": agent.id,
            "agent_name": agent.name,
            "lead_count": len(agent_leads),
            "tier_breakdown": tier_breakdown,
            "leads": agent_leads,
        })

    return result_list


async def execute_agent_assignments(campaign_id: str, db: AsyncSession) -> dict:
    """Actually assign leads to agents in the database."""
    assignments = await compute_agent_assignments(campaign_id, db)
    assigned_count = 0

    for assignment in assignments:
        agent_id = assignment["agent_id"]
        for lead_detail in assignment["leads"]:
            lead = await db.get(Lead, lead_detail["lead_id"])
            if lead and not lead.assigned_to:
                lead.assigned_to = agent_id
                assigned_count += 1

    await db.flush()
    return {"assigned": assigned_count, "agents": len(assignments)}
