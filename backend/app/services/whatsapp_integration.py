"""
WhatsApp Agent integration service.

Bridges PropelloCRM with the external DreamHome WhatsApp bot. Handles lead
lookup/auto-creation, idempotent activity logging, master_profile patching,
bulk trigger throttling, and high-intent escalation — all using the existing
CRM tables (activities + master_profile + tasks + notifications). No schema
changes beyond additive enum values.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Optional

import httpx
from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.base import AsyncSessionLocal
from app.models.contact import Contact
from app.models.lead import Lead
from app.models.models import Activity, Notification, Task
from app.models.notification_dispatch import NotificationDispatchLog
from app.utils.phone import match_variants, to_e164

logger = logging.getLogger(__name__)


# ─── Constants ───────────────────────────────────────────────────────────────

HOT_SCORE_THRESHOLD = 70  # 0–100 scale (bot uses this scale)
ESCALATION_TASK_TITLE_PREFIX = "WhatsApp HOT lead"


# ─── Lookup & creation ──────────────────────────────────────────────────────

async def _find_contact_by_phone(db: AsyncSession, phone: str) -> Optional[Contact]:
    variants = match_variants(phone)
    if not variants:
        return None
    result = await db.execute(select(Contact).where(Contact.phone.in_(variants)).limit(1))
    return result.scalar_one_or_none()


async def _find_lead_for_contact(db: AsyncSession, contact_id: str) -> Optional[Lead]:
    """Return the most relevant active lead for a contact (newest non-closed first)."""
    result = await db.execute(
        select(Lead)
        .where(Lead.contact_id == contact_id)
        .order_by(
            # Prefer leads not in won/lost
            Lead.stage.in_(("won", "lost")).asc(),
            desc(Lead.updated_at),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


async def resolve_lead(
    db: AsyncSession,
    phone: str,
    *,
    auto_create: Optional[bool] = None,
    name_hint: Optional[str] = None,
) -> tuple[Optional[Lead], Optional[Contact], bool]:
    """Find existing lead+contact by phone, or create them if auto-create is enabled.

    Returns ``(lead, contact, created)``. Created=True iff a new contact AND lead
    were just inserted by this call.
    """
    e164 = to_e164(phone)
    if not e164:
        return None, None, False

    contact = await _find_contact_by_phone(db, phone)
    if contact:
        lead = await _find_lead_for_contact(db, contact.id)
        if lead:
            return lead, contact, False

    should_create = (
        settings.WHATSAPP_AUTO_CREATE_LEAD if auto_create is None else bool(auto_create)
    )
    if not should_create:
        return None, contact, False

    if contact is None:
        contact = Contact(
            name=(name_hint or "WhatsApp Lead").strip()[:100] or "WhatsApp Lead",
            phone=e164,
            type="buyer",
            source="whatsapp_bot",
        )
        db.add(contact)
        await db.flush()

    lead = Lead(
        contact_id=contact.id,
        source="whatsapp_bot",
        stage="new",
        lead_score="warm",
        priority="P3",
        last_interaction_at=datetime.utcnow(),
    )
    db.add(lead)
    await db.flush()
    return lead, contact, True


# ─── Activity helpers ───────────────────────────────────────────────────────

async def _activity_exists_for_call_id(
    db: AsyncSession,
    lead_id: str,
    call_id: str,
    activity_type: str,
) -> bool:
    """Dedupe key: same call_id + same direction/type on the same lead."""
    result = await db.execute(
        select(Activity.id).where(
            and_(
                Activity.lead_id == lead_id,
                Activity.type == activity_type,
                Activity.meta["call_id"].as_string() == call_id,
            )
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _trigger_already_sent_recently(
    db: AsyncSession,
    lead_id: str,
    call_id: str,
    within_hours: int,
) -> bool:
    """R2 dedupe: was this same call_id triggered for this phone in last N hours?"""
    cutoff = datetime.utcnow() - timedelta(hours=within_hours)
    result = await db.execute(
        select(Activity.id).where(
            and_(
                Activity.lead_id == lead_id,
                Activity.type == "whatsapp_triggered",
                Activity.meta["call_id"].as_string() == call_id,
                Activity.performed_at >= cutoff,
            )
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


def _build_activity(
    *,
    lead_id: str,
    contact_id: Optional[str],
    activity_type: str,
    title: str,
    description: Optional[str],
    meta: dict[str, Any],
    performed_at: Optional[datetime] = None,
) -> Activity:
    return Activity(
        lead_id=lead_id,
        contact_id=contact_id,
        type=activity_type,
        title=title[:200],
        description=description,
        performed_at=performed_at or datetime.utcnow(),
        meta=meta,
    )


# ─── master_profile merging ─────────────────────────────────────────────────

def _merge_profile(existing: Optional[dict], patch: Optional[dict]) -> dict:
    """Shallow merge — only non-null patch values overwrite. Existing keys preserved."""
    base: dict[str, Any] = dict(existing or {})
    if not patch:
        return base
    for key, value in patch.items():
        if value is None:
            continue
        base[key] = value
    return base


# ─── Dispatch log ───────────────────────────────────────────────────────────

async def _log_dispatch(
    db: AsyncSession,
    *,
    event_key: str,
    status: str,
    recipient_address: Optional[str],
    error: Optional[str] = None,
    meta: Optional[dict] = None,
) -> None:
    db.add(
        NotificationDispatchLog(
            event_key=event_key,
            channel="whatsapp_bot",
            recipient_type="lead",
            recipient_id=None,
            recipient_address=recipient_address,
            status=status,
            error=error,
            meta=meta,
        )
    )


# ─── R1: single trigger ─────────────────────────────────────────────────────

async def handle_trigger(
    db: AsyncSession,
    *,
    phone: str,
    call_id: str,
    message: Optional[str] = None,
    lead_id_hint: Optional[str] = None,
    template: Optional[str] = None,
    template_name: Optional[str] = None,
    template_params: Optional[list[str]] = None,
    template_language: Optional[str] = None,
    extra_meta: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Implements R1. Logs trigger activity, calls bot, returns ack payload.

    Supports two modes:
    - Free-form: message (for contacts with 24h window)
    - Template: template_name + optional template_params (for new contacts)
    """
    e164 = to_e164(phone)
    extra_meta = extra_meta or {}

    lead: Optional[Lead] = None
    contact: Optional[Contact] = None
    if lead_id_hint:
        lead = await db.get(Lead, lead_id_hint)
        if lead:
            contact = await db.get(Contact, lead.contact_id) if lead.contact_id else None
    if lead is None:
        lead, contact, _ = await resolve_lead(db, phone)

    if lead is None:
        await _log_dispatch(
            db,
            event_key=f"wa-trigger:{call_id}",
            status="skipped",
            recipient_address=e164,
            error="lead_not_found_and_auto_create_disabled",
        )
        return {"status": "skipped", "detail": "lead_not_found"}

    if await _trigger_already_sent_recently(
        db, lead.id, call_id, settings.WHATSAPP_TRIGGER_DEDUPE_HOURS
    ):
        await _log_dispatch(
            db,
            event_key=f"wa-trigger:{call_id}",
            status="duplicate",
            recipient_address=e164,
        )
        return {"status": "skipped", "detail": "duplicate_within_dedupe_window", "lead_id": lead.id}

    # Build activity metadata
    meta_payload = {"call_id": call_id, "template": template, **extra_meta}
    if template_name:
        meta_payload["template_name"] = template_name
        if template_params:
            meta_payload["template_params"] = template_params
        if template_language:
            meta_payload["template_language"] = template_language
    if message:
        meta_payload["message"] = message

    activity = _build_activity(
        lead_id=lead.id,
        contact_id=contact.id if contact else None,
        activity_type="whatsapp_triggered",
        title=f"WhatsApp trigger ({template_name or template or 'custom'})",
        description=(message or f"Template: {template_name}")[:500],
        meta=meta_payload,
    )
    db.add(activity)
    lead.last_interaction_at = datetime.utcnow()

    bot_status, bot_error = await _call_bot_send(
        phone=e164,
        message=message,
        call_id=call_id,
        template=template,
        template_name=template_name,
        template_params=template_params,
        template_language=template_language,
    )

    await _log_dispatch(
        db,
        event_key=f"wa-trigger:{call_id}",
        status=bot_status,
        recipient_address=e164,
        error=bot_error,
        meta={"lead_id": lead.id, "template": template},
    )

    await db.flush()
    return {
        "status": "ok" if bot_status == "sent" else "error",
        "detail": bot_error,
        "lead_id": lead.id,
        "activity_id": activity.id,
    }


