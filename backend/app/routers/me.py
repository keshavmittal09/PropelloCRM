"""
Scoped endpoints for authenticated user's own data.
Accessible by all roles including call_agent.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from datetime import datetime, timedelta
from app.core.dependencies import get_db, get_current_user
from app.models.agent import Agent
from app.models.lead import Lead
from app.models.contact import Contact
from app.models.models import Task, PerformanceSnapshot
from app.schemas.schemas import TaskResponse, LeadResponse, AgentPerformanceResponse
from typing import List, Optional

router = APIRouter()


def _task_query_options():
    return (
        selectinload(Task.assigned_agent),
        selectinload(Task.lead).selectinload(Lead.contact),
        selectinload(Task.lead).selectinload(Lead.assigned_agent),
    )


@router.get("/tasks", response_model=List[TaskResponse])
async def get_my_tasks(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Get tasks assigned to the current user only. Accessible by all roles."""
    from sqlalchemy import case

    now = datetime.utcnow()
    from sqlalchemy import update as sa_update

    # Repair: earlier follow-up tasks were created "due now" and immediately
    # flipped to overdue. Reset auto-generated follow-ups to pending with no due
    # date so they live under Pending.
    await db.execute(
        sa_update(Task).where(
            Task.assigned_to == current_user.id,
            Task.task_type == "call",
            Task.title.like("Follow up:%"),
            Task.status == "overdue",
        ).values(status="pending", due_at=None)
    )

    # Backfill: every lead assigned to me should have at least one follow-up task
    # so leads assigned before task-creation existed still show up to call agents.
    assigned_rows = await db.execute(select(Lead.id).where(Lead.assigned_to == current_user.id))
    assigned_ids = [r[0] for r in assigned_rows.all()]
    if assigned_ids:
        tasked_rows = await db.execute(
            select(Task.lead_id).where(Task.lead_id.in_(assigned_ids)).distinct()
        )
        tasked = {r[0] for r in tasked_rows.all()}
        missing = [lid for lid in assigned_ids if lid not in tasked]
        if missing:
            name_rows = await db.execute(
                select(Lead.id, Contact.name).join(Contact, Lead.contact_id == Contact.id)
                .where(Lead.id.in_(missing))
            )
            names = {r[0]: r[1] for r in name_rows.all()}
            for lid in missing:
                db.add(Task(
                    lead_id=lid,
                    title=f"Follow up: {names.get(lid) or 'lead'}",
                    task_type="call",
                    assigned_to=current_user.id,
                    due_at=None,  # no due date → stays under Pending, never auto-overdue
                    priority="high",
                    status="pending",
                ))
    await db.commit()

    priority_order = case(
        (Task.priority == "high", 0),
        (Task.priority == "normal", 1),
        (Task.priority == "low", 2),
        else_=3,
    )

    # Show tasks for the leads CURRENTLY assigned to this agent — not stale tasks
    # left pointing at them after a lead was reassigned to someone else. This
    # keeps the count aligned with the agent's actual assigned-lead workload.
    my_lead_ids = select(Lead.id).where(Lead.assigned_to == current_user.id)
    query = (
        select(Task)
        .options(*_task_query_options())
        .where(Task.lead_id.in_(my_lead_ids))
        .order_by(priority_order.asc(), Task.due_at.asc(), Task.created_at.desc())
    )

    if status == "overdue":
        query = query.where(
            Task.due_at.is_not(None),
            Task.due_at < now,
            Task.status.in_(["pending", "overdue"]),
        )
    elif status == "pending":
        query = query.where(
            Task.status == "pending",
            (Task.due_at.is_(None)) | (Task.due_at >= now),
        )
    elif status:
        query = query.where(Task.status == status)

    result = await db.execute(query)
    tasks = result.scalars().all()

    # Auto-mark overdue
    if status == "overdue":
        needs_commit = False
        for task in tasks:
            if task.status == "pending":
                task.status = "overdue"
                needs_commit = True
        if needs_commit:
            await db.commit()

    return [TaskResponse.model_validate(t) for t in tasks]


