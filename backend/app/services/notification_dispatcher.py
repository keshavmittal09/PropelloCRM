from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
from typing import Optional, Sequence
from zoneinfo import ZoneInfo

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.agent import Agent
from app.models.contact import Contact
from app.models.lead import Lead
from app.models.models import Notification, Task
from app.models.notification_dispatch import NotificationDispatchLog, NotificationLog
from app.services.email_service import send_internal_email
from app.services.services import send_whatsapp_text


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _as_local_text(dt: Optional[datetime]) -> str:
    if not dt:
        return "N/A"
    tz = ZoneInfo(settings.NOTIFICATION_TIMEZONE)
    aware = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    local_dt = aware.astimezone(tz)
    return local_dt.strftime("%d %b %Y, %I:%M %p")


def _combine_bilingual(en: str, hi: str) -> str:
    return f"{en}\n\n---\nहिंदी:\n{hi}"


async def _already_sent_recently(db: AsyncSession, event_key: str, channel: str) -> bool:
    since = datetime.utcnow() - timedelta(minutes=settings.TASK_NOTIFY_DEDUPE_MINUTES)
    result = await db.execute(
        select(NotificationDispatchLog.id).where(
            and_(
                NotificationDispatchLog.event_key == event_key,
                NotificationDispatchLog.channel == channel,
                NotificationDispatchLog.status == "sent",
                NotificationDispatchLog.created_at >= since,
            )
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _log_dispatch(
    db: AsyncSession,
    event_key: str,
    channel: str,
    recipient_type: str,
    recipient_id: Optional[str],
    recipient_address: Optional[str],
    status: str,
    error: Optional[str] = None,
    meta: Optional[dict] = None,
) -> None:
    normalized_type = channel.lower()
    lead_ids: list[str] | None = None
    campaign_id = None
    if meta:
        maybe_ids = meta.get("lead_ids")
        if isinstance(maybe_ids, list):
            lead_ids = [str(i) for i in maybe_ids]
        maybe_campaign = meta.get("campaign_id")
        if maybe_campaign is not None:
            campaign_id = str(maybe_campaign)

    db.add(
        NotificationDispatchLog(
            event_key=event_key,
            channel=channel,
            recipient_type=recipient_type,
            recipient_id=recipient_id,
            recipient_address=recipient_address,
            status=status,
            error=error,
            meta=meta or {},
        )
    )

    # Keep spec-compatible notification log in sync for assignment delivery auditing.
    db.add(
        NotificationLog(
            agent_id=recipient_id,
            type=normalized_type,
            lead_ids=lead_ids,
            campaign_id=campaign_id,
            status="sent" if status == "sent" else "failed",
            error_message=error,
        )
    )

    await db.flush()


async def _alert_admins_on_failure(
    db: AsyncSession,
    event_key: str,
    channel: str,
    recipient_label: str,
    error: Optional[str],
) -> None:
    if not settings.ADMIN_ALERT_ON_NOTIFY_FAILURE:
        return

    alert_key = f"{event_key}:admin-alert:{channel}"
    if await _already_sent_recently(db, alert_key, "in_app"):
        return

    result = await db.execute(
        select(Agent).where(Agent.role == "admin", Agent.is_active == True)
    )
    admins = result.scalars().all()
    if not admins:
        return

    body = (
        f"Channel: {channel}\nRecipient: {recipient_label}\n"
        f"Error: {error or 'unknown'}"
    )
    for admin in admins:
        db.add(
            Notification(
                agent_id=admin.id,
                title="Notification delivery failed",
                body=body,
                type="reminder",
                link="/settings",
            )
        )

    await _log_dispatch(
        db,
        event_key=alert_key,
        channel="in_app",
        recipient_type="admin_group",
        recipient_id=None,
        recipient_address=None,
        status="sent",
        meta={"channel_failed": channel},
    )


def build_task_event_key(
    task: Task,
    event_type: str,
    source: str,
    changed_fields: Optional[Sequence[str]] = None,
) -> str:
    changed = ",".join(sorted(changed_fields or []))
    raw = "|".join(
        [
            "task",
            event_type,
            source,
            task.id,
            task.assigned_to or "none",
            task.status,
            task.priority,
            task.due_at.isoformat() if task.due_at else "none",
            changed,
        ]
    )
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()
    return f"task:{digest}"


async def notify_task_assignment_multichannel(
    db: AsyncSession,
    task: Task,
    actor_name: str,
    actor_id: Optional[str],
    event_type: str,
    source: str = "manual",
    changed_fields: Optional[Sequence[str]] = None,
) -> dict:
    if not task.assigned_to:
        return {"status": "skipped", "reason": "no_assignee"}

    if (
        settings.TASK_NOTIFY_SKIP_SELF_UPDATES
        and actor_id
        and actor_id == task.assigned_to
        and event_type == "task_updated"
    ):
        return {"status": "skipped", "reason": "self_update"}

    assignee = await db.get(Agent, task.assigned_to)
    if not assignee or not assignee.is_active:
        return {"status": "skipped", "reason": "inactive_assignee"}

    lead = await db.get(Lead, task.lead_id)
    contact = await db.get(Contact, lead.contact_id) if lead else None
    lead_name = contact.name if contact else "Lead"

    event_key = build_task_event_key(task, event_type=event_type, source=source, changed_fields=changed_fields)

    en_message = (
        f"Task update from {actor_name}\n"
        f"Task: {task.title}\n"
        f"Lead: {lead_name}\n"
        f"Priority: {task.priority.upper()}\n"
        f"Status: {task.status.upper()}\n"
        f"Due: {_as_local_text(task.due_at)}\n"
        f"Open CRM: {settings.FRONTEND_URL}/leads/{task.lead_id}"
    )
    hi_message = (
        f"{actor_name} se task update\n"
        f"Task: {task.title}\n"
        f"Lead: {lead_name}\n"
        f"Priority: {task.priority.upper()}\n"
        f"Status: {task.status.upper()}\n"
        f"Due: {_as_local_text(task.due_at)}\n"
        f"CRM kholen: {settings.FRONTEND_URL}/leads/{task.lead_id}"
    )
    combined = _combine_bilingual(en_message, hi_message)

    results = {"status": "ok", "channels": {"whatsapp": "skipped", "email": "skipped"}}

    if settings.TASK_ASSIGN_NOTIFY_WHATSAPP_ENABLED and assignee.phone:
        if await _already_sent_recently(db, event_key, "whatsapp"):
            results["channels"]["whatsapp"] = "deduped"
        else:
            sent, error = await send_whatsapp_text(assignee.phone, combined)
            await _log_dispatch(
                db,
                event_key=event_key,
                channel="whatsapp",
                recipient_type="agent",
                recipient_id=assignee.id,
                recipient_address=assignee.phone,
                status="sent" if sent else "failed",
                error=error,
                meta={"event_type": event_type, "source": source},
            )
            results["channels"]["whatsapp"] = "sent" if sent else "failed"
            if not sent:
                await _alert_admins_on_failure(db, event_key, "whatsapp", assignee.name, error)

    if settings.TASK_ASSIGN_NOTIFY_EMAIL_ENABLED and assignee.email:
        if await _already_sent_recently(db, event_key, "email"):
            results["channels"]["email"] = "deduped"
        else:
            email_subject = f"Task Queue Updated | {task.title[:80]}"
            html_body = "<br>".join(line for line in combined.split("\n"))
            sent, error = await send_internal_email(
                to_email=assignee.email,
                subject=email_subject,
                body_html=f"<p>{html_body}</p>",
                body_text=combined,
            )
            await _log_dispatch(
                db,
                event_key=event_key,
                channel="email",
                recipient_type="agent",
                recipient_id=assignee.id,
                recipient_address=assignee.email,
                status="sent" if sent else "failed",
                error=error,
                meta={"event_type": event_type, "source": source},
            )
            results["channels"]["email"] = "sent" if sent else "failed"
            if not sent:
                await _alert_admins_on_failure(db, event_key, "email", assignee.name, error)

    return results


async def notify_campaign_assignment_summary(
    db: AsyncSession,
    agent_id: str,
    lead_count: int,
    campaign_id: str,
    campaign_name: Optional[str] = None,
    top_lead_name: Optional[str] = None,
    top_lead_priority: Optional[str] = None,
) -> dict:
    """Feature 8: Send assignment notification with SLA info."""
    assignee = await db.get(Agent, agent_id)
    if not assignee or not assignee.is_active or lead_count <= 0:
        return {"status": "skipped"}

    event_key = f"campaign-assignment:{campaign_id}:{agent_id}:{lead_count}"
    crm_url = settings.FRONTEND_URL

    # Build enhanced message with SLA info
    en_message = (
        f"Hi {assignee.name},\n\n"
        f"You have {lead_count} new lead(s) assigned in {campaign_name or campaign_id}.\n\n"
        f"Top lead: {top_lead_name or 'N/A'} | Priority: {top_lead_priority or 'N/A'}\n"
        f"SLA: P1=2hr | P2=24hr | P3=48hr | P4=72hr\n\n"
        f"Login: {crm_url}"
    )
    hi_message = (
        f"Hi {assignee.name},\n\n"
        f"Aapko {lead_count} naye leads assign hue hain {campaign_name or campaign_id} mein.\n\n"
        f"Top lead: {top_lead_name or 'N/A'} | Priority: {top_lead_priority or 'N/A'}\n"
        f"SLA: P1=2hr | P2=24hr | P3=48hr | P4=72hr\n\n"
        f"Login: {crm_url}"
    )
    combined = _combine_bilingual(en_message, hi_message)

    result = {"status": "ok", "channels": {"whatsapp": "skipped", "email": "skipped"}}

    if settings.TASK_ASSIGN_NOTIFY_WHATSAPP_ENABLED and assignee.phone:
        if await _already_sent_recently(db, event_key, "whatsapp"):
            result["channels"]["whatsapp"] = "deduped"
        else:
            sent, error = await send_whatsapp_text(assignee.phone, combined)
            await _log_dispatch(
                db,
                event_key=event_key,
                channel="whatsapp",
                recipient_type="agent",
                recipient_id=assignee.id,
                recipient_address=assignee.phone,
                status="sent" if sent else "failed",
                error=error,
                meta={"type": "lead_assignment", "campaign_id": campaign_id, "lead_count": lead_count},
            )
            result["channels"]["whatsapp"] = "sent" if sent else "failed"
            if not sent:
                await _alert_admins_on_failure(db, event_key, "whatsapp", assignee.name, error)

    if settings.TASK_ASSIGN_NOTIFY_EMAIL_ENABLED and assignee.email:
        if await _already_sent_recently(db, event_key, "email"):
            result["channels"]["email"] = "deduped"
        else:
            subject = f"{lead_count} New Leads Assigned — {campaign_name or campaign_id} | Propello CRM"
            html_body = f"""
            <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #1d1d1f;">Hi {assignee.name},</h2>
                <p>You have <strong>{lead_count} new lead(s)</strong> assigned in <strong>{campaign_name or campaign_id}</strong>.</p>
                <div style="background: #f5f5f7; border-radius: 12px; padding: 16px; margin: 20px 0;">
                    <p><strong>Top Lead:</strong> {top_lead_name or 'N/A'}</p>
                    <p><strong>Priority:</strong> {top_lead_priority or 'N/A'}</p>
                    <p><strong>SLA:</strong> P1=2hr | P2=24hr | P3=48hr | P4=72hr</p>
                </div>
                <p><a href="{crm_url}" style="display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Open CRM</a></p>
            </div>
            """
            sent, error = await send_internal_email(
                to_email=assignee.email,
                subject=subject,
                body_html=html_body,
                body_text=combined,
            )
            await _log_dispatch(
                db,
                event_key=event_key,
                channel="email",
                recipient_type="agent",
                recipient_id=assignee.id,
                recipient_address=assignee.email,
                status="sent" if sent else "failed",
                error=error,
                meta={"type": "lead_assignment", "campaign_id": campaign_id, "lead_count": lead_count},
            )
            result["channels"]["email"] = "sent" if sent else "failed"
            if not sent:
                await _alert_admins_on_failure(db, event_key, "email", assignee.name, error)

    return result


async def send_admin_broadcast(
    db: AsyncSession,
    sender: Agent,
    recipients: Sequence[Agent],
    message: str,
    subject: Optional[str],
    channels: Sequence[str],
) -> dict:
    channels_set = set(channels)
    subject_line = subject or "Admin Broadcast | Propello CRM"

    total = {"in_app": 0, "whatsapp": 0, "email": 0}
    failed = {"whatsapp": 0, "email": 0}

    for recipient in recipients:
        event_key_base = f"broadcast:{sender.id}:{recipient.id}:{hashlib.sha1((subject_line + message).encode('utf-8')).hexdigest()}"

        if "in_app" in channels_set:
            db.add(
                Notification(
                    agent_id=recipient.id,
                    title=subject_line,
                    body=message,
                    type="reminder",
                    link="/",
                )
            )
            total["in_app"] += 1

        if "whatsapp" in channels_set and recipient.phone:
            sent, error = await send_whatsapp_text(recipient.phone, message)
            await _log_dispatch(
                db,
                event_key=event_key_base,
                channel="whatsapp",
                recipient_type="agent",
                recipient_id=recipient.id,
                recipient_address=recipient.phone,
                status="sent" if sent else "failed",
                error=error,
                meta={"type": "admin_broadcast", "sender_id": sender.id},
            )
            if sent:
                total["whatsapp"] += 1
            else:
                failed["whatsapp"] += 1
                await _alert_admins_on_failure(db, event_key_base, "whatsapp", recipient.name, error)

        if "email" in channels_set and recipient.email:
            sent, error = await send_internal_email(
                to_email=recipient.email,
                subject=subject_line,
                body_html=f"<p>{'<br>'.join(message.splitlines())}</p>",
                body_text=message,
            )
            await _log_dispatch(
                db,
                event_key=event_key_base,
                channel="email",
                recipient_type="agent",
                recipient_id=recipient.id,
                recipient_address=recipient.email,
                status="sent" if sent else "failed",
                error=error,
                meta={"type": "admin_broadcast", "sender_id": sender.id},
            )
            if sent:
                total["email"] += 1
            else:
                failed["email"] += 1
                await _alert_admins_on_failure(db, event_key_base, "email", recipient.name, error)

    await db.flush()
    return {"sent": total, "failed": failed, "recipients": len(recipients)}
