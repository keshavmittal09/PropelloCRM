from __future__ import annotations

import asyncio
import io
import json
import logging
from datetime import datetime
from typing import Any

import pandas as pd
from fastapi import UploadFile
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import AsyncSessionLocal
from app.models.campaign_dashboard import CampaignBatch, CampaignFlag, CampaignLead
from app.services.campaign_dashboard_ai import analyze_lead_with_groq, generate_batch_insights_with_groq

logger = logging.getLogger(__name__)


REQUIRED_COLUMNS = [
    "name",
    "phone_number",
    "attempt_number",
    "call_id",
    "transcript",
    "recording_url",
    "extracted_entities",
    "call_eval_tag",
    "summary",
    "call_conversation_quality",
    "call_dialing_at",
    "call_ringing_at",
    "user_picked_up",
    "num_of_retries",
]

PROGRESS_STORE: dict[str, dict[str, Any]] = {}


class CampaignDashboardError(Exception):
    pass


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def set_progress(
    batch_id: str,
    status: str,
    stage: str,
    processed: int,
    total: int,
    message: str,
    error: str | None = None,
) -> None:
    PROGRESS_STORE[batch_id] = {
        "batch_id": batch_id,
        "status": status,
        "stage": stage,
        "processed": processed,
        "total": total,
        "progress_pct": round((processed / total) * 100, 2) if total else 0,
        "message": message,
        "error": error,
        "updated_at": _now_iso(),
    }


def get_progress(batch_id: str) -> dict[str, Any] | None:
    return PROGRESS_STORE.get(batch_id)


def clear_progress(batch_id: str) -> None:
    PROGRESS_STORE.pop(batch_id, None)


async def progress_stream(batch_id: str):
    last_sent = ""
    while True:
        progress = get_progress(batch_id) or {
            "batch_id": batch_id,
            "status": "unknown",
            "stage": "idle",
            "processed": 0,
            "total": 0,
            "progress_pct": 0,
            "message": "Waiting for analysis",
            "error": None,
            "updated_at": _now_iso(),
        }

        payload = json.dumps(progress)
        if payload != last_sent:
            yield f"data: {payload}\n\n"
            last_sent = payload

        if progress.get("status") in ("completed", "failed"):
            break

        await asyncio.sleep(1.0)


async def _read_sheet_dataframe(file: UploadFile) -> pd.DataFrame:
    content = await file.read()
    if not content:
        raise CampaignDashboardError("Uploaded file is empty")

    filename = (file.filename or "").lower()
    stream = io.BytesIO(content)

    try:
        if filename.endswith(".csv"):
            df = pd.read_csv(stream)
        elif filename.endswith(".xlsx") or filename.endswith(".xls"):
            workbook = pd.ExcelFile(stream)
            if "Sheet1" not in workbook.sheet_names:
                raise CampaignDashboardError("Excel file must include a sheet named 'Sheet1'")
            df = workbook.parse("Sheet1")
        else:
            raise CampaignDashboardError("Unsupported file format. Upload CSV or Excel (Sheet1).")
    except CampaignDashboardError:
        raise
    except Exception as exc:
        raise CampaignDashboardError(f"Failed to parse call sheet: {exc}") from exc

    if df.empty:
        raise CampaignDashboardError("Call sheet has no rows")

    df.columns = [str(col).strip() for col in df.columns]
    missing = [col for col in REQUIRED_COLUMNS if col not in df.columns]
    if missing:
        raise CampaignDashboardError(f"Missing required columns: {', '.join(missing)}")

    return df


def _safe_json_parse(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, float) and pd.isna(value):
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    except Exception:
        return {"raw": text}


def _to_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, float) and pd.isna(value):
        return None
    try:
        ts = pd.to_datetime(value, errors="coerce")
        if pd.isna(ts):
            return None
        return ts.to_pydatetime()
    except Exception:
        return None


def _to_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    try:
        text = str(value).strip()
        if not text:
            return None
        return int(float(text))
    except Exception:
        return None


def _to_phone(value: Any) -> int | None:
    parsed = _to_int(value)
    if parsed is None:
        return None
    if parsed <= 0:
        return None
    return parsed


