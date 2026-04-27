from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime
from app.core.dependencies import get_db, get_current_user
from app.core.security import verify_password, create_access_token, hash_password
from app.models.agent import Agent
from app.models.lead import Lead
from app.models.models import Task, PerformanceSnapshot
from app.schemas.schemas import LoginRequest, TokenResponse, AgentCreate, AgentResponse, AgentRoleUpdate
from pydantic import BaseModel, Field
from typing import Optional, List

router = APIRouter()


# ─── AGENT RATING & PERFORMANCE ENDPOINTS (Feature 5 & 6) ────────────────────

class AgentRatingRequest(BaseModel):
    star_rating: int = Field(ge=1, le=5)


class AgentPerformanceResponse(BaseModel):
    agent_id: str
    agent_name: str
    role: str
    star_rating: Optional[int]
    performance_score: float
    completion_rate: float
    conversion_rate: float
    avg_remark_quality: float
    tasks_completed_30d: int
    leads_converted_30d: int
    rating_set_by: Optional[str]
    rating_set_by_name: Optional[str]
    rating_set_at: Optional[str]
    trend_data: List[dict]


class LeaderboardEntry(BaseModel):
    agent_id: str
    agent_name: str
    role: str
    star_rating: Optional[int]
    performance_score: float
    completion_rate: float
    conversion_rate: float
    active_lead_count: int
    is_active: bool

    class Config:
        from_attributes = True


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Agent).where(Agent.email == data.email))
    agent = result.scalar_one_or_none()

    if not agent or not verify_password(data.password, agent.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not agent.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    token = create_access_token({"sub": agent.id, "role": agent.role})
    return TokenResponse(access_token=token, agent=AgentResponse.model_validate(agent))


@router.get("/me", response_model=AgentResponse)
async def me(current_user: Agent = Depends(get_current_user)):
    return AgentResponse.model_validate(current_user)


@router.post("/agents", response_model=AgentResponse)
async def create_agent(
    data: AgentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    existing = await db.execute(select(Agent).where(Agent.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    agent = Agent(
        name=data.name,
        email=data.email,
        password_hash=hash_password(data.password),
        role=data.role,
        phone=data.phone,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return AgentResponse.model_validate(agent)


@router.get("/agents", response_model=list[AgentResponse])
async def list_agents(
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Admin/Manager only")

    result = await db.execute(select(Agent).where(Agent.is_active == True))
    return [AgentResponse.model_validate(a) for a in result.scalars().all()]


@router.delete("/agents/{agent_id}")
async def delete_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if current_user.id == agent_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    # Soft delete
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    agent.is_active = False
    await db.commit()
    return {"status": "deleted"}


@router.patch("/agents/{agent_id}/role", response_model=AgentResponse)
async def update_agent_role(
    agent_id: str,
    payload: AgentRoleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    allowed_roles = {"admin", "manager", "agent", "call_agent"}
    next_role = (payload.role or "").strip().lower()
    if next_role not in allowed_roles:
        raise HTTPException(status_code=400, detail="Invalid role")

    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if current_user.id == agent_id and next_role != "admin":
        raise HTTPException(status_code=400, detail="Cannot remove your own admin role")

    agent.role = next_role
    await db.commit()
    await db.refresh(agent)
    return AgentResponse.model_validate(agent)


@router.post("/agents/{agent_id}/rating", response_model=AgentResponse)
async def set_agent_rating(
    agent_id: str,
    data: AgentRatingRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Feature 6: Set star rating for an agent (admin/manager only)."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Admin/Manager only")

    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    agent.star_rating = data.star_rating
    agent.rating_set_by = current_user.id
    agent.rating_set_at = datetime.utcnow()

    await db.commit()
    await db.refresh(agent)
    return AgentResponse.model_validate(agent)


@router.get("/agents/leaderboard", response_model=List[LeaderboardEntry])
async def get_leaderboard(
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Feature 6: Get agent leaderboard (admin/manager only)."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Admin/Manager only")

    # Get all active agents with performance data
    result = await db.execute(
        select(Agent).where(Agent.is_active == True)
    )
    agents = result.scalars().all()

    leaderboard = []
    for agent in agents:
        # Count active leads
        leads_result = await db.execute(
            select(func.count(Lead.id)).where(
                Lead.assigned_to == agent.id,
                Lead.stage.notin_(["won", "lost", "nurture"])
            )
        )
        active_lead_count = leads_result.scalar() or 0

        leaderboard.append(
            LeaderboardEntry(
                agent_id=agent.id,
                agent_name=agent.name,
                role=agent.role,
                star_rating=agent.star_rating,
                performance_score=float(agent.performance_score),
                completion_rate=float(agent.completion_rate),
                conversion_rate=float(agent.conversion_rate),
                active_lead_count=active_lead_count,
                is_active=agent.is_active,
            )
        )

    # Sort by: star_rating DESC → performance_score DESC → active_lead_count ASC
    leaderboard.sort(key=lambda x: (-(x.star_rating or 0), -x.performance_score, x.active_lead_count))

    return leaderboard


@router.get("/agents/{agent_id}/performance", response_model=AgentPerformanceResponse)
async def get_agent_performance(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Agent = Depends(get_current_user),
):
    """Feature 6: Get detailed performance for an agent."""
    # Agents can only view their own performance
    if current_user.role not in ("admin", "manager") and current_user.id != agent_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this agent's performance")

    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get 30-day task/lead stats
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(days=30)

    tasks_result = await db.execute(
        select(func.count(Task.id)).where(
            Task.assigned_to == agent_id,
            Task.status == "done",
            Task.completed_at >= cutoff
        )
    )
    tasks_completed_30d = tasks_result.scalar() or 0

    leads_result = await db.execute(
        select(func.count(Lead.id)).where(
            Lead.assigned_to == agent_id,
            Lead.stage.in_(["site_visit_scheduled", "site_visit_done", "negotiation", "won"]),
            Lead.created_at >= cutoff
        )
    )
    leads_converted_30d = leads_result.scalar() or 0

    # Get rating setter name
    rating_set_by_name = None
    if agent.rating_set_by:
        rating_setter = await db.get(Agent, agent.rating_set_by)
        if rating_setter:
            rating_set_by_name = rating_setter.name

    # Get trend data (14-day snapshots)
    from app.services.performance_service import get_agent_performance_trend
    trend_data = await get_agent_performance_trend(db, agent_id, days=14)

    return AgentPerformanceResponse(
        agent_id=agent.id,
        agent_name=agent.name,
        role=agent.role,
        star_rating=agent.star_rating,
        performance_score=float(agent.performance_score),
        completion_rate=float(agent.completion_rate),
        conversion_rate=float(agent.conversion_rate),
        avg_remark_quality=float(agent.avg_remark_quality),
        tasks_completed_30d=tasks_completed_30d,
        leads_converted_30d=leads_converted_30d,
        rating_set_by=agent.rating_set_by,
        rating_set_by_name=rating_set_by_name,
        rating_set_at=agent.rating_set_at.isoformat() if agent.rating_set_at else None,
        trend_data=trend_data,
    )
