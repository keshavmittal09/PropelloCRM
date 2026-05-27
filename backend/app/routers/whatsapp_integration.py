"""
WhatsApp Agent integration router.

All five PRD endpoints under /api/whatsapp/*. Service-to-service auth via the
``X-Webhook-Secret`` header (see :func:`app.core.dependencies.require_whatsapp_secret`).
Every endpoint returns HTTP 200 with a structured ack so the bot is never
blocked by CRM-side errors — failures are recorded in dispatch logs instead.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, require_whatsapp_secret
from app.schemas.whatsapp import (
    BulkTriggerAck,
    IntegrationAck,
    WhatsAppBulkTriggerRequest,
    WhatsAppContextResponse,
    WhatsAppEscalateRequest,
    WhatsAppTimelineEvent,
    WhatsAppTriggerRequest,
)
from app.services import whatsapp_integration as svc

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_whatsapp_secret)])


@router.post("/trigger", response_model=IntegrationAck)
async def trigger(payload: WhatsAppTriggerRequest, db: AsyncSession = Depends(get_db)) -> IntegrationAck:
    """R1 — single trigger CRM → bot. Always returns 200."""
    try:
        result = await svc.handle_trigger(
            db,
            phone=payload.phone,
            call_id=payload.call_id,
            message=payload.message,
            lead_id_hint=payload.lead_id,
            template=payload.template,
            template_name=payload.template_name,
            template_params=payload.template_params,
            template_language=payload.template_language,
            extra_meta=payload.meta,
        )
        await db.commit()
        return IntegrationAck(**result)
    except Exception as e:
        logger.exception("trigger endpoint failure")
        await db.rollback()
        return IntegrationAck(status="error", detail=str(e)[:200])


@router.post("/bulk-trigger", response_model=BulkTriggerAck)
async def bulk_trigger(
    payload: WhatsAppBulkTriggerRequest, db: AsyncSession = Depends(get_db)
) -> BulkTriggerAck:
    """R2 — bulk trigger. Schedules an async sender with 1 msg/sec throttle."""
    try:
        if not payload.lead_ids and not payload.phones:
            return BulkTriggerAck(status="skipped", detail="no_targets_provided")
        stats = await svc.schedule_bulk_trigger(
            db,
            call_id=payload.call_id,
            message=payload.message,
            template=payload.template,
            template_name=payload.template_name,
            template_params=payload.template_params,
            template_language=payload.template_language,
            lead_ids=payload.lead_ids,
            phones=payload.phones,
            extra_meta=payload.meta,
        )
        return BulkTriggerAck(status="queued", **stats)
    except Exception as e:
        logger.exception("bulk-trigger endpoint failure")
        await db.rollback()
        return BulkTriggerAck(status="error", detail=str(e)[:200])


@router.get("/context", response_model=WhatsAppContextResponse)
async def context(
    phone: str = Query(..., min_length=4),
    call_id: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> WhatsAppContextResponse:
    """R3 — bot fetches lead context by phone (+ optional call_id for logging)."""
    try:
        data = await svc.fetch_context(db, phone=phone, call_id=call_id)
        return WhatsAppContextResponse(**data)
    except Exception as e:
        logger.exception("context endpoint failure")
        return WhatsAppContextResponse(found=False)


@router.post("/timeline", response_model=IntegrationAck)
async def timeline(payload: WhatsAppTimelineEvent, db: AsyncSession = Depends(get_db)) -> IntegrationAck:
    """R4 — bot syncs an inbound/outbound message; may auto-escalate (R5)."""
    try:
        result = await svc.sync_timeline_event(
            db,
            phone=payload.phone,
            direction=payload.direction,
            message=payload.message,
            call_id=payload.call_id,
            occurred_at=payload.occurred_at,
            ai_score=payload.ai_score,
            intent=payload.intent,
            qualified=payload.qualified,
            summary=payload.summary,
            profile_patch=payload.profile_patch,
            escalate=payload.escalate,
        )
        await db.commit()
        return IntegrationAck(**result)
    except Exception as e:
        logger.exception("timeline endpoint failure")
        await db.rollback()
        return IntegrationAck(status="error", detail=str(e)[:200])


@router.post("/escalate", response_model=IntegrationAck)
async def escalate(
    payload: WhatsAppEscalateRequest, db: AsyncSession = Depends(get_db)
) -> IntegrationAck:
    """R5 — standalone escalation. Reuses Task + Notification flows."""
    try:
        result = await svc.handle_escalation(
            db,
            phone=payload.phone,
            reason=payload.reason,
            ai_score=payload.ai_score,
        )
        await db.commit()
        return IntegrationAck(**result)
    except Exception as e:
        logger.exception("escalate endpoint failure")
        await db.rollback()
        return IntegrationAck(status="error", detail=str(e)[:200])
