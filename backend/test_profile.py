import asyncio
import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.db.base import AsyncSessionLocal
from app.routers.leads import get_master_profile
from app.models.agent import Agent

async def test():
    async with AsyncSessionLocal() as db:
        try:
            res = await get_master_profile('7ab89e13-92de-47f5-8144-edbdc6f8b688', db, Agent(id='test', role='admin'))
            print("SUCCESS", res)
        except Exception as e:
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test())
