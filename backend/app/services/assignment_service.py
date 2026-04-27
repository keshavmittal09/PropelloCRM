"""
Lead Assignment Service
-----------------------
Handles auto-assignment and manual assignment of leads to agents.
"""
from datetime import datetime
from typing import List, Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.agent import Agent
from app.models.lead import Lead
from app.models.contact import Contact
from app.models.models import Activity, Task
from app.services.notification_dispatcher import notify_campaign_assignment_summary


async def get_available_agents(db: AsyncSession) -> List[Agent]:
    """
    Get all active agents (agent and call_agent roles) sorted by:
    1. Star rating DESC
    2. Performance score DESC
    3. Active lead count ASC
    """
    result = await db.execute(
        select(Agent).where(
            Agent.is_active == True,
            Agent.role.in_(["agent", "call_agent"])
        )
    )
    agents = result.scalars().all()

    # Get active lead counts for each agent
    agent_lead_counts = {}
    for agent in agents:
        count_result = await db.execute(
            select(func.count(Lead.id)).where(
                Lead.assigned_to == agent.id,
                Lead.stage.notin_(["won", "lost", "nurture"])
            )
        )
        agent_lead_counts[agent.id] = count_result.scalar() or 0

    # Sort: star_rating DESC → performance_score DESC → active_lead_count ASC
    agents.sort(
        key=lambda a: (
            -(a.star_rating or 0),
            -float(a.performance_score),
            agent_lead_counts[a.id]
        )
    )

    return agents


async def auto_assign_leads(
    db: AsyncSession,
    lead_ids: List[str],
    campaign_id: Optional[str] = None,
    campaign_name: Optional[str] = None,
) -> dict:
    """
    Auto-assign leads to agents based on:
    - P1/P2 leads → top star-rated agent (highest priority)
    - P3-P5 leads → agent with lowest active lead count (load balancing)

    Returns:
        dict: {assigned: int, by_tier: {P1: int, P2: int, ...}}
    """
    agents = await get_available_agents(db)

    if not agents:
        return {"assigned": 0, "by_tier": {}, "error": "No available agents"}

    assigned_count = 0
    by_tier = {}
    assignments_by_agent = {}  # agent_id -> count

    for lead_id in lead_ids:
        lead = await db.get(Lead, lead_id)
        if not lead:
            continue

        # Determine priority tier
        priority = lead.priority or "P3"

        if priority in ["P1", "P2"]:
            # Hot leads go to top-rated agent
            assignee = agents[0]
        else:
            # Lower tiers: load balance to agent with fewest active leads
            # Re-count for accuracy
            lead_counts = {}
            for agent in agents:
                count_result = await db.execute(
                    select(func.count(Lead.id)).where(
                        Lead.assigned_to == agent.id,
                        Lead.stage.notin_(["won", "lost", "nurture"])
                    )
                )
                lead_counts[agent.id] = count_result.scalar() or 0

            assignee = min(agents, key=lambda a: lead_counts[a.id])

        # Assign lead
        old_assignee_id = lead.assigned_to
        lead.assigned_to = assignee.id

        # Update priority tier if needed
        if priority not in ["P1", "P2", "P3", "P4", "P5"]:
            # Map old priority to new tier
            priority_map = {"high": "P2", "normal": "P3", "low": "P4"}
            lead.priority = priority_map.get(priority, "P3")

        # Log assignment in activity
        contact = await db.get(Contact, lead.contact_id)
        activity = Activity(
            lead_id=lead.id,
            contact_id=lead.contact_id if contact else None,
            type="stage_change",
            title="Lead assigned via auto-assignment",
            description=f"Assigned to {assignee.name}",
            performed_by=None,  # System assignment
            meta={
                "assignment_type": "auto",
                "previous_assignee": old_assignee_id,
                "new_assignee": assignee.id,
                "priority_tier": lead.priority,
            }
        )
        db.add(activity)

        assigned_count += 1
        by_tier[lead.priority] = by_tier.get(lead.priority, 0) + 1
        assignments_by_agent[assignee.id] = assignments_by_agent.get(assignee.id, 0) + 1

    # Send notifications to each agent about their new leads
    for agent_id, count in assignments_by_agent.items():
        if campaign_id:
            await notify_campaign_assignment_summary(db, agent_id, count, campaign_id or "Unknown")

    return {"assigned": assigned_count, "by_tier": by_tier}


