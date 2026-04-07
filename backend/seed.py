import asyncio
from app.db.base import AsyncSessionLocal
from app.models.agent import Agent
from app.core.security import hash_password

async def seed():
    async with AsyncSessionLocal() as session:
        # Check if agent already exists
        from sqlalchemy import select
        res = await session.execute(select(Agent).where(Agent.email == "shardul@propello.ai"))
        if not res.scalar_one_or_none():
            agent = Agent(
                name="Shardul Admin",
                email="shardul@propello.ai",
                password_hash=hash_password("admin123"),
                role="admin",
                is_active=True
            )
            session.add(agent)
            await session.commit()
            print("Successfully seeded admin user!")
        else:
            print("Admin user already exists.")

if __name__ == "__main__":
    asyncio.run(seed())
