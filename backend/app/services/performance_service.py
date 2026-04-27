"""
Agent Performance Scoring Service
---------------------------------
Computes performance scores for agents based on:
- Task Completion Rate (40% weight)
- Lead Conversion Rate (35% weight)
- Remark Quality Score (25% weight)
"""
from datetime import datetime, timedelta
from sqlalchemy import select, func, case
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.agent import Agent
from app.models.lead import Lead
from app.models.models import Task, PerformanceSnapshot


async def compute_agent_performance(
    db: AsyncSession,
    agent_id: str,
    days: int = 30,
) -> dict:
    """
    Compute performance score for an agent over the last N days.

    Formula:
    performance_score = (completion_rate * 0.40) + (conversion_rate * 0.35) + (avg_remark_quality * 10 * 0.25)

    Returns:
        dict: {
            "performance_score": float 0-100,
            "completion_rate": float 0-100,
            "conversion_rate": float 0-100,
            "avg_remark_quality": float 0-10,
            "tasks_assigned": int,
            "tasks_completed": int,
            "leads_handled": int,
            "leads_converted": int,
        }
    """
    cutoff_date = datetime.utcnow() - timedelta(days=days)

    # Signal 1: Task Completion Rate (40% weight)
    tasks_result = await db.execute(
        select(
            func.count(Task.id).label("total"),
            func.sum(case((Task.status == "done", 1), else_=0)).label("completed"),
        ).where(
            Task.assigned_to == agent_id,
            Task.created_at >= cutoff_date
        )
    )
    tasks_row = tasks_result.one()
    tasks_assigned = tasks_row[0] or 0
    tasks_completed = tasks_row[1] or 0

    completion_rate = (tasks_completed / tasks_assigned * 100) if tasks_assigned > 0 else 0

    # Signal 2: Lead Conversion Rate (35% weight)
    leads_result = await db.execute(
        select(
            func.count(Lead.id).label("total"),
            func.sum(case((Lead.stage.in_(["site_visit_scheduled", "site_visit_done", "negotiation", "won"]), 1), else_=0)).label("converted"),
        ).where(
            Lead.assigned_to == agent_id,
            Lead.created_at >= cutoff_date
        )
    )
    leads_row = leads_result.one()
    leads_handled = leads_row[0] or 0
    leads_converted = leads_row[1] or 0

    conversion_rate = (leads_converted / leads_handled * 100) if leads_handled > 0 else 0

    # Signal 3: Remark Quality Score (25% weight)
    remark_result = await db.execute(
        select(
            func.avg(Task.remark_quality_score)
        ).where(
            Task.assigned_to == agent_id,
            Task.remark_quality_score.isnot(None),
            Task.status == "done",
            Task.completed_at >= cutoff_date
        )
    )
    avg_remark_quality = remark_result.scalar() or 0

    # Final formula
    performance_score = (
        (completion_rate * 0.40) +
        (conversion_rate * 0.35) +
        (avg_remark_quality * 10 * 0.25)
    )

    return {
        "performance_score": round(performance_score, 2),
        "completion_rate": round(completion_rate, 2),
        "conversion_rate": round(conversion_rate, 2),
        "avg_remark_quality": round(float(avg_remark_quality), 2),
        "tasks_assigned": tasks_assigned,
        "tasks_completed": tasks_completed,
        "leads_handled": leads_handled,
        "leads_converted": leads_converted,
    }


async def update_agent_performance(
    db: AsyncSession,
    agent_id: str,
    days: int = 30,
    create_snapshot: bool = True,
) -> dict:
    """
    Compute and update agent's performance fields in the database.
    Also creates a snapshot record.
    """
    result = await compute_agent_performance(db, agent_id, days)

    # Update Agent record
    agent = await db.get(Agent, agent_id)
    if agent:
        agent.performance_score = result["performance_score"]
        agent.completion_rate = result["completion_rate"]
        agent.conversion_rate = result["conversion_rate"]
        agent.avg_remark_quality = result["avg_remark_quality"]
        agent.last_score_computed_at = datetime.utcnow()

    # Create historical snapshot for batch/nightly runs unless explicitly skipped.
    if create_snapshot:
        snapshot = PerformanceSnapshot(
            agent_id=agent_id,
            performance_score=result["performance_score"],
            completion_rate=result["completion_rate"],
            conversion_rate=result["conversion_rate"],
            avg_remark_quality=result["avg_remark_quality"],
            tasks_completed=result["tasks_completed"],
            leads_converted=result["leads_converted"],
        )
        db.add(snapshot)

    return result


async def update_agent_performance_live(
    db: AsyncSession,
    agent_id: str,
    days: int = 30,
) -> dict:
    """
    Recompute and refresh an agent's live performance fields without creating a snapshot.
    Intended for event-driven updates (e.g., task completion).
    """
    return await update_agent_performance(db, agent_id, days=days, create_snapshot=False)


async def compute_all_agents_performance(
    db: AsyncSession,
    days: int = 30,
) -> dict:
    """
    Compute performance for all active agents.
    Returns summary of updates.
    """
    result = await db.execute(
        select(Agent).where(Agent.is_active == True)
    )
    agents = result.scalars().all()

    updated = 0
    errors = 0

    for agent in agents:
        try:
            await update_agent_performance(db, agent.id, days)
            updated += 1
        except Exception:
            errors += 1

    await db.commit()

    return {
        "updated": updated,
        "errors": errors,
        "total": len(agents),
    }


async def get_agent_performance_trend(
    db: AsyncSession,
    agent_id: str,
    days: int = 14,
) -> list[dict]:
    """
    Get performance trend data for the last N days.
    Returns array of daily snapshots for sparkline.
    """
    cutoff_date = datetime.utcnow() - timedelta(days=days)

    result = await db.execute(
        select(PerformanceSnapshot)
        .where(
            PerformanceSnapshot.agent_id == agent_id,
            PerformanceSnapshot.snapshot_date >= cutoff_date
        )
        .order_by(PerformanceSnapshot.snapshot_date.asc())
    )

    snapshots = result.scalars().all()

    return [
        {
            "date": s.snapshot_date.isoformat(),
            "performance_score": float(s.performance_score),
            "completion_rate": float(s.completion_rate),
            "conversion_rate": float(s.conversion_rate),
        }
        for s in snapshots
    ]