# ─── R2: bulk trigger ───────────────────────────────────────────────────────

async def schedule_bulk_trigger(
    db: AsyncSession,
    *,
    call_id: str,
    message: Optional[str] = None,
    template: Optional[str] = None,
    template_name: Optional[str] = None,
    template_params: Optional[list[str]] = None,
    template_language: Optional[str] = None,
    lead_ids: Optional[list[str]] = None,
    phones: Optional[list[str]] = None,
    extra_meta: Optional[dict[str, Any]] = None,
) -> dict[str, int]:
    """Resolve targets, log trigger activities, and spawn an async sender task.

    Supports either message (for 24h+ window) or template_name (for new contacts).
    Sends are throttled by ``WHATSAPP_BULK_THROTTLE_SECONDS`` (default 1s).
    Failures are logged but never raised; the bot must not be blocked.
    """
    targets: list[tuple[Lead, Contact, str]] = []  # (lead, contact, phone_to_send)
    not_found = 0
    skipped_dupes = 0

    # Resolve lead_ids
    if lead_ids:
        for lid in lead_ids:
            lead = await db.get(Lead, lid)
            if not lead:
                not_found += 1
                continue
            contact = await db.get(Contact, lead.contact_id) if lead.contact_id else None
            if not contact or not contact.phone:
                not_found += 1
                continue
            phone_e164 = to_e164(contact.phone)
            if not phone_e164:
                not_found += 1
                continue
            targets.append((lead, contact, phone_e164))

    # Resolve raw phones (skip duplicates already added via lead_ids)
    already_phones = {t[2] for t in targets}
    if phones:
        for p in phones:
            phone_e164 = to_e164(p)
            if not phone_e164 or phone_e164 in already_phones:
                continue
            lead, contact, _ = await resolve_lead(db, phone_e164)
            if not lead or not contact:
                not_found += 1
                continue
            targets.append((lead, contact, phone_e164))
            already_phones.add(phone_e164)

    # Dedupe + log trigger activities
    accepted: list[tuple[str, str, str]] = []  # (lead_id, phone, contact_name)
    for lead, contact, phone_e164 in targets:
        if await _trigger_already_sent_recently(
            db, lead.id, call_id, settings.WHATSAPP_TRIGGER_DEDUPE_HOURS
        ):
            skipped_dupes += 1
            continue
        activity = _build_activity(
            lead_id=lead.id,
            contact_id=contact.id,
            activity_type="whatsapp_triggered",
            title=f"WhatsApp bulk trigger ({template or 'custom'})",
            description=(message or template or "")[:500] or None,
            meta={
                "call_id": call_id,
                "template": template,
                "message": message,
                "bulk": True,
                **(extra_meta or {}),
            },
        )
        db.add(activity)
        lead.last_interaction_at = datetime.utcnow()
        accepted.append((lead.id, phone_e164, contact.name or ""))

    await db.flush()
    await db.commit()  # commit before spawning background task

    # Spawn background sender (fire-and-forget)
    if accepted:
        asyncio.create_task(
            _bulk_sender_loop(
                accepted=accepted,
                call_id=call_id,
                message=message,
                template=template,
                template_name=template_name,
                template_params=template_params,
                template_language=template_language,
            )
        )

    return {
        "accepted": len(accepted),
        "skipped_duplicates": skipped_dupes,
        "not_found": not_found,
        "scheduled": len(accepted),
    }


