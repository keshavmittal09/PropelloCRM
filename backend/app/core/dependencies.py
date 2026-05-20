from typing import AsyncGenerator
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.config import settings
from app.db.base import AsyncSessionLocal
from app.core.security import decode_token
from app.models.agent import Agent

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Agent:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_token(token)
    if not payload:
        raise credentials_exception

    agent_id: str = payload.get("sub")
    if not agent_id:
        raise credentials_exception

    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent or not agent.is_active:
        raise credentials_exception
    return agent


def require_role(*roles: str):
    async def _checker(current_user: Agent = Depends(get_current_user)) -> Agent:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role}' not permitted. Required: {roles}",
            )
        return current_user
    return _checker


async def require_whatsapp_secret(
    x_webhook_secret: str | None = Header(default=None, alias="X-Webhook-Secret"),
) -> None:
    """Service-to-service auth for WhatsApp bot ↔ CRM integration endpoints."""
    expected = settings.WHATSAPP_WEBHOOK_SECRET
    if not expected or not x_webhook_secret or x_webhook_secret != expected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing X-Webhook-Secret",
        )
