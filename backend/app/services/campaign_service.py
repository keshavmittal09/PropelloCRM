from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import select, case
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.agent import Agent
from app.models.campaign import Campaign, Project
from app.models.contact import Contact
from app.models.lead import Lead
from app.models.models import Activity
from app.services.lead_service import create_auto_task, create_notification


EXPECTED_FIELDS = [
    "call_id",
    "name",
    "phone_number",
    "transcript",
    "recording_url",
    "extracted_entities",
    "call_eval_tag",
    "summary",
]

STAGE_RANK = {
    "new": 0,
    "contacted": 1,
    "site_visit_scheduled": 2,
    "site_visit_done": 3,
    "negotiation": 4,
    "won": 5,
    "lost": 6,
    "nurture": 1,
}


def _safe_str(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def parse_campaign_file(file_content: bytes, filename: str) -> tuple[list[dict], str]:
    ext = (filename.rsplit(".", 1)[-1].lower() if "." in filename else "")
    rows: list[dict] = []

    if ext == "csv":
        text = file_content.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            lowered = {(_safe_str(k).lower()): v for k, v in (row or {}).items()}
            rows.append({field: _safe_str(lowered.get(field, "")) for field in EXPECTED_FIELDS})
        return rows, "csv"

    if ext == "json":
        payload = json.loads(file_content.decode("utf-8", errors="replace") or "[]")
        if not isinstance(payload, list):
            raise ValueError("JSON payload must be an array of objects")
        for item in payload:
            if not isinstance(item, dict):
                continue
            rows.append({field: _safe_str(item.get(field, "")) for field in EXPECTED_FIELDS})
        return rows, "json"

    raise ValueError("Unsupported file type. Please upload .csv or .json")


def normalise_phone(phone: str) -> str:
    raw = _safe_str(phone)
    digits = re.sub(r"\D", "", raw)
    if raw.startswith("+"):
        return "+" + digits
    if len(digits) == 10:
        return "+91" + digits
    if digits.startswith("91") and len(digits) == 12:
        return "+" + digits
    return "+" + digits if digits else ""


def _contains_any(text: str, terms: list[str]) -> bool:
    return any(term in text for term in terms)


def _load_entities(extracted_entities: str) -> dict:
    value = _safe_str(extracted_entities)
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _pattern_count(text: str, patterns: list[str]) -> int:
    count = 0
    for pattern in patterns:
        if re.search(pattern, text):
            count += 1
    return count


def _signal_features(text: str) -> dict:
    hot_patterns = [
        r"\bsite\s*visit\s*(confirmed|scheduled|arranged)?\b",
        r"\bpick[- ]?up\s*(arranged|confirmed)?\b",
        r"\bfamily\s+(is\s+)?(coming|visiting|visit)\b",
        r"\b(visit|come)\s+(tomorrow|today|this\s+week)\b",
        r"\bwhatsapp\s+(details|brochure|price|pricing)\b",
        r"\b(2|3|4)\s*bhk\b",
        r"\bcarpet\s*area\b",
        r"\bloading\s*percentage\b",
        r"\bdown\s*payment\b",
        r"\bpayment\s*plan\b",
        r"\bhome\s*loan\b",
        r"\b(booked|book|finali[sz]e|confirm(ed)?)\b",
    ]

    warm_patterns = [
        r"\bcould\s*visit\b",
        r"\bmight\s*visit\b",
        r"\bwill\s*think\b",
        r"\bcheck\s*with\s*family\b",
        r"\bcall\s*back\b",
        r"\bneeds?\s*more\s*time\b",
        r"\bif\s*price\s*is\s*right\b",
        r"\binterested\b",
        r"\bcredai\s*expo\b",
    ]

    cold_patterns = [
        r"\bnot\s*interested\b",
        r"\bno\s*interest\b",
        r"\bdon[’']?t\s*want\b",
        r"\balready\s*(bought|invested)\b",
        r"\bbudget\s*too\s*low\b",
        r"\bvoicemail\b",
        r"\bdid\s*not\s*answer\b",
        r"\bno\s*next\s*step\b",
        r"\bremove\b",
        r"\bdo\s*not\s*call\b",
    ]

    concrete_hot_patterns = [
        r"\bsite\s*visit\s*(confirmed|scheduled|arranged)\b",
        r"\bpick[- ]?up\s*(arranged|confirmed)\b",
        r"\b(visit|come)\s*(tomorrow|today)\b",
    ]

    return {
        "hot_count": _pattern_count(text, hot_patterns),
        "warm_count": _pattern_count(text, warm_patterns),
        "cold_count": _pattern_count(text, cold_patterns),
        "concrete_hot": _pattern_count(text, concrete_hot_patterns) > 0,
    }


def classify_lead(summary: str, transcript: str, call_eval_tag: str, extracted_entities: str) -> dict:
    summary_l = _safe_str(summary).lower()
    transcript_l = _safe_str(transcript).lower()
    eval_l = _safe_str(call_eval_tag).lower()
    entities = _load_entities(extracted_entities)

    summary_features = _signal_features(summary_l)
    transcript_features = _signal_features(transcript_l)

    # Summary is primary signal source; transcript acts as fallback/secondary evidence.
    hot_score = (summary_features["hot_count"] * 3) + (transcript_features["hot_count"] * 2)
    warm_score = (summary_features["warm_count"] * 3) + (transcript_features["warm_count"] * 2)
    cold_score = (summary_features["cold_count"] * 3) + (transcript_features["cold_count"] * 2)

    if eval_l == "yes":
        if hot_score > 0:
            hot_score += 2
        else:
            warm_score += 2
    elif eval_l == "no":
        cold_score += 2

    if entities:
        budget = _safe_str(entities.get("budget", "")).lower()
        timeline = _safe_str(entities.get("timeline", "")).lower()
        visit = _safe_str(entities.get("site_visit", "")).lower()
        if budget and timeline and _contains_any(timeline, ["immediate", "1 month", "this week"]):
            hot_score += 2
        if _contains_any(visit, ["yes", "scheduled", "confirmed"]):
            hot_score += 3

    has_hot = hot_score > 0
    has_cold = cold_score > 0
    concrete_hot = summary_features["concrete_hot"] or transcript_features["concrete_hot"]

    # Mixed-signals rule from spec: hot + cold becomes warm unless hot is concrete.
    if has_hot and has_cold and not concrete_hot:
        score = "warm"
    elif hot_score >= max(warm_score, cold_score) and hot_score > 0:
        score = "hot"
    elif cold_score > max(hot_score, warm_score):
        score = "cold"
    else:
        score = "warm"

    blob = f"{summary_l}\n{transcript_l}"
    if score == "hot" and (
        concrete_hot
        or _contains_any(blob, ["site visit", "visit", "pick-up", "pickup", "tomorrow", "arranged"])
    ):
        return {
            "score": "hot",
            "stage": "site_visit_scheduled",
            "priority": "high",
            "task_title": "URGENT: Confirm tomorrow's site visit — reconfirm time and pick-up details",
            "task_due_hours": 1,
        }

    if score == "hot":
        return {
            "score": "hot",
            "stage": "negotiation",
            "priority": "high",
            "task_title": "Hot lead — follow up within 1 hour",
            "task_due_hours": 1,
        }

    if score == "warm":
        return {
            "score": "warm",
            "stage": "contacted",
            "priority": "normal",
            "task_title": "Follow-up call — invite for site visit",
            "task_due_hours": 24,
        }

    return {
        "score": "cold",
        "stage": "contacted",
        "priority": "low",
        "task_title": "Re-engage in 30 days",
        "task_due_hours": 24 * 30,
    }


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)

    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            ins = curr[j - 1] + 1
            delete = prev[j] + 1
            sub = prev[j - 1] + (0 if ca == cb else 1)
            curr.append(min(ins, delete, sub))
        prev = curr
    return prev[-1]