async def manual_assign_leads(
    db: AsyncSession,
    lead_ids: List[str],
    agent_id: str,
    current_user_id: str,
    reason: Optional[str] = None,
) -> dict:
    """
    Manually assign leads to a specific agent.
    If leads are already assigned, logs override with reason.

    Returns:
        dict: {assigned: int, reassigned: int, failed: int}
    """
    assignee = await db.get(Agent, agent_id)
    if not assignee:
        return {"assigned": 0, "reassigned": 0, "failed": 0, "error": "Agent not found"}

    assigned = 0
    reassigned = 0
    failed = 0

    for lead_id in lead_ids:
        lead = await db.get(Lead, lead_id)
        if not lead:
            failed += 1
            continue

        old_assignee_id = lead.assigned_to
        lead.assigned_to = agent_id

        # Log assignment
        contact = await db.get(Contact, lead.contact_id)
        is_reassignment = old_assignee_id and old_assignee_id != agent_id

        activity = Activity(
            lead_id=lead.id,
            contact_id=lead.contact_id if contact else None,
            type="stage_change",
            title="Lead reassigned" if is_reassignment else "Lead assigned",
            description=f"Assigned to {assignee.name}" + (f" (Reason: {reason})" if reason else ""),
            performed_by=current_user_id,
            meta={
                "assignment_type": "manual_override" if is_reassignment else "manual",
                "previous_assignee": old_assignee_id,
                "new_assignee": agent_id,
                "reason": reason,
            }
        )
        db.add(activity)

        if is_reassignment:
            reassigned += 1
        else:
            assigned += 1

    return {"assigned": assigned, "reassigned": reassigned, "failed": failed}


async def get_leads_for_assignment_table(
    db: AsyncSession,
    campaign_id: Optional[str] = None,
    batch_id: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    priority_tier: Optional[str] = None,
    assigned: Optional[str] = None,  # "assigned" or "unassigned"
    agent_name: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "priority_tier",
    sort_dir: str = "asc",
) -> dict:
    """
    Get leads for the assignment table in campaign dashboard.
    Supports filtering, sorting, and pagination.
    """
    from sqlalchemy import or_, and_

    # Base query - use campaign_leads from campaign_dashboard table if batch_id provided
    if batch_id:
        from app.models.campaign_dashboard import CampaignLead as CDLead
        query = select(CDLead).where(CDLead.batch_id == batch_id)

        # Apply filters
        if priority_tier:
            query = query.where(CDLead.priority_tier == priority_tier)

        if assigned == "assigned":
            query = query.where(CDLead.assigned_agent.isnot(None))
        elif assigned == "unassigned":
            query = query.where(CDLead.assigned_agent.is_(None))

        if search:
            query = query.where(
                or_(
                    CDLead.name.ilike(f"%{search}%"),
                    CDLead.phone_number.cast(str).ilike(f"%{search}%")
                )
            )

        # Get total count
        count_query = select(func.count(CDLead.id))
        if batch_id:
            count_query = count_query.where(CDLead.batch_id == batch_id)
        if priority_tier:
            count_query = count_query.where(CDLead.priority_tier == priority_tier)
        # ... apply same filters as above

        total = (await db.execute(count_query)).scalar() or 0

        # Sorting
        sort_columns = {
            "priority_tier": CDLead.priority_tier,
            "lead_score": CDLead.lead_score,
            "name": CDLead.name,
            "updated_at": CDLead.updated_at,
        }
        sort_col = sort_columns.get(sort_by, CDLead.priority_tier)
        if sort_dir == "desc":
            sort_col = sort_col.desc()
        else:
            sort_col = sort_col.asc()

        query = query.order_by(sort_col).offset((page - 1) * limit).limit(limit)
        result = await db.execute(query)
        leads = result.scalars().all()

        return {
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": (total + limit - 1) // limit if total else 1,
            "leads": leads,
        }
    else:
        # Fallback to regular leads table
        query = select(Lead).where(Lead.campaign_id == campaign_id)

        if priority_tier:
            query = query.where(Lead.priority == priority_tier)

        if assigned == "assigned":
            query = query.where(Lead.assigned_to.isnot(None))
        elif assigned == "unassigned":
            query = query.where(Lead.assigned_to.is_(None))

        if search:
            query = query.join(Contact).where(
                or_(
                    Contact.name.ilike(f"%{search}%"),
                    Contact.phone.ilike(f"%{search}%")
                )
            )

        total = (await db.execute(select(func.count(Lead.id)).where(*query._where_criteria))).scalar() or 0
        query = query.offset((page - 1) * limit).limit(limit)
        result = await db.execute(query)
        leads = result.scalars().all()

        return {
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": (total + limit - 1) // limit if total else 1,
            "leads": leads,
        }
