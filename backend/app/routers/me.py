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
    priority_order = case(
        (Task.priority == "high", 0),
        (Task.priority == "normal", 1),
        (Task.priority == "low", 2),
        else_=3,
    )

    query = (
        select(Task)
        .options(*_task_query_options())
        .where(Task.assigned_to == current_user.id)
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