async def create_batch_from_upload(db: AsyncSession, file: UploadFile, campaign_name: str) -> CampaignBatch:
    df = await _read_sheet_dataframe(file)

    batch = CampaignBatch(
        name=campaign_name.strip() or "Campaign Batch",
        file_name=file.filename,
        upload_date=datetime.utcnow(),
        total_leads=len(df.index),
        analysis_status="processing",
        created_at=datetime.utcnow(),
    )
    db.add(batch)
    await db.flush()

    lead_rows: list[CampaignLead] = []
    for _, row in df.iterrows():
        lead_rows.append(
            CampaignLead(
                batch_id=batch.id,
                name=None if pd.isna(row.get("name")) else str(row.get("name")).strip(),
                phone_number=_to_phone(row.get("phone_number")),
                attempt_number=_to_int(row.get("attempt_number")),
                call_id=None if pd.isna(row.get("call_id")) else str(row.get("call_id")).strip(),
                transcript=None if pd.isna(row.get("transcript")) else str(row.get("transcript")),
                recording_url=None if pd.isna(row.get("recording_url")) else str(row.get("recording_url")),
                extracted_entities=_safe_json_parse(row.get("extracted_entities")),
                call_eval_tag=None if pd.isna(row.get("call_eval_tag")) else str(row.get("call_eval_tag")).strip(),
                summary=None if pd.isna(row.get("summary")) else str(row.get("summary")),
                call_conversation_quality=_safe_json_parse(row.get("call_conversation_quality")),
                call_dialing_at=_to_datetime(row.get("call_dialing_at")),
                call_ringing_at=_to_datetime(row.get("call_ringing_at")),
                user_picked_up=_to_datetime(row.get("user_picked_up")),
                num_of_retries=_to_int(row.get("num_of_retries")),
            )
        )

    db.add_all(lead_rows)
    await db.commit()
    await db.refresh(batch)

    set_progress(batch.id, "processing", "upload_complete", 0, batch.total_leads, "File uploaded. Starting AI analysis")
    return batch


def _apply_lead_analysis(lead: CampaignLead, analysis: dict[str, Any]) -> None:
    lead.priority_tier = analysis.get("priority_tier")
    lead.lead_score = analysis.get("lead_score")
    lead.intent_level = analysis.get("intent_level")
    lead.engagement_quality = analysis.get("engagement_quality")
    lead.drop_reason = analysis.get("drop_reason")
    lead.objection_type = analysis.get("objection_type")
    lead.objection_handleable = analysis.get("objection_handleable")
    lead.recommended_action = analysis.get("recommended_action")
    lead.callback_urgency_hours = analysis.get("callback_urgency_hours")
    lead.config_interest = analysis.get("config_interest")
    lead.budget_signal = analysis.get("budget_signal")
    lead.language_preference = analysis.get("language_preference")
    lead.pitch_reached = analysis.get("pitch_reached")
    lead.closing_attempted = analysis.get("closing_attempted")
    lead.whatsapp_number_captured = analysis.get("whatsapp_number_captured")
    lead.site_visit_committed = analysis.get("site_visit_committed")
    lead.site_visit_timeframe = analysis.get("site_visit_timeframe")
    lead.ai_detected_by_user = analysis.get("ai_detected_by_user")
    lead.audio_quality_issue = analysis.get("audio_quality_issue")
    lead.audio_loop_detected = analysis.get("audio_loop_detected")
    lead.script_issue_detected = analysis.get("script_issue_detected")
    lead.retry_time_recommendation = analysis.get("retry_time_recommendation")
    lead.enriched_summary = analysis.get("enriched_summary")
    lead.key_quote = analysis.get("key_quote")
    lead.sales_coach_note = analysis.get("sales_coach_note")
    lead.transcript_depth = analysis.get("transcript_depth")
    lead.user_engagement_ratio = analysis.get("user_engagement_ratio")
    lead.ai_analyzed = True


def _lead_to_compact(lead: CampaignLead) -> dict[str, Any]:
    return {
        "lead_id": lead.id,
        "priority_tier": lead.priority_tier,
        "lead_score": lead.lead_score,
        "intent_level": lead.intent_level,
        "engagement_quality": lead.engagement_quality,
        "drop_reason": lead.drop_reason,
        "objection_type": lead.objection_type,
        "recommended_action": lead.recommended_action,
        "language_preference": lead.language_preference,
        "pitch_reached": lead.pitch_reached,
        "site_visit_committed": lead.site_visit_committed,
        "attempt_number": lead.attempt_number,
        "num_of_retries": lead.num_of_retries,
        "call_hour": lead.call_dialing_at.hour if lead.call_dialing_at else None,
    }


def _derive_health(score: int) -> str:
    if score >= 80:
        return "excellent"
    if score >= 65:
        return "good"
    if score >= 50:
        return "fair"
    if score >= 35:
        return "poor"
    return "critical"