@router.get("/summary")
async def get_my_summary(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Dashboard stats scoped to the current user's own assigned leads.

    Lets call agents see a populated dashboard (analytics/summary is admin-only).
    """
    me = current_user.id
    from_date = datetime.utcnow() - timedelta(days=days)
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    async def cnt(*conds):
        r = await db.execute(select(func.count(Lead.id)).where(Lead.assigned_to == me, *conds))
        return r.scalar() or 0

    total = await cnt()
    new_today = await cnt(Lead.created_at >= today_start)
    hot = await cnt(Lead.lead_score == "hot", Lead.stage.notin_(["won", "lost"]))
    warm = await cnt(Lead.lead_score == "warm", Lead.stage.notin_(["won", "lost"]))
    cold = await cnt(Lead.lead_score == "cold", Lead.stage.notin_(["won", "lost"]))
    active = await cnt(Lead.stage.notin_(["won", "lost"]))
    won = await cnt(Lead.stage == "won", Lead.updated_at >= from_date)
    lost = await cnt(Lead.stage == "lost", Lead.updated_at >= from_date)
    total_period = await cnt(Lead.created_at >= from_date)
    conversion_rate = round((won / total_period * 100), 1) if total_period > 0 else 0.0

    return {
        "total_leads": total,
        "new_leads_today": new_today,
        "hot_leads": hot,
        "warm_leads": warm,
        "cold_leads": cold,
        "assigned_leads": active,
        "won_this_month": won,
        "lost_this_month": lost,
        "converted_leads": won,
        "pipeline_value": 0.0,
        "ai_calls_completed": 0,
        "whatsapp_sent": 0,
        "conversion_rate": conversion_rate,
    }


@router.get("/leads", response_model=List[LeadResponse])
async def get_my_leads(
    stage: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Get leads assigned to the current user only. Accessible by all roles."""

    query = (
        select(Lead)
        .options(selectinload(Lead.contact), selectinload(Lead.assigned_agent))
        .where(Lead.assigned_to == current_user.id)
        .order_by(Lead.updated_at.desc())
    )

    if stage:
        query = query.where(Lead.stage == stage)

    if search:
        query = query.join(Contact).where(
            (Contact.name.ilike(f"%{search}%")) | (Contact.phone.ilike(f"%{search}%"))
        )

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return [LeadResponse.model_validate(l) for l in result.scalars().all()]


@router.get("/performance", response_model=AgentPerformanceResponse)
async def get_my_performance(
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Get performance stats for the current user. Accessible by all roles."""

    from app.services.performance_service import get_agent_performance_trend

    # Get 30-day task/lead stats
    cutoff = datetime.utcnow() - timedelta(days=30)

    tasks_result = await db.execute(
        select(func.count(Task.id)).where(
            Task.assigned_to == current_user.id,
            Task.status == "done",
            Task.completed_at >= cutoff
        )
    )
    tasks_completed_30d = tasks_result.scalar() or 0

    leads_result = await db.execute(
        select(func.count(Lead.id)).where(
            Lead.assigned_to == current_user.id,
            Lead.stage.in_(["site_visit_scheduled", "site_visit_done", "negotiation", "won"]),
            Lead.created_at >= cutoff
        )
    )
    leads_converted_30d = leads_result.scalar() or 0

    # Get rating setter name
    rating_set_by_name = None
    if current_user.rating_set_by:
        rating_setter = await db.get(Agent, current_user.rating_set_by)
        if rating_setter:
            rating_set_by_name = rating_setter.name

    # Get trend data
    trend_data = await get_agent_performance_trend(db, current_user.id, days=14)

    return AgentPerformanceResponse(
        agent_id=current_user.id,
        agent_name=current_user.name,
        role=current_user.role,
        star_rating=current_user.star_rating,
        performance_score=float(current_user.performance_score),
        completion_rate=float(current_user.completion_rate),
        conversion_rate=float(current_user.conversion_rate),
        avg_remark_quality=float(current_user.avg_remark_quality),
        tasks_completed_30d=tasks_completed_30d,
        leads_converted_30d=leads_converted_30d,
        rating_set_by=current_user.rating_set_by,
        rating_set_by_name=rating_set_by_name,
        rating_set_at=current_user.rating_set_at.isoformat() if current_user.rating_set_at else None,
        trend_data=trend_data,
    )