async def _bulk_sender_loop(
    *,
    accepted: list[tuple[str, str, str]],
    call_id: str,
    message: Optional[str] = None,
    template: Optional[str] = None,
    template_name: Optional[str] = None,
    template_params: Optional[list[str]] = None,
    template_language: Optional[str] = None,
) -> None:
    """Background task: calls the bot once per lead with 1-msg/sec throttle."""
    delay = max(0, int(settings.WHATSAPP_BULK_THROTTLE_SECONDS))
    for idx, (lead_id, phone_e164, _name) in enumerate(accepted):
        if idx > 0 and delay:
            await asyncio.sleep(delay)
        try:
            status, error = await _call_bot_send(
                phone=phone_e164,
                message=message,
                call_id=call_id,
                template=template,
                template_name=template_name,
                template_params=template_params,
                template_language=template_language,
            )
        except Exception as e:  # never raise out of a background task
            status, error = "error", str(e)
            logger.exception("Bulk sender failure for lead %s", lead_id)

        # Log each send result in its own session (avoid sharing one session across many awaits)
        try:
            async with AsyncSessionLocal() as session:
                await _log_dispatch(
                    session,
                    event_key=f"wa-bulk:{call_id}:{lead_id}",
                    status=status,
                    recipient_address=phone_e164,
                    error=error,
                    meta={"lead_id": lead_id, "template": template},
                )
                await session.commit()
        except Exception:
            logger.exception("Failed to log bulk dispatch for lead %s", lead_id)