def _build_flags(batch_id: str, lead: CampaignLead) -> list[CampaignFlag]:
    flags: list[CampaignFlag] = []

    if lead.ai_detected_by_user:
        flags.append(CampaignFlag(batch_id=batch_id, lead_id=lead.id, flag_type="ai_detection", description="Lead appears to have detected AI caller"))

    if lead.audio_loop_detected:
        flags.append(CampaignFlag(batch_id=batch_id, lead_id=lead.id, flag_type="audio_loop", description="Audio loop detected in call"))

    if lead.audio_quality_issue:
        flags.append(CampaignFlag(batch_id=batch_id, lead_id=lead.id, flag_type="audio_quality", description="Poor audio quality may have affected outcome"))

    if (lead.num_of_retries or 0) >= 3:
        flags.append(CampaignFlag(batch_id=batch_id, lead_id=lead.id, flag_type="high_retries", description="Lead has high retry count"))

    if lead.drop_reason in {"explicit_refusal", "language_barrier", "wrong_person"}:
        flags.append(
            CampaignFlag(
                batch_id=batch_id,
                lead_id=lead.id,
                flag_type="conversion_blocker",
                description=f"Lead dropped due to {lead.drop_reason}",
            )
        )

    return flags


async def _analyze_single_lead(lead: CampaignLead, retries: int = 2) -> dict[str, Any] | None:
    payload = {
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
    }

    for attempt in range(retries + 1):
        result = await analyze_lead_with_groq(payload)
        if result:
            return result
        if attempt < retries:
            await asyncio.sleep(1.2 * (attempt + 1))

    return None


async def analyze_batch(batch_id: str) -> None:
    async with AsyncSessionLocal() as db:
        batch = await db.scalar(select(CampaignBatch).where(CampaignBatch.id == batch_id))
        if not batch:
            set_progress(batch_id, "failed", "load_failed", 0, 0, "Batch not found", error="Batch not found")
            return

        leads = list((await db.scalars(select(CampaignLead).where(CampaignLead.batch_id == batch_id))).all())
        total = len(leads)
        if total == 0:
            batch.analysis_status = "failed"
            await db.commit()
            set_progress(batch_id, "failed", "analysis_failed", 0, 0, "No leads in batch", error="No leads")
            return

        await db.execute(delete(CampaignFlag).where(CampaignFlag.batch_id == batch_id))
        await db.commit()

        set_progress(batch_id, "processing", "lead_analysis", 0, total, "Analyzing leads with Groq")

        processed = 0
        compact_rows: list[dict[str, Any]] = []
        all_flags: list[CampaignFlag] = []

        for lead in leads:
            analysis = await _analyze_single_lead(lead)
            if analysis:
                _apply_lead_analysis(lead, analysis)
            else:
                lead.ai_analyzed = False

            compact_rows.append(_lead_to_compact(lead))
            all_flags.extend(_build_flags(batch_id, lead))

            processed += 1
            set_progress(batch_id, "processing", "lead_analysis", processed, total, f"Analyzed {processed}/{total} leads")

            if processed % 10 == 0:
                await db.commit()

        if all_flags:
            db.add_all(all_flags)

        set_progress(batch_id, "processing", "batch_insights", total, total, "Generating campaign insights")
        insights = await generate_batch_insights_with_groq(batch.name, compact_rows)

        priority_counts = {"P1": 0, "P2": 0, "P3": 0, "P4": 0, "P5": 0}
        scores = []
        converted = 0
        for lead in leads:
            tier = lead.priority_tier or "P5"
            if tier not in priority_counts:
                tier = "P5"
            priority_counts[tier] += 1
            if isinstance(lead.lead_score, int):
                scores.append(lead.lead_score)
            if lead.site_visit_committed:
                converted += 1

        avg_score = round(sum(scores) / len(scores), 2) if scores else 0.0
        conversion_rate = round((converted / total) * 100, 2) if total else 0.0

        health_score = int(insights.get("campaign_health_score", round(avg_score))) if isinstance(insights, dict) else int(round(avg_score))
        health_score = max(0, min(health_score, 100))
        health_label = (
            insights.get("campaign_health_label")
            if isinstance(insights, dict) and isinstance(insights.get("campaign_health_label"), str)
            else _derive_health(health_score)
        )

        batch.p1_count = priority_counts["P1"]
        batch.p2_count = priority_counts["P2"]
        batch.p3_count = priority_counts["P3"]
        batch.p4_count = priority_counts["P4"]
        batch.p5_count = priority_counts["P5"]
        batch.avg_quality_score = float(avg_score)
        batch.conversion_rate = float(conversion_rate)
        batch.campaign_health_score = health_score
        batch.campaign_health_label = health_label
        batch.ai_insights = insights if isinstance(insights, dict) else None
        batch.analysis_status = "completed"

        await db.commit()

        set_progress(batch_id, "completed", "done", total, total, "Campaign analysis completed")


def start_analysis_task(batch_id: str) -> None:
    asyncio.create_task(analyze_batch(batch_id))


async def get_batch_with_leads(db: AsyncSession, batch_id: str) -> tuple[CampaignBatch | None, list[CampaignLead]]:
    batch = await db.scalar(select(CampaignBatch).where(CampaignBatch.id == batch_id))
    leads = []
    if batch:
        leads = list((await db.scalars(select(CampaignLead).where(CampaignLead.batch_id == batch_id))).all())
    return batch, leads
