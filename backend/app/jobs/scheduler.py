from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from app.db.base import AsyncSessionLocal
from app.models.lead import Lead
from app.models.models import Task, Notification
import logging

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()


async def update_days_in_stage():
    """
    Runs every night at midnight IST.
    Updates days_in_stage for every active lead.
    """
    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(
                select(Lead).where(Lead.stage.notin_(["won", "lost"]))
            )
            leads = result.scalars().all()
            for lead in leads:
                if lead.stage_changed_at:
                    delta = datetime.utcnow() - lead.stage_changed_at
                    lead.days_in_stage = delta.days

            await db.commit()
            logger.info(f"Updated days_in_stage for {len(leads)} leads")
        except Exception as e:
            logger.error(f"Error in update_days_in_stage: {e}")


async def detect_stale_leads():
    """
    Runs every morning at 9am IST.
    Finds leads with no activity for 3+ days and notifies agent/manager.
    Also triggers no-response follow-up sequences.
    """
    async with AsyncSessionLocal() as db:
        try:
            three_days_ago = datetime.utcnow() - timedelta(days=3)
            seven_days_ago = datetime.utcnow() - timedelta(days=7)

            result = await db.execute(
                select(Lead).where(
                    Lead.stage.notin_(["won", "lost", "nurture"]),
                    Lead.last_contacted_at < three_days_ago,
                )
            )
            stale_leads = result.scalars().all()

            for lead in stale_leads:
                # Set high priority
                lead.priority = "high"

                # Notify agent via in-app
                if lead.assigned_to:
                    notif = Notification(
                        agent_id=lead.assigned_to,
                        title="Stale lead alert",
                        body=f"Lead hasn't been contacted in {lead.days_in_stage} days. Follow up now.",
                        type="stale_lead",
                        link=f"/leads/{lead.id}",
                    )
                    db.add(notif)

                # Trigger no-response follow-up sequence
                try:
                    from app.services.followup_engine import schedule_followup_sequence
                    await schedule_followup_sequence(
                        db, lead.id, lead.contact_id,
                        trigger="no_response",
                        agent_id=lead.assigned_to,
                    )
                except Exception as e:
                    logger.error(f"Failed to schedule no-response follow-up for lead {lead.id}: {e}")

                # If 7+ days, escalate to managers
                if lead.last_contacted_at and lead.last_contacted_at < seven_days_ago:
                    try:
                        from app.models.contact import Contact
                        from app.services.agent_notifier import notify_manager_escalation
                        contact = await db.get(Contact, lead.contact_id)
                        if contact:
                            await notify_manager_escalation(
                                db, lead, contact,
                                reason=f"No activity for {lead.days_in_stage} days"
                            )
                    except Exception as e:
                        logger.error(f"Failed to escalate lead {lead.id}: {e}")

            await db.commit()
            logger.info(f"Stale lead check: {len(stale_leads)} flagged")
        except Exception as e:
            logger.error(f"Error in detect_stale_leads: {e}")


async def mark_overdue_tasks():
    """
    Runs every hour.
    Marks pending tasks whose due_at has passed as overdue.
    """
    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(
                select(Task).where(
                    Task.status == "pending",
                    Task.due_at < datetime.utcnow(),
                )
            )
            tasks = result.scalars().all()
            for task in tasks:
                task.status = "overdue"

            await db.commit()
            logger.info(f"Marked {len(tasks)} tasks as overdue")
        except Exception as e:
            logger.error(f"Error in mark_overdue_tasks: {e}")


async def execute_followups():
    """
    Runs every 15 minutes.
    Processes the follow-up queue — sends scheduled WhatsApp/email/call actions.
    """
    async with AsyncSessionLocal() as db:
        try:
            from app.services.followup_engine import execute_pending_followups
            count = await execute_pending_followups(db)
            if count > 0:
                logger.info(f"Follow-up engine: executed {count} actions")
        except Exception as e:
            logger.error(f"Error in execute_followups: {e}")


async def ai_batch_rescore():
    """
    Runs every 6 hours.
    Re-analyzes leads that haven't been AI-scored in the last 24h.
    """
    async with AsyncSessionLocal() as db:
        try:
            from app.services.ai_analyzer import batch_analyze
            count = await batch_analyze(db, limit=30)
            logger.info(f"AI batch rescore: {count} leads analyzed")
        except Exception as e:
            logger.error(f"Error in ai_batch_rescore: {e}")


async def send_morning_digest():
    """
    Runs every morning at 9 AM IST (3:30 UTC).
    Sends daily digest to agents via WhatsApp.
    """
    async with AsyncSessionLocal() as db:
        try:
            from app.services.agent_notifier import send_daily_digest
            await send_daily_digest(db)
        except Exception as e:
            logger.error(f"Error in send_morning_digest: {e}")


async def detect_dormant_leads():
    """
    Runs daily at noon.
    Finds leads that have been inactive for 30+ days and triggers re-engagement.
    """
    async with AsyncSessionLocal() as db:
        try:
            thirty_days_ago = datetime.utcnow() - timedelta(days=30)
            result = await db.execute(
                select(Lead).where(
                    Lead.stage.notin_(["won", "lost"]),
                    Lead.updated_at < thirty_days_ago,
                    Lead.stage != "nurture",
                )
            )
            dormant = result.scalars().all()

            for lead in dormant:
                lead.stage = "nurture"
                try:
                    from app.services.followup_engine import schedule_followup_sequence
                    await schedule_followup_sequence(
                        db, lead.id, lead.contact_id,
                        trigger="reengagement",
                        agent_id=lead.assigned_to,
                    )
                except Exception as e:
                    logger.error(f"Failed to schedule re-engagement for lead {lead.id}: {e}")

            await db.commit()
            logger.info(f"Dormant lead check: {len(dormant)} moved to nurture")
        except Exception as e:
            logger.error(f"Error in detect_dormant_leads: {e}")


def start_scheduler():
    # Every night at midnight UTC (5:30 AM IST)
    scheduler.add_job(update_days_in_stage, CronTrigger(hour=0, minute=0))

    # Every morning at 3:30 AM UTC (9 AM IST)
    scheduler.add_job(detect_stale_leads, CronTrigger(hour=3, minute=30))

    # Every morning at 3:30 AM UTC (9 AM IST) — daily digest
    scheduler.add_job(send_morning_digest, CronTrigger(hour=3, minute=35))

    # Every hour — overdue tasks
    scheduler.add_job(mark_overdue_tasks, CronTrigger(minute=0))

    # Every minute — follow-up engine (supports precise 15-min automations)
    scheduler.add_job(execute_followups, IntervalTrigger(minutes=1))

    # Every 6 hours — AI batch rescore
    scheduler.add_job(ai_batch_rescore, IntervalTrigger(hours=6))

    # Daily at noon UTC — dormant lead detection
    scheduler.add_job(detect_dormant_leads, CronTrigger(hour=12, minute=0))

    scheduler.start()
    logger.info(
        "APScheduler started — jobs: stale leads, overdue tasks, "
        "follow-up engine (1min), AI rescore (6h), daily digest, dormant detection"
    )
