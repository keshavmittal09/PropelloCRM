"""
Campaign Analytics Service
---------------------------
Computes dashboard analytics, insights, and agent assignments from campaign data.
"""
from __future__ import annotations

from datetime import datetime, timedelta
import json
import logging
from typing import Optional

import httpx

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.agent import Agent
from app.models.campaign import Campaign
from app.models.lead import Lead
from app.models.models import Activity, Task
from app.services.campaign_service import _safe_str, _load_entities, _load_quality, _is_connected
from app.services.lead_service import create_notification

logger = logging.getLogger(__name__)


CAMPAIGN_INSIGHTS_SYSTEM_PROMPT = (
    "You are a senior campaign intelligence analyst for enterprise real-estate sales operations. "
    "Analyze the provided campaign data and produce only data-grounded insights. "
    "Do not fabricate numbers. Use only metrics from input. "
    "Return strict JSON with this shape: "
    "{\"insights\": [{\"id\":\"string\",\"title\":\"string\",\"description\":\"string\","
    "\"severity\":\"critical|warning|info\",\"metric_value\":\"string\",\"recommendation\":\"string\"}]}. "
    "Each description and recommendation must be specific and actionable. "
    "Prefer 8 to 15 insights based on strongest business impact."
)


def _clean_json_text(raw_text: str) -> str:
    cleaned = (raw_text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


def _parse_json_text(raw_text: str) -> dict:
    return json.loads(_clean_json_text(raw_text))


def _build_ai_insight_context(
    campaign_name: str,
    activities: list[Activity],
    total_dialed: int,
    connected: int,
    eval_yes: int,
    eval_no: int,
    eval_empty: int,
    avg_clarity: float,
    avg_professionalism: float,
    avg_problem_resolution: float,
    avg_overall_quality: float,
    attempt_stats_list: list[dict],
    tier_distribution: dict[str, int],
    transcript_bucket_list: list[dict],
) -> dict:
    connected_samples: list[dict] = []
    for act in activities:
        if len(connected_samples) >= 20:
            break

        meta = act.meta or {}
        if not (meta.get("is_connected") or _safe_str(act.call_eval_tag).lower() == "yes"):
            continue

        quality = meta.get("call_conversation_quality") if isinstance(meta.get("call_conversation_quality"), dict) else {}
        connected_samples.append(
            {
                "call_eval_tag": _safe_str(act.call_eval_tag),
                "attempt_number": int(meta.get("attempt_number", 1) or 1),
                "num_of_retries": int(meta.get("num_of_retries", 0) or 0),
                "priority_tier": _safe_str(meta.get("priority_tier")) or "P7",
                "priority_score": int(meta.get("priority_score", 0) or 0),
                "overall_quality": quality.get("overall_quality"),
                "summary": _safe_str(act.call_summary)[:280],
                "transcript_excerpt": _safe_str(act.transcript)[:280],
            }
        )

    return {
        "campaign_name": campaign_name,
        "metrics": {
            "total_dialed": total_dialed,
            "connected": connected,
            "connection_rate_pct": round((connected / total_dialed) * 100, 1) if total_dialed > 0 else 0.0,
            "eval_yes": eval_yes,
            "eval_no": eval_no,
            "eval_empty": eval_empty,
            "avg_clarity": avg_clarity,
            "avg_professionalism": avg_professionalism,
            "avg_problem_resolution": avg_problem_resolution,
            "avg_overall_quality": avg_overall_quality,
            "attempt_stats": attempt_stats_list,
            "tier_distribution": tier_distribution,
            "transcript_length_buckets": transcript_bucket_list,
        },
        "connected_call_samples": connected_samples,
    }


async def _compute_ai_insights(
    campaign_name: str,
    activities: list[Activity],
    total_dialed: int,
    connected: int,
    eval_yes: int,
    eval_no: int,
    eval_empty: int,
    avg_clarity: float,
    avg_professionalism: float,
    avg_problem_resolution: float,
    avg_overall_quality: float,
    attempt_stats_list: list[dict],
    tier_distribution: dict[str, int],
    transcript_bucket_list: list[dict],
) -> list[dict]:
    if not settings.CAMPAIGN_AI_ENABLED:
        logger.warning("Campaign AI insights disabled by config")
        return []

    if not settings.GROQ_API_KEY:
        logger.warning("GROQ_API_KEY missing; AI insights not generated")
        return []

    context = _build_ai_insight_context(
        campaign_name,
        activities,
        total_dialed,
        connected,
        eval_yes,
        eval_no,
        eval_empty,
        avg_clarity,
        avg_professionalism,
        avg_problem_resolution,
        avg_overall_quality,
        attempt_stats_list,
        tier_distribution,
        transcript_bucket_list,
    )

    user_prompt = (
        "Generate high-value campaign insights from this dataset. "
        "Focus on conversion bottlenecks, retry strategy, script quality, evaluation quality, and immediate actions. "
        "Use exact numbers from the input context.\n\n"
        + json.dumps(context, ensure_ascii=False)
    )

    try:
        payload = {
            "model": settings.GROQ_MODEL,
            "temperature": 0.2,
            "max_tokens": 1800,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": CAMPAIGN_INSIGHTS_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        }

        async with httpx.AsyncClient(timeout=70.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "content-type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            raw = response.json()
    except Exception as exc:
        logger.error("Campaign AI insights request failed: %s", exc)
        return []

    try:
        choices = raw.get("choices") or []
        if not choices:
            return []

        content = choices[0].get("message", {}).get("content")
        if not content:
            return []

        parsed = _parse_json_text(str(content))
        candidate = parsed.get("insights") if isinstance(parsed, dict) else None
        if not isinstance(candidate, list):
            return []

        normalized: list[dict] = []
        for idx, insight in enumerate(candidate, start=1):
            if not isinstance(insight, dict):
                continue

            severity = _safe_str(insight.get("severity")).lower() or "info"
            if severity not in {"critical", "warning", "info"}:
                severity = "info"

            title = _safe_str(insight.get("title"))
            description = _safe_str(insight.get("description"))
            recommendation = _safe_str(insight.get("recommendation"))
            metric_value = _safe_str(insight.get("metric_value"))

            if not (title and description and recommendation):
                continue

            normalized.append(
                {
                    "id": _safe_str(insight.get("id")) or f"ai_insight_{idx}",
                    "title": title,
                    "description": description,
                    "severity": severity,
                    "metric_value": metric_value,
                    "recommendation": recommendation,
                }
            )

        return normalized
    except Exception as exc:
        logger.error("Campaign AI insights parse failed: %s", exc)
        return []


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

    # Compute insights with AI (no preset fallback templates).
    insights = await _compute_ai_insights(
        campaign.name,
        activities,
        total_dialed,
        connected,
        eval_yes,
        eval_no,
        eval_empty,
        avg_clarity,
        avg_professionalism,
        avg_problem_resolution,
        avg_overall_quality,
        attempt_stats_list,
        tier_distribution,
        bucket_list,
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
    selected_agent_ids: Optional[list[str]] = None,
) -> list[dict]:
    """Auto-distribute campaign leads to selected agents.
    If no agents are selected, defaults to active users with role='call_agent'."""

    result = await db.execute(
        select(Agent)
        .where(Agent.is_active == True)
        .order_by(Agent.created_at.asc())
    )
    all_agents = result.scalars().all()

    selected_ids = [str(agent_id).strip() for agent_id in (selected_agent_ids or []) if str(agent_id).strip()]
    selected_set = set(selected_ids)

    if selected_set:
        assignment_agents = [a for a in all_agents if a.id in selected_set]
    else:
        assignment_agents = [a for a in all_agents if a.role == "call_agent"]

    if not assignment_agents:
        return []

    # Get lead details
    leads = await get_campaign_leads_detail(campaign_id, db)
    if not leads:
        return [{
            "agent_id": a.id, "agent_name": a.name,
            "lead_count": 0, "tier_breakdown": {}, "leads": []
        } for a in assignment_agents]

    # Distribute by priority after splitting leads into top/bottom halves.
    # Top half (higher priority) goes to the first half of agents,
    # bottom half goes to the second half. Each half uses load balancing.
    tier_order = {"P1": 0, "P2": 1, "P3": 2, "P4": 3, "P5": 4, "P6": 5, "P7": 6}
    sorted_leads = sorted(
        leads,
        key=lambda d: (
            tier_order.get(str(d.get("priority_tier")), 9),
            str(d.get("lead_id") or ""),
        ),
    )

    assignments: dict[str, list[dict]] = {a.id: [] for a in assignment_agents}

    lead_split_index = (len(sorted_leads) + 1) // 2
    high_priority_leads = sorted_leads[:lead_split_index]
    low_priority_leads = sorted_leads[lead_split_index:]

    agent_split_index = (len(assignment_agents) + 1) // 2
    high_priority_agents = assignment_agents[:agent_split_index]
    low_priority_agents = assignment_agents[agent_split_index:]

    if not high_priority_agents:
        high_priority_agents = assignment_agents
    if not low_priority_agents:
        low_priority_agents = high_priority_agents

    for lead in high_priority_leads:
        target_agent = min(
            high_priority_agents,
            key=lambda a: (len(assignments.get(a.id, [])), a.created_at),
        )
        assignments[target_agent.id].append(lead)

    for lead in low_priority_leads:
        target_agent = min(
            low_priority_agents,
            key=lambda a: (len(assignments.get(a.id, [])), a.created_at),
        )
        assignments[target_agent.id].append(lead)

    result_list = []
    for agent in assignment_agents:
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


async def execute_agent_assignments(
    campaign_id: str,
    db: AsyncSession,
    selected_agent_ids: Optional[list[str]] = None,
) -> dict:
    """Actually assign leads to agents in the database."""
    assignments = await compute_agent_assignments(campaign_id, db, selected_agent_ids=selected_agent_ids)
    assigned_count = 0
    tasks_assigned = 0
    notifications_by_agent: dict[str, int] = {}

    def _task_plan(priority_tier: str) -> tuple[str, int]:
        tier = _safe_str(priority_tier).upper()
        if tier in {"P1", "P2"}:
            return "high", 1
        if tier in {"P3", "P4"}:
            return "normal", 24
        return "low", 72

    for assignment in assignments:
        agent_id = assignment["agent_id"]
        agent_name = assignment["agent_name"]

        for lead_detail in assignment["leads"]:
            lead = await db.get(Lead, lead_detail["lead_id"])
            if not lead:
                continue

            if lead.assigned_to != agent_id:
                lead.assigned_to = agent_id
                assigned_count += 1

            task_priority, task_due_hours = _task_plan(_safe_str(lead_detail.get("priority_tier")))
            due_at = datetime.utcnow() + timedelta(hours=task_due_hours)

            open_task = await db.scalar(
                select(Task)
                .where(
                    Task.lead_id == lead.id,
                    Task.task_type == "call",
                    Task.status.in_(["pending", "overdue"]),
                )
                .order_by(Task.created_at.desc())
                .limit(1)
            )

            if open_task:
                open_task.assigned_to = agent_id
                open_task.priority = task_priority
                open_task.due_at = due_at
                if open_task.status == "overdue" and due_at > datetime.utcnow():
                    open_task.status = "pending"
            else:
                lead_name = lead_detail.get("name") or "Lead"
                tier = _safe_str(lead_detail.get("priority_tier")) or "P7"
                db.add(
                    Task(
                        lead_id=lead.id,
                        title=f"Campaign callback: {lead_name} ({tier})",
                        description=f"Auto-assigned from campaign {campaign_id} ({agent_name}).",
                        task_type="call",
                        assigned_to=agent_id,
                        due_at=due_at,
                        priority=task_priority,
                        status="pending",
                        created_by=None,
                    )
                )

            tasks_assigned += 1
            notifications_by_agent[agent_id] = notifications_by_agent.get(agent_id, 0) + 1

    for assignment in assignments:
        agent_id = assignment["agent_id"]
        task_count = notifications_by_agent.get(agent_id, 0)
        if task_count <= 0:
            continue

        await create_notification(
            db,
            agent_id=agent_id,
            title=f"New campaign tasks assigned ({task_count})",
            body="Auto-assignment completed. Open Tasks to action your campaign queue.",
            notif_type="task_due",
            link="/tasks",
        )

    await db.flush()
    return {
        "assigned": assigned_count,
        "agents": len(assignments),
        "tasks_assigned": tasks_assigned,
    }