# ─── R3: context fetch ─────────────────────────────────────────────────────

async def fetch_context(
    db: AsyncSession, *, phone: str, call_id: Optional[str] = None, recent_limit: int = 10
) -> dict[str, Any]:
    """Implements R3. Returns lead profile + last N activities."""
    contact = await _find_contact_by_phone(db, phone)
    if not contact:
        return {"found": False}
    lead = await _find_lead_for_contact(db, contact.id)
    if not lead:
        return {"found": False, "contact_id": contact.id, "phone": contact.phone, "name": contact.name}

    acts = await db.execute(
        select(Activity)
        .where(Activity.lead_id == lead.id)
        .order_by(desc(Activity.performed_at))
        .limit(recent_limit)
    )
    recent = [
        {
            "id": a.id,
            "type": a.type,
            "title": a.title,
            "description": a.description,
            "performed_at": a.performed_at.isoformat() if a.performed_at else None,
            "meta": a.meta,
        }
        for a in acts.scalars().all()
    ]

    return {
        "found": True,
        "lead_id": lead.id,
        "contact_id": contact.id,
        "name": contact.name,
        "phone": contact.phone,
        "stage": lead.stage,
        "lead_score": lead.lead_score,
        "priority": lead.priority,
        "assigned_to": lead.assigned_to,
        "last_contacted_at": lead.last_contacted_at,
        "last_interaction_at": lead.last_interaction_at,
        "last_remark": lead.last_remark,
        "master_profile": lead.master_profile,
        "recent_activities": recent,
    }


# ─── R4: timeline sync ─────────────────────────────────────────────────────

async def sync_timeline_event(
    db: AsyncSession,
    *,
    phone: str,
    direction: str,
    message: str,
    call_id: Optional[str] = None,
    occurred_at: Optional[datetime] = None,
    ai_score: Optional[int] = None,
    intent: Optional[str] = None,
    qualified: Optional[bool] = None,
    summary: Optional[str] = None,
    profile_patch: Optional[dict[str, Any]] = None,
    escalate: Optional[bool] = None,
) -> dict[str, Any]:
    """Implements R4. Idempotent on (lead_id, call_id, direction)."""
    if direction not in ("inbound", "outbound"):
        return {"status": "error", "detail": "invalid_direction"}

    lead, contact, _created = await resolve_lead(db, phone)
    if not lead:
        return {"status": "skipped", "detail": "lead_not_resolved"}

    activity_type = "whatsapp_inbound" if direction == "inbound" else "whatsapp_outbound"

    # Idempotency: same call_id + same direction → skip
    if call_id and await _activity_exists_for_call_id(db, lead.id, call_id, activity_type):
        return {"status": "skipped", "detail": "duplicate", "lead_id": lead.id}

    meta: dict[str, Any] = {
        "direction": direction,
        "message": message,
    }
    if call_id:
        meta["call_id"] = call_id
    if ai_score is not None:
        meta["ai_score"] = ai_score
    if intent:
        meta["intent"] = intent
    if qualified is not None:
        meta["qualified"] = qualified
    if summary:
        meta["summary"] = summary

    activity = _build_activity(
        lead_id=lead.id,
        contact_id=contact.id if contact else None,
        activity_type=activity_type,
        title=f"WhatsApp {direction}",
        description=(summary or message)[:500],
        meta=meta,
        performed_at=occurred_at,
    )
    db.add(activity)

    # Update lead profile + interaction time
    now = datetime.utcnow()
    lead.last_interaction_at = now
    if direction == "inbound":
        lead.last_contacted_at = now
    if summary:
        lead.last_remark = summary[:200]
    if profile_patch:
        lead.master_profile = _merge_profile(lead.master_profile, profile_patch)

    # Auto-escalate on HOT signal or explicit flag
    task_id: Optional[str] = None
    if escalate is True or (ai_score is not None and ai_score >= HOT_SCORE_THRESHOLD):
        task_id = await _maybe_escalate(
            db,
            lead=lead,
            contact=contact,
            reason=f"WhatsApp HOT signal (score={ai_score}, intent={intent or 'n/a'})",
            ai_score=ai_score,
        )

    await db.flush()
    return {"status": "ok", "lead_id": lead.id, "activity_id": activity.id, "task_id": task_id}


