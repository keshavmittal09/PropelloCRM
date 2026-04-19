from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.dependencies import get_db, get_current_user
from app.core.security import verify_password, create_access_token, hash_password
from app.models.agent import Agent
from app.schemas.schemas import LoginRequest, TokenResponse, AgentCreate, AgentResponse, AgentRoleUpdate

router = APIRouter()


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
