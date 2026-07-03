"""
Set (reset) an agent's password by email. Case-insensitive email match.

Usage (from backend/):
    python -m scripts.set_agent_password chitra@propello.ai chitra123
"""
import argparse
import asyncio

from sqlalchemy import select, func

from app.db.base import AsyncSessionLocal
from app.models.agent import Agent
from app.core.security import hash_password


async def main(email: str, password: str) -> None:
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            select(Agent).where(func.lower(Agent.email) == email.strip().lower())
        )
        agent = res.scalar_one_or_none()
        if not agent:
            print(f"No agent found with email {email!r}")
            return
        agent.password_hash = hash_password(password)
        agent.is_active = True
        await session.commit()
        print(f"Password set for {agent.name} <{agent.email}> (role={agent.role}, active=True)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email")
    parser.add_argument("password")
    args = parser.parse_args()
    asyncio.run(main(args.email, args.password))