# ─── R5: escalation ─────────────────────────────────────────────────────────

async def _has_recent_escalation_task(
    db: AsyncSession, lead_id: str, within_minutes: int
) -> bool:
    cutoff = datetime.utcnow() - timedelta(minutes=within_minutes)
    result = await db.execute(
        select(Task.id).where(
            and_(
                Task.lead_id == lead_id,
                Task.title.like(f"{ESCALATION_TASK_TITLE_PREFIX}%"),
                Task.created_at >= cutoff,
            )
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _maybe_escalate(
    db: AsyncSession,
    *,
    lead: Lead,
    contact: Optional[Contact],
    reason: str,
    ai_score: Optional[int] = None,
) -> Optional[str]:
    """Create an escalation Task + Notification, idempotent within 1 hour."""
    if await _has_recent_escalation_task(
        db, lead.id, settings.WHATSAPP_ESCALATION_DEDUPE_MINUTES
    ):
        return None

    task = Task(
        lead_id=lead.id,
        title=f"{ESCALATION_TASK_TITLE_PREFIX}: {contact.name if contact else 'unknown'}",
        description=reason,
        task_type="call",
        priority="high",
        status="pending",
        assigned_to=lead.assigned_to,
    )
    db.add(task)
    lead.priority = "P1"

    if lead.assigned_to:
        db.add(
            Notification(
                agent_id=lead.assigned_to,
                title="🔥 HOT WhatsApp lead",
                body=f"{contact.name if contact else 'A lead'} signalled high intent on WhatsApp. {reason}",
                type="new_lead",
                link=f"/leads/{lead.id}",
            )
        )
    await db.flush()
    return task.id


async def handle_escalation(
    db: AsyncSession, *, phone: str, reason: str, ai_score: Optional[int] = None
) -> dict[str, Any]:
    """Standalone R5 endpoint — when bot wants to escalate without a message sync."""
    lead, contact, _ = await resolve_lead(db, phone)
    if not lead:
        return {"status": "skipped", "detail": "lead_not_resolved"}
    task_id = await _maybe_escalate(
        db, lead=lead, contact=contact, reason=reason, ai_score=ai_score
    )
    await db.flush()
    return {
        "status": "ok" if task_id else "skipped",
        "detail": None if task_id else "duplicate_within_dedupe_window",
        "lead_id": lead.id,
        "task_id": task_id,
    }


# ─── Bot HTTP client ───────────────────────────────────────────────────────

async def _call_bot_send(
    *,
    phone: str,
    call_id: str,
    message: Optional[str] = None,
    template: Optional[str] = None,
    template_name: Optional[str] = None,
    template_params: Optional[list[str]] = None,
    template_language: Optional[str] = None,
) -> tuple[str, Optional[str]]:
    """POST to the WhatsApp bot's send endpoint. Returns (status, error_message).

    Supports two modes:
    - Free-form: phone + message (for contacts with 24h window)
    - Template: phone + template_name + optional template_params (for new contacts)
    """
    base = (settings.WHATSAPP_BOT_BASE_URL or "").strip().rstrip("/")
    if not base:
        return "skipped", "bot_base_url_not_configured"

    url = f"{base}/api/send"
    payload = {
        "phone": phone,
        "call_id": call_id,
    }

    # Add either message or template
    if template_name:
        payload["template_name"] = template_name
        if template_params:
            payload["template_params"] = template_params
        if template_language:
            payload["template_language"] = template_language
    elif message:
        payload["message"] = message
    else:
        return "error", "neither_message_nor_template_provided"

    # Add optional analytics tag
    if template:
        payload["template"] = template

    headers = {"X-Webhook-Secret": settings.WHATSAPP_WEBHOOK_SECRET}
    try:
        async with httpx.AsyncClient(timeout=settings.WHATSAPP_BOT_TIMEOUT_SECONDS) as client:
            resp = await client.post(url, json=payload, headers=headers)
        if 200 <= resp.status_code < 300:
            return "sent", None
        return "error", f"bot_http_{resp.status_code}: {resp.text[:200]}"
    except httpx.TimeoutException:
        return "error", "bot_timeout"
    except Exception as e:
        return "error", f"bot_exception: {e}"
