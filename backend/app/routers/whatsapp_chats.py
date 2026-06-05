from datetime import datetime
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_user, get_db
from app.models.agent import Agent
from app.models.contact import Contact
from app.models.lead import Lead
from app.models.whatsapp import WhatsAppMessage

router = APIRouter()


def _normalise(phone: str) -> str:
    p = phone.strip().replace("+", "").replace(" ", "").replace("-", "")
    return f"91{p}" if len(p) == 10 else p


# ── Webhook: Railway agent posts messages here ─────────────────────────────────
class TimelinePayload(BaseModel):
    phone: str
    message: str
    direction: str = "inbound"       # inbound | outbound
    sender_name: Optional[str] = None
    wa_message_id: Optional[str] = None
    timestamp: Optional[datetime] = None
    campaign: Optional[str] = None


@router.post("/timeline")
async def receive_whatsapp_timeline(
    payload: TimelinePayload,
    x_webhook_secret: str = Header(default=""),
    db: AsyncSession = Depends(get_db),
):
    if x_webhook_secret != settings.WHATSAPP_CAMPAIGN_SECRET:
        raise HTTPException(status_code=401, detail="Invalid secret")

    phone = _normalise(payload.phone)

    # Find contact by phone
    contact_result = await db.execute(select(Contact).where(Contact.phone == phone))
    contact = contact_result.scalar_one_or_none()

    # Find lead linked to this contact
    lead_id = None
    if contact:
        lead_result = await db.execute(
            select(Lead).where(Lead.contact_id == contact.id).order_by(Lead.created_at.desc()).limit(1)
        )
        lead = lead_result.scalar_one_or_none()
        lead_id = lead.id if lead else None

    # Dedup by wa_message_id
    if payload.wa_message_id:
        existing = await db.execute(select(WhatsAppMessage).where(WhatsAppMessage.wa_message_id == payload.wa_message_id))
        if existing.scalar_one_or_none():
            return {"status": "duplicate", "skipped": True}

    msg = WhatsAppMessage(
        id=str(uuid.uuid4()),
        phone=phone,
        contact_id=contact.id if contact else None,
        lead_id=lead_id,
        direction=payload.direction,
        message=payload.message,
        wa_message_id=payload.wa_message_id,
        sender_name=payload.sender_name,
        timestamp=payload.timestamp or datetime.utcnow(),
    )
    db.add(msg)
    await db.commit()

    # Auto-trigger AI analysis if we have a lead and message is inbound
    if lead_id and payload.direction == "inbound":
        try:
            from app.services.ai_analyzer import analyze_lead
            lead_obj = await db.get(Lead, lead_id)
            if lead_obj:
                await analyze_lead(lead_obj, db)
                await db.commit()
        except Exception:
            pass

    return {"status": "ok", "message_id": msg.id, "lead_id": lead_id}


# ── Get chat history for a lead ────────────────────────────────────────────────
@router.get("/lead/{lead_id}")
async def get_lead_chats(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    contact = await db.get(Contact, lead.contact_id)
    phone = _normalise(contact.phone) if contact and contact.phone else None

    if not phone:
        return []

    result = await db.execute(
        select(WhatsAppMessage)
        .where(WhatsAppMessage.phone == phone)
        .order_by(WhatsAppMessage.timestamp.asc())
    )
    msgs = result.scalars().all()
    return [
        {
            "id": m.id,
            "phone": m.phone,
            "direction": m.direction,
            "message": m.message,
            "sender_name": m.sender_name,
            "timestamp": m.timestamp.isoformat(),
        }
        for m in msgs
    ]
