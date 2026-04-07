"""
AI Analysis API Endpoints
--------------------------
Exposes the AI analyzer engine to the frontend and external systems.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.core.dependencies import get_db, get_current_user, require_role
from app.models.agent import Agent
from app.models.lead import Lead
from app.models.contact import Contact
from app.services.ai_analyzer import analyze_lead, batch_analyze, suggest_followup_message

router = APIRouter()


@router.post("/analyze/{lead_id}")
async def analyze_single_lead(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Trigger AI analysis for a specific lead. Returns the analysis result."""
    result = await db.execute(
        select(Lead).options(selectinload(Lead.contact)).where(Lead.id == lead_id)
    )
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    contact = await db.get(Contact, lead.contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    analysis = await analyze_lead(db, lead, contact)
    if not analysis:
        return {"status": "skipped", "reason": "AI engine unavailable (GROQ_API_KEY not configured)"}

    await db.commit()
    return {"status": "analyzed", "lead_id": lead_id, "analysis": analysis}


@router.post("/suggest-message/{lead_id}")
async def suggest_message(
    lead_id: str,
    channel: str = "whatsapp",
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Generate a personalized follow-up message for a lead."""
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    contact = await db.get(Contact, lead.contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    message = await suggest_followup_message(
        db, lead, contact,
        channel=channel,
        agent_name=current_user.name,
    )

    if not message:
        return {"status": "skipped", "reason": "AI engine unavailable"}

    return {"status": "generated", "channel": channel, "message": message}


@router.post("/batch-analyze")
async def batch_analyze_leads(
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(require_role("admin", "manager")),
):
    """Re-analyze all active leads. Admin/manager only."""
    count = await batch_analyze(db)
    return {"status": "complete", "leads_analyzed": count}