async def find_existing_lead(phone: str, name: str, db: AsyncSession) -> Optional[Lead]:
    if phone:
        result = await db.execute(
            select(Lead)
            .join(Contact, Contact.id == Lead.contact_id)
            .options(selectinload(Lead.contact))
            .where(Contact.phone == phone)
            .order_by(Lead.updated_at.desc())
        )
        lead = result.scalars().first()
        if lead:
            return lead

    name_n = _safe_str(name).lower()
    if not name_n:
        return None

    result = await db.execute(
        select(Lead)
        .join(Contact, Contact.id == Lead.contact_id)
        .options(selectinload(Lead.contact))
        .order_by(Lead.updated_at.desc())
        .limit(200)
    )
    for lead in result.scalars().all():
        contact_name = _safe_str(getattr(lead.contact, "name", "")).lower()
        if contact_name and _levenshtein(contact_name, name_n) <= 2:
            return lead
    return None


async def auto_link_project(campaign_name: str, db: AsyncSession) -> Optional[str]:
    value = _safe_str(campaign_name).lower()
    if not value:
        return None

    result = await db.execute(select(Project))
    for project in result.scalars().all():
        pname = _safe_str(project.name).lower()
        if pname and pname in value:
            return project.id
    return None


def _stage_forward_only(current_stage: str, new_stage: str) -> str:
    current_rank = STAGE_RANK.get(current_stage, 0)
    new_rank = STAGE_RANK.get(new_stage, 0)
    return new_stage if new_rank >= current_rank else current_stage


