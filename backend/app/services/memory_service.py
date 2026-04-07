from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.models import Activity
from app.models.lead import Lead
from app.models.contact import Contact


async def build_memory_brief(db: AsyncSession, lead: Lead, contact: Contact) -> str:
    """
    Builds the structured memory context string injected into Priya's system prompt.
    Called every time a new activity is logged against a lead.
    """
    # Fetch all activities for this lead, newest first
    result = await db.execute(
        select(Activity)
        .where(Activity.lead_id == lead.id)
        .order_by(Activity.performed_at.desc())
        .limit(10)
    )
    activities = result.scalars().all()

    # Calculate time since last contact
    days_since = None
    if lead.last_contacted_at:
        delta = datetime.utcnow() - lead.last_contacted_at
        days_since = delta.days

    # Build the brief sections
    lines = []

    # Returning vs new caller instruction
    if lead.call_count > 1:
        lines.append(f"RETURNING CLIENT — DO NOT ask for name, budget, or requirements again.\n")
    else:
        lines.append(f"FIRST-TIME CALLER — Introduce Propello and gather requirements naturally.\n")

    # Client identity
    lines.append(f"Client: {contact.name} | Called {lead.call_count} time(s) | "
                 f"Stage: {lead.stage.replace('_', ' ').title()} | Score: {lead.lead_score.upper()}")

    if days_since is not None:
        if days_since == 0:
            lines.append(f"Last contact: today")
        elif days_since == 1:
            lines.append(f"Last contact: yesterday")
        elif days_since < 30:
            lines.append(f"Last contact: {days_since} days ago")
        else:
            months = days_since // 30
            lines.append(f"Last contact: approximately {months} month(s) ago")

    # Budget and requirements
    budget_str = ""
    if lead.budget_min and lead.budget_max:
        budget_str = f"₹{lead.budget_min/100000:.0f}L–₹{lead.budget_max/100000:.0f}L"
    elif lead.budget_max:
        budget_str = f"Up to ₹{lead.budget_max/100000:.0f}L"

    if budget_str or lead.property_type_interest or lead.location_preference:
        req_parts = []
        if budget_str:
            req_parts.append(f"Budget: {budget_str}")
        if lead.property_type_interest:
            req_parts.append(f"Looking for: {lead.property_type_interest}")
        if lead.location_preference:
            req_parts.append(f"Location: {lead.location_preference}")
        if lead.timeline:
            req_parts.append(f"Timeline: {lead.timeline.replace('_', ' ')}")
        lines.append(" | ".join(req_parts))

    # Personal notes from contact record
    if contact.personal_notes:
        lines.append(f"Personal notes: {contact.personal_notes}")

    # Recent activity summary
    if activities:
        lines.append("\nRecent interactions:")
        for act in activities[:5]:
            date_str = act.performed_at.strftime("%b %d")
            lines.append(f"  [{date_str}] {act.title}" + (f" — {act.outcome}" if act.outcome else ""))

    # Properties shown
    if lead.interested_properties:
        try:
            import json
            prop_ids = json.loads(lead.interested_properties)
            if prop_ids:
                lines.append(f"Properties shown: {len(prop_ids)} listing(s) shared previously")
        except Exception:
            pass

    # Lost reason / nurture context
    if lead.stage == "lost" and lead.lost_reason:
        lines.append(f"\nPreviously marked lost: {lead.lost_reason}")
    if lead.stage == "nurture":
        lines.append(f"\nIn re-engagement queue — approach warmly, no pressure")

    # Tone instructions
    lines.append("\nINSTRUCTIONS:")
    if lead.call_count > 1:
        lines.append(f"  - Greet {contact.name} by name immediately")
        if days_since and days_since > 30:
            lines.append(f"  - Acknowledge naturally: 'It's been a while since we spoke'")
        lines.append(f"  - Ask if timeline or budget has changed since last call")
        lines.append(f"  - Reference previous conversation naturally")
        lines.append(f"  - Do NOT ask for name, phone, or budget from scratch")
    else:
        lines.append(f"  - Introduce yourself and Propello warmly")
        lines.append(f"  - Gather: budget, property type, location, timeline")
        lines.append(f"  - End call with a clear next step")

    return "\n".join(lines)
