from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import String, asc, cast, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_user, get_db
from app.models.agent import Agent
from app.models.campaign_dashboard import CampaignBatch, CampaignFlag, CampaignLead
from app.services.campaign_dashboard_ai import callback_script_with_groq, campaign_chat_with_groq
from app.services.campaign_dashboard_service import (
    CampaignDashboardError,
    clear_progress,
    create_batch_from_upload,
    get_batch_with_leads,
    get_progress,
    progress_stream,
    start_analysis_task,
)

router = APIRouter()


class LeadActionUpdate(BaseModel):
    assigned_agent: Optional[str] = None
    whatsapp_sent: Optional[bool] = None
    dnd_flag: Optional[bool] = None
    action_taken: Optional[str] = None
    callback_script: Optional[str] = None
    notes: Optional[str] = None


class ChatRequest(BaseModel):
    batch_id: str
    question: str = Field(min_length=1)
    history: list[dict[str, str]] = Field(default_factory=list)


class TriggerWorkflowRequest(BaseModel):
    batch_id: str
    webhook_url: Optional[str] = None


class FlagUpdateRequest(BaseModel):
    resolved: bool = True


@router.post("/upload-call-sheet")
async def upload_call_sheet(
    campaign_name: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    try:
        batch = await create_batch_from_upload(db, file, campaign_name)
    except CampaignDashboardError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    start_analysis_task(batch.id)

    return {
        "status": "processing",
        "message": "File uploaded and analysis started",
        "batch_id": batch.id,
        "campaign_name": batch.name,
        "total_leads": batch.total_leads,
        "uploaded_by": current_user.id,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
    }


@router.get("/campaign-progress/{batch_id}")
async def stream_campaign_progress(
    batch_id: str,
    current_user: Agent = Depends(get_current_user),
):
    return StreamingResponse(
        progress_stream(batch_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/campaign-status/{batch_id}")
async def campaign_status(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    batch = await db.scalar(select(CampaignBatch).where(CampaignBatch.id == batch_id))
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    progress = get_progress(batch_id)
    return {
        "batch_id": batch.id,
        "campaign_name": batch.name,
        "analysis_status": batch.analysis_status,
        "total_leads": batch.total_leads,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
        "progress": progress,
    }


@router.get("/campaign-results/{batch_id}")
async def campaign_results(
    batch_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=1000),
    priority_tier: Optional[str] = Query(None),
    intent_level: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    dnd_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    batch = await db.scalar(select(CampaignBatch).where(CampaignBatch.id == batch_id))
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    filters = [CampaignLead.batch_id == batch_id]
    if priority_tier:
        filters.append(CampaignLead.priority_tier == priority_tier)
    if intent_level:
        filters.append(CampaignLead.intent_level == intent_level)
    if dnd_only:
        filters.append(CampaignLead.dnd_flag.is_(True))
    if search:
        normalized = search.strip()
        if normalized:
            like = f"%{normalized}%"
            filters.append(
                or_(
                    CampaignLead.name.ilike(like),
                    cast(CampaignLead.phone_number, String).ilike(like),
                )
            )

    total_filtered = await db.scalar(select(func.count(CampaignLead.id)).where(*filters))

    lead_rows = (
        await db.scalars(
            select(CampaignLead)
            .where(*filters)
            .order_by(desc(CampaignLead.lead_score), asc(CampaignLead.name))
            .offset((page - 1) * limit)
            .limit(limit)
        )
    ).all()

    return {
        "batch": {
            "id": batch.id,
            "name": batch.name,
            "file_name": batch.file_name,
            "analysis_status": batch.analysis_status,
            "total_leads": batch.total_leads,
            "p1_count": batch.p1_count,
            "p2_count": batch.p2_count,
            "p3_count": batch.p3_count,
            "p4_count": batch.p4_count,
            "p5_count": batch.p5_count,
            "avg_quality_score": batch.avg_quality_score,
            "conversion_rate": batch.conversion_rate,
            "campaign_health_score": batch.campaign_health_score,
            "campaign_health_label": batch.campaign_health_label,
            "insights": batch.ai_insights,
            "created_at": batch.created_at.isoformat() if batch.created_at else None,
        },
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total_filtered,
            "total_pages": (total_filtered + limit - 1) // limit if total_filtered else 0,
        },
        "leads": [
            {
                "id": lead.id,
                "name": lead.name,
                "phone_number": lead.phone_number,
                "attempt_number": lead.attempt_number,
                "call_eval_tag": lead.call_eval_tag,
                "summary": lead.summary,
                "call_conversation_quality": lead.call_conversation_quality,
                "call_dialing_at": lead.call_dialing_at.isoformat() if lead.call_dialing_at else None,
                "num_of_retries": lead.num_of_retries,
                "priority_tier": lead.priority_tier,
                "lead_score": lead.lead_score,
                "intent_level": lead.intent_level,
                "engagement_quality": lead.engagement_quality,
                "drop_reason": lead.drop_reason,
                "objection_type": lead.objection_type,
                "recommended_action": lead.recommended_action,
                "callback_urgency_hours": lead.callback_urgency_hours,
                "language_preference": lead.language_preference,
                "pitch_reached": lead.pitch_reached,
                "closing_attempted": lead.closing_attempted,
                "whatsapp_number_captured": lead.whatsapp_number_captured,
                "site_visit_committed": lead.site_visit_committed,
                "site_visit_timeframe": lead.site_visit_timeframe,
                "ai_detected_by_user": lead.ai_detected_by_user,
                "audio_quality_issue": lead.audio_quality_issue,
                "audio_loop_detected": lead.audio_loop_detected,
                "script_issue_detected": lead.script_issue_detected,
                "retry_time_recommendation": lead.retry_time_recommendation,
                "enriched_summary": lead.enriched_summary,
                "sales_coach_note": lead.sales_coach_note,
                "transcript_depth": lead.transcript_depth,
                "user_engagement_ratio": lead.user_engagement_ratio,
                "assigned_agent": lead.assigned_agent,
                "whatsapp_sent": lead.whatsapp_sent,
                "dnd_flag": lead.dnd_flag,
                "action_taken": lead.action_taken,
                "callback_script": lead.callback_script,
            }
            for lead in lead_rows
        ],
    }


@router.get("/lead-details/{lead_id}")
async def lead_details(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    lead = await db.scalar(select(CampaignLead).where(CampaignLead.id == lead_id))
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    history_rows = (
        await db.scalars(
            select(CampaignLead)
            .where(CampaignLead.batch_id == lead.batch_id, CampaignLead.phone_number == lead.phone_number)
            .order_by(desc(CampaignLead.attempt_number), desc(CampaignLead.call_dialing_at))
        )
    ).all()

    batch = await db.scalar(select(CampaignBatch).where(CampaignBatch.id == lead.batch_id))

    return {
        "batch": {
            "id": batch.id if batch else None,
            "name": batch.name if batch else None,
            "status": batch.analysis_status if batch else None,
        },
        "lead": {
            "id": lead.id,
            "batch_id": lead.batch_id,
            "name": lead.name,
            "phone_number": lead.phone_number,
            "attempt_number": lead.attempt_number,
            "call_id": lead.call_id,
            "transcript": lead.transcript,
            "recording_url": lead.recording_url,
            "extracted_entities": lead.extracted_entities,
            "call_eval_tag": lead.call_eval_tag,
            "summary": lead.summary,
            "call_conversation_quality": lead.call_conversation_quality,
            "call_dialing_at": lead.call_dialing_at.isoformat() if lead.call_dialing_at else None,
            "call_ringing_at": lead.call_ringing_at.isoformat() if lead.call_ringing_at else None,
            "user_picked_up": lead.user_picked_up.isoformat() if lead.user_picked_up else None,
            "num_of_retries": lead.num_of_retries,
            "priority_tier": lead.priority_tier,
            "lead_score": lead.lead_score,
            "intent_level": lead.intent_level,
            "engagement_quality": lead.engagement_quality,
            "drop_reason": lead.drop_reason,
            "objection_type": lead.objection_type,
            "objection_handleable": lead.objection_handleable,
            "recommended_action": lead.recommended_action,
            "callback_urgency_hours": lead.callback_urgency_hours,
            "config_interest": lead.config_interest,
            "budget_signal": lead.budget_signal,
            "language_preference": lead.language_preference,
            "pitch_reached": lead.pitch_reached,
            "closing_attempted": lead.closing_attempted,
            "whatsapp_number_captured": lead.whatsapp_number_captured,
            "site_visit_committed": lead.site_visit_committed,
            "site_visit_timeframe": lead.site_visit_timeframe,
            "ai_detected_by_user": lead.ai_detected_by_user,
            "audio_quality_issue": lead.audio_quality_issue,
            "audio_loop_detected": lead.audio_loop_detected,
            "script_issue_detected": lead.script_issue_detected,
            "retry_time_recommendation": lead.retry_time_recommendation,
            "enriched_summary": lead.enriched_summary,
            "key_quote": lead.key_quote,
            "sales_coach_note": lead.sales_coach_note,
            "transcript_depth": lead.transcript_depth,
            "user_engagement_ratio": lead.user_engagement_ratio,
            "assigned_agent": lead.assigned_agent,
            "whatsapp_sent": lead.whatsapp_sent,
            "dnd_flag": lead.dnd_flag,
            "action_taken": lead.action_taken,
            "callback_script": lead.callback_script,
            "notes": lead.notes,
            "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
        },
        "history": [
            {
                "id": item.id,
                "attempt_number": item.attempt_number,
                "priority_tier": item.priority_tier,
                "lead_score": item.lead_score,
                "drop_reason": item.drop_reason,
                "summary": item.enriched_summary or item.summary,
                "call_dialing_at": item.call_dialing_at.isoformat() if item.call_dialing_at else None,
            }
            for item in history_rows
        ],
    }


@router.post("/update-lead-action/{lead_id}")
async def update_lead_action(
    lead_id: str,
    payload: LeadActionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    lead = await db.scalar(select(CampaignLead).where(CampaignLead.id == lead_id))
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(lead, key, value)

    lead.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(lead)

    return {
        "status": "ok",
        "lead_id": lead.id,
        "updated_fields": list(updates.keys()),
        "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
    }


@router.post("/campaign-chat")
async def campaign_chat(
    payload: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    batch, leads = await get_batch_with_leads(db, payload.batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    top_p1 = [
        {
            "id": lead.id,
            "name": lead.name,
            "phone_number": lead.phone_number,
            "score": lead.lead_score,
            "reason": lead.recommended_action,
        }
        for lead in sorted([x for x in leads if x.priority_tier == "P1"], key=lambda x: (x.lead_score or 0), reverse=True)[:10]
    ]

    context = {
        "batch": {
            "id": batch.id,
            "name": batch.name,
            "status": batch.analysis_status,
            "total_leads": batch.total_leads,
            "p1_count": batch.p1_count,
            "p2_count": batch.p2_count,
            "p3_count": batch.p3_count,
            "p4_count": batch.p4_count,
            "p5_count": batch.p5_count,
            "conversion_rate": batch.conversion_rate,
            "health_score": batch.campaign_health_score,
            "health_label": batch.campaign_health_label,
            "insights": batch.ai_insights,
        },
        "top_p1_leads": top_p1,
    }

    answer = await campaign_chat_with_groq(payload.question, context, payload.history)
    if not answer:
        answer = "Unable to generate an AI response right now. Please retry in a moment."

    return {"answer": answer}


@router.post("/callback-script/{lead_id}")
async def callback_script(
    lead_id: str,
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    lead = await db.scalar(select(CampaignLead).where(CampaignLead.id == lead_id))
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if lead.callback_script and not force:
        return {"lead_id": lead.id, "callback_script": lead.callback_script, "cached": True}

    script = await callback_script_with_groq(
        {
            "name": lead.name,
            "attempt_number": lead.attempt_number,
            "enriched_summary": lead.enriched_summary,
            "summary": lead.summary,
            "drop_reason": lead.drop_reason,
            "objection_type": lead.objection_type,
            "objection_handleable": lead.objection_handleable,
            "config_interest": lead.config_interest,
            "language_preference": lead.language_preference,
            "key_quote": lead.key_quote,
            "sales_coach_note": lead.sales_coach_note,
        }
    )

    if not script:
        raise HTTPException(status_code=503, detail="Could not generate callback script")

    lead.callback_script = script
    lead.updated_at = datetime.utcnow()
    await db.commit()

    return {"lead_id": lead.id, "callback_script": script, "cached": False}


@router.get("/campaign-red-flags/{batch_id}")
async def campaign_red_flags(
    batch_id: str,
    unresolved_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    filters = [CampaignFlag.batch_id == batch_id]
    if unresolved_only:
        filters.append(CampaignFlag.resolved.is_(False))

    flags = (
        await db.scalars(
            select(CampaignFlag)
            .where(*filters)
            .order_by(desc(CampaignFlag.created_at))
        )
    ).all()

    return {
        "batch_id": batch_id,
        "total": len(flags),
        "flags": [
            {
                "id": flag.id,
                "lead_id": flag.lead_id,
                "flag_type": flag.flag_type,
                "description": flag.description,
                "resolved": flag.resolved,
                "created_at": flag.created_at.isoformat() if flag.created_at else None,
            }
            for flag in flags
        ],
    }


@router.post("/resolve-flag/{flag_id}")
async def resolve_flag(
    flag_id: str,
    payload: FlagUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    flag = await db.scalar(select(CampaignFlag).where(CampaignFlag.id == flag_id))
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found")

    flag.resolved = payload.resolved
    await db.commit()
    await db.refresh(flag)

    return {
        "status": "ok",
        "flag_id": flag.id,
        "resolved": flag.resolved,
    }


@router.get("/campaign-analytics/{batch_id}")
async def campaign_analytics(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    batch, leads = await get_batch_with_leads(db, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    by_hour: dict[str, int] = {}
    by_objection: dict[str, int] = {}
    by_drop_reason: dict[str, int] = {}

    for lead in leads:
        if lead.call_dialing_at:
            key = f"{lead.call_dialing_at.hour:02d}:00"
            by_hour[key] = by_hour.get(key, 0) + 1

        objection = lead.objection_type or "none"
        by_objection[objection] = by_objection.get(objection, 0) + 1

        drop_reason = lead.drop_reason or "none"
        by_drop_reason[drop_reason] = by_drop_reason.get(drop_reason, 0) + 1

    return {
        "batch": {
            "id": batch.id,
            "name": batch.name,
            "total_leads": batch.total_leads,
            "p1_count": batch.p1_count,
            "p2_count": batch.p2_count,
            "p3_count": batch.p3_count,
            "p4_count": batch.p4_count,
            "p5_count": batch.p5_count,
            "avg_quality_score": batch.avg_quality_score,
            "conversion_rate": batch.conversion_rate,
            "campaign_health_score": batch.campaign_health_score,
            "campaign_health_label": batch.campaign_health_label,
        },
        "distribution": {
            "by_hour": by_hour,
            "by_objection": by_objection,
            "by_drop_reason": by_drop_reason,
        },
        "insights": batch.ai_insights,
    }


@router.post("/trigger-workflow")
async def trigger_workflow(
    payload: TriggerWorkflowRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    batch, leads = await get_batch_with_leads(db, payload.batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    url = payload.webhook_url or settings.N8N_WEBHOOK_URL
    if not url:
        raise HTTPException(status_code=400, detail="Webhook URL not configured")

    body = {
        "batch": {
            "id": batch.id,
            "name": batch.name,
            "status": batch.analysis_status,
            "total_leads": batch.total_leads,
            "p1_count": batch.p1_count,
            "p2_count": batch.p2_count,
            "p3_count": batch.p3_count,
            "p4_count": batch.p4_count,
            "p5_count": batch.p5_count,
            "conversion_rate": batch.conversion_rate,
            "campaign_health_score": batch.campaign_health_score,
            "campaign_health_label": batch.campaign_health_label,
        },
        "leads": [
            {
                "lead_id": lead.id,
                "name": lead.name,
                "phone_number": lead.phone_number,
                "priority_tier": lead.priority_tier,
                "lead_score": lead.lead_score,
                "recommended_action": lead.recommended_action,
                "assigned_agent": lead.assigned_agent,
                "whatsapp_sent": lead.whatsapp_sent,
                "dnd_flag": lead.dnd_flag,
                "action_taken": lead.action_taken,
            }
            for lead in leads
        ],
        "triggered_by": current_user.id,
        "triggered_at": datetime.utcnow().isoformat(),
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=body)
            response.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Workflow trigger failed: {exc}") from exc

    return {
        "status": "ok",
        "batch_id": batch.id,
        "webhook_url": url,
        "leads_sent": len(leads),
    }


@router.get("/batches")
async def list_batches(
    limit: int = Query(25, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    batches = (
        await db.scalars(
            select(CampaignBatch)
            .order_by(desc(CampaignBatch.created_at))
            .limit(limit)
        )
    ).all()

    return {
        "count": len(batches),
        "items": [
            {
                "id": b.id,
                "name": b.name,
                "file_name": b.file_name,
                "analysis_status": b.analysis_status,
                "total_leads": b.total_leads,
                "campaign_health_score": b.campaign_health_score,
                "campaign_health_label": b.campaign_health_label,
                "conversion_rate": b.conversion_rate,
                "created_at": b.created_at.isoformat() if b.created_at else None,
            }
            for b in batches
        ],
    }


@router.delete("/batch/{batch_id}")
async def delete_batch(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role not in {"admin", "manager"}:
        raise HTTPException(status_code=403, detail="Only admin or manager can remove campaign batches")

    batch = await db.scalar(select(CampaignBatch).where(CampaignBatch.id == batch_id))
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    batch_name = batch.name
    await db.delete(batch)
    await db.commit()
    clear_progress(batch_id)

    return {
        "status": "ok",
        "batch_id": batch_id,
        "batch_name": batch_name,
        "deleted": True,
    }