async def _resolve_notification_agent_id(lead: Lead, db: AsyncSession) -> Optional[str]:
    if lead.assigned_to:
        return lead.assigned_to
    result = await db.execute(
        select(Agent.id)
        .where(Agent.is_active == True)
        .where(Agent.role.in_(["admin", "manager"]))
        .order_by(Agent.created_at.asc())
        .limit(1)
    )
    row = result.first()
    return row[0] if row else None


async def process_campaign_row(row: dict, campaign: Campaign, db: AsyncSession) -> dict:
    name = _safe_str(row.get("name"))
    phone = normalise_phone(row.get("phone_number", ""))
    summary = _safe_str(row.get("summary"))
    transcript = _safe_str(row.get("transcript"))
    recording_url = _safe_str(row.get("recording_url"))
    call_eval_tag = _safe_str(row.get("call_eval_tag"))
    extracted_entities = _safe_str(row.get("extracted_entities"))

    classification = classify_lead(summary, transcript, call_eval_tag, extracted_entities)

    existing = await find_existing_lead(phone, name, db)
    action = "updated" if existing else "created"

    if existing:
        lead = existing
        contact = await db.get(Contact, lead.contact_id)
        if contact:
            if name and (not contact.name or contact.name.lower() == "unknown"):
                contact.name = name
            if phone and contact.phone != phone:
                contact.phone = phone

        lead.lead_score = classification["score"]
        lead.priority = classification["priority"]
        lead.stage = _stage_forward_only(lead.stage, classification["stage"])
        lead.updated_at = datetime.utcnow()
        lead.campaign_id = campaign.id
        current_project_ids = list(lead.project_ids or [])
        if campaign.project_id and campaign.project_id not in current_project_ids:
            current_project_ids.append(campaign.project_id)
            lead.project_ids = current_project_ids

    else:
        contact = Contact(
            name=name or "Unknown",
            phone=phone,
            email=None,
            type="buyer",
            source=f"Campaign — {campaign.name}",
        )
        db.add(contact)
        await db.flush()

        lead = Lead(
            contact_id=contact.id,
            source="campaign",
            stage=classification["stage"],
            lead_score=classification["score"],
            assigned_to=None,
            priority=classification["priority"],
            campaign_id=campaign.id,
            project_ids=[campaign.project_id] if campaign.project_id else [],
            stage_changed_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(lead)
        await db.flush()

    activity = Activity(
        lead_id=lead.id,
        contact_id=lead.contact_id,
        type="campaign_call",
        title=f"Campaign call ingested: {campaign.name}",
        description=summary[:500] if summary else None,
        performed_by=None,
        performed_at=datetime.utcnow(),
        campaign_id=campaign.id,
        recording_url=recording_url or None,
        transcript=transcript or None,
        call_summary=summary or None,
        call_eval_tag=call_eval_tag or None,
        meta={
            "call_id": _safe_str(row.get("call_id")),
            "campaign_name": campaign.name,
            "extracted_entities": _load_entities(extracted_entities),
        },
    )
    db.add(activity)

    await create_auto_task(
        db,
        lead_id=lead.id,
        title=classification["task_title"],
        task_type="call",
        assigned_to=lead.assigned_to,
        hours_from_now=int(classification["task_due_hours"]),
        priority=classification["priority"],
    )

    if classification["score"] == "hot":
        notify_agent_id = await _resolve_notification_agent_id(lead, db)
        if notify_agent_id:
            display_name = name or (contact.name if contact else "Lead")
            await create_notification(
                db,
                agent_id=notify_agent_id,
                title=f"HOT LEAD: {display_name} — {campaign.name} — action required",
                body=f"Campaign call classified as HOT. Immediate action recommended.",
                notif_type="new_lead",
                link=f"/leads/{lead.id}",
            )

    await db.flush()

    return {
        "action": action,
        "lead_id": lead.id,
        "score": classification["score"],
        "stage": lead.stage,
        "priority": lead.priority,
        "name": name or (contact.name if contact else "Unknown"),
        "phone": phone,
        "summary": summary,
    }


async def list_campaign_leads(campaign_id: str, db: AsyncSession) -> list[Lead]:
    result = await db.execute(
        select(Lead)
        .options(selectinload(Lead.contact), selectinload(Lead.assigned_agent))
        .where(Lead.campaign_id == campaign_id)
        .order_by(
            case(
                (Lead.lead_score == "hot", 0),
                (Lead.lead_score == "warm", 1),
                else_=2,
            ),
            Lead.updated_at.desc(),
        )
    )
    return result.scalars().all()
