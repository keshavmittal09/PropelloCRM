"""
Demographic sync service — handles syncing task-completion form data
back to the lead's demographic profile.
"""
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.lead import Lead
from app.models.models import Task, Activity
from app.models.contact import Contact
from app.schemas.schemas import DemographicsInput


# Values that represent "unknown / not provided" — never overwrite existing data with these
UNKNOWN_VALUES = {"unknown", "dont_know", "don't know", "not_sure", "पता नहीं", ""}


def _is_unknown(value: Optional[str]) -> bool:
    if value is None:
        return True
    return value.strip().lower() in UNKNOWN_VALUES


async def sync_demographics_to_lead(
    db: AsyncSession,
    lead: Lead,
    demographics: Optional[DemographicsInput],
    call_status: str,
    interest_level: Optional[str],
    topics_discussed: list[str],
    note: Optional[str],
    agent_id: str,
) -> list[str]:
    """
    Apply demographic data from task completion form to a lead.
    Returns list of field names that were updated.
    """
    updated_fields: list[str] = []

    # --- Call quality fields (always update) ---
    lead.last_call_status = call_status
    updated_fields.append("last_call_status")

    if interest_level:
        lead.last_call_interest = interest_level
        updated_fields.append("last_call_interest")

    if topics_discussed is not None:
        lead.last_call_topics = topics_discussed
        updated_fields.append("last_call_topics")

    lead.last_contacted_at = datetime.utcnow()
    lead.last_interaction_at = datetime.utcnow()
    lead.call_count = (lead.call_count or 0) + 1
    updated_fields.extend(["last_contacted_at", "last_interaction_at", "call_count"])

    # --- Demographic fields (skip if unknown) ---
    if demographics:
        demo = demographics
        fields_to_sync = [
            ("age_range", demo.age_range),
            ("occupation", demo.occupation),
            ("family_size", demo.family_size),
            ("income_range", demo.income_range),
            ("property_budget", demo.property_budget),
            ("preferred_location", demo.preferred_location),
            ("purchase_timeline", demo.purchase_timeline),
        ]

        for field_name, field_value in fields_to_sync:
            if _is_unknown(field_value):
                continue
            current = getattr(lead, field_name, None)
            if _is_unknown(current) or current is None:
                setattr(lead, field_name, field_value)
                updated_fields.append(field_name)

        # occupation_other only applies when occupation == "other"
        if demo.occupation_other and demo.occupation == "other":
            lead.occupation_other = demo.occupation_other
            updated_fields.append("occupation_other")
        elif demo.occupation and demo.occupation != "other":
            lead.occupation_other = None

        # Write current_living_situation and investment_purpose to master_profile JSON
        mp = lead.master_profile or {}
        if demo.current_living_situation:
            mp["current_living_situation"] = demo.current_living_situation
            updated_fields.append("current_living_situation")
        if demo.investment_purpose:
            mp["investment_purpose"] = demo.investment_purpose
            updated_fields.append("investment_purpose")
        if mp:
            lead.master_profile = mp

    # --- Note: append (never replace) ---
    if note and note.strip():
        contact = await db.get(Contact, lead.contact_id)
        contact_name = contact.name if contact else "Lead"
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
        new_note = f"[{timestamp} - {agent_id}]: {note.strip()}"

        existing = lead.last_remark or ""
        lead.last_remark = f"{existing}\n{new_note}".strip() if existing else new_note
        updated_fields.append("last_remark")

    lead.updated_at = datetime.utcnow()

    # --- Activity log entry ---
    activity = Activity(
        lead_id=lead.id,
        contact_id=lead.contact_id,
        type="task_completion_remark",
        title=f"Task completed — Call {call_status}",
        description=note.strip() if note else None,
        performed_by=agent_id,
        meta={
            "call_status": call_status,
            "interest_level": interest_level,
            "topics_discussed": topics_discussed,
            "demographics_updated": updated_fields,
        },
    )
    db.add(activity)

    await db.flush()
    return updated_fields


async def create_followup_from_completion(
    db: AsyncSession,
    lead: Lead,
    next_followup_at: Optional[datetime],
    agent_id: str,
) -> Optional[Task]:
    """
    Create a follow-up task if next_followup_at is provided.
    Returns the created Task or None.
    """
    if not next_followup_at:
        return None

    # Determine priority from interest level
    priority = "high"
    if lead.last_call_interest == "warm":
        priority = "normal"
    elif lead.last_call_interest == "cold":
        priority = "low"

    task = Task(
        lead_id=lead.id,
        title=f"Follow up — {lead.contact.name if lead.contact else 'Lead'}",
        task_type="call",
        assigned_to=agent_id,
        due_at=next_followup_at,
        priority=priority,
        status="pending",
        created_by=agent_id,
    )
    db.add(task)
    await db.flush()
    return task
