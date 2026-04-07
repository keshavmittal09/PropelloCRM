"""
Priya AI ↔ CRM Bridge
-----------------------
Two-way communication between the Priya AI chatbot and the CRM.
- Chatbot pushes captured leads here
- Chatbot fetches memory context from here before each conversation
- Chatbot reports conversation end with transcript summary
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.core.dependencies import get_db
from app.core.config import settings
from app.models.lead import Lead
from app.models.contact import Contact
from app.schemas.schemas import InboundLead, InboundLeadResponse, MemoryResponse, ContactResponse, LeadResponse
from app.services.lead_service import process_inbound_lead, log_activity, find_contact_by_phone
from app.services.memory_service import build_memory_brief
from pydantic import BaseModel
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


def _verify_priya_secret(secret: Optional[str]):
    if secret != settings.PRIYA_WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid Priya secret")


# ─── LEAD CAPTURED ────────────────────────────────────────────────────────────

@router.post("/lead-captured", response_model=InboundLeadResponse)
async def priya_lead_captured(
    data: InboundLead,
    db: AsyncSession = Depends(get_db),
    x_priya_secret: Optional[str] = Header(None),
):
    """
    Called by Priya AI after every conversation where lead data is extracted.
    This replaces/supplements Priya's log_lead_to_csv() function.
    """
    _verify_priya_secret(x_priya_secret)
    data.source = "priya_ai"
    logger.info(f"[Priya Bridge] Lead captured: {data.name} | {data.phone}")
    result = await process_inbound_lead(db, data)
    return InboundLeadResponse(**result)


# ─── MEMORY LOOKUP ────────────────────────────────────────────────────────────

@router.get("/memory/{phone}", response_model=MemoryResponse)
async def priya_get_memory(
    phone: str,
    db: AsyncSession = Depends(get_db),
    x_priya_secret: Optional[str] = Header(None),
):
    """
    Called by Priya at the START of each conversation.
    Returns the full memory brief, lead status, and activity history.
    Priya injects this into her system prompt for personalized conversations.
    """
    _verify_priya_secret(x_priya_secret)

    contact = await find_contact_by_phone(db, phone)
    if not contact:
        return MemoryResponse(
            phone=phone,
            is_returning_caller=False,
            contact=None,
            lead=None,
            priya_memory_brief=None,
            call_count=0,
        )

    # Find the most recent active lead
    result = await db.execute(
        select(Lead)
        .options(selectinload(Lead.contact), selectinload(Lead.assigned_agent))
        .where(Lead.contact_id == contact.id)
        .where(Lead.stage.notin_(["won", "lost"]))
        .order_by(Lead.created_at.desc())
        .limit(1)
    )
    lead = result.scalar_one_or_none()

    memory_brief = None
    if lead:
        memory_brief = await build_memory_brief(db, lead, contact)

    return MemoryResponse(
        phone=phone,
        is_returning_caller=lead.call_count > 0 if lead else False,
        contact=ContactResponse.model_validate(contact) if contact else None,
        lead=LeadResponse.model_validate(lead) if lead else None,
        priya_memory_brief=memory_brief,
        call_count=lead.call_count if lead else 0,
    )


# ─── CONVERSATION ENDED ──────────────────────────────────────────────────────

class ConversationEndPayload(BaseModel):
    phone: str
    transcript_summary: Optional[str] = None
    call_duration_seconds: Optional[int] = None
    lead_data: Optional[dict] = None  # Any additional extracted lead info


@router.post("/conversation-ended")
async def priya_conversation_ended(
    data: ConversationEndPayload,
    db: AsyncSession = Depends(get_db),
    x_priya_secret: Optional[str] = Header(None),
):
    """
    Called by Priya when a chat/call session ends.
    Updates the lead's memory brief and logs the conversation activity.
    """
    _verify_priya_secret(x_priya_secret)

    contact = await find_contact_by_phone(db, data.phone)
    if not contact:
        return {"status": "skipped", "reason": "Contact not found"}

    # Find active lead
    result = await db.execute(
        select(Lead).where(
            Lead.contact_id == contact.id,
            Lead.stage.notin_(["won", "lost"]),
        ).order_by(Lead.created_at.desc()).limit(1)
    )
    lead = result.scalar_one_or_none()

    if not lead:
        return {"status": "skipped", "reason": "No active lead found"}

    # Log the conversation activity
    await log_activity(
        db, lead.id, contact.id,
        activity_type="priya_call",
        title="Priya AI conversation ended",
        description=data.transcript_summary,
        meta={
            "call_duration_seconds": data.call_duration_seconds,
            "lead_data_update": data.lead_data,
        },
    )

    # Update call count and last contacted
    lead.call_count += 1
    lead.last_contacted_at = __import__("datetime").datetime.utcnow()

    # Rebuild memory brief
    lead.priya_memory_brief = await build_memory_brief(db, lead, contact)

    await db.commit()
    logger.info(f"[Priya Bridge] Conversation ended for {contact.name} (lead {lead.id})")

    return {"status": "updated", "lead_id": lead.id}
