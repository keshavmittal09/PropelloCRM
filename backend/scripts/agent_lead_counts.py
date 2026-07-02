"""
Diagnostic: list every agent with role, active flag, and how many leads are
assigned to them. Use this to understand the dashboard "Assigned Leads" number.

The admin dashboard counts leads assigned to *active* agents whose role is
agent/call_agent. If that total is higher than expected (e.g. 1884 instead of
~210), this shows which agents are holding the extra leads — usually old agents
still marked active, or campaign bulk-assignments.

Run from the backend/ directory:
    python -m scripts.agent_lead_counts
"""
import asyncio

from sqlalchemy import select, func

from app.db.base import AsyncSessionLocal
from app.models.agent import Agent
from app.models.lead import Lead


async def main() -> None:
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(Agent.id, Agent.name, Agent.email, Agent.role, Agent.is_active)
        )).all()

        counts = dict((r[0], r[1]) for r in (await session.execute(
            select(Lead.assigned_to, func.count(Lead.id)).group_by(Lead.assigned_to)
        )).all())

        print(f"{'ACTIVE':<7}{'ROLE':<12}{'LEADS':>7}  NAME <EMAIL>")
        print("-" * 70)
        sales_total = 0
        for agent_id, name, email, role, is_active in sorted(rows, key=lambda r: -counts.get(r[0], 0)):
            n = counts.get(agent_id, 0)
            print(f"{str(bool(is_active)):<7}{role:<12}{n:>7}  {name} <{email}>")
            if is_active and role in ("agent", "call_agent"):
                sales_total += n

        unassigned = counts.get(None, 0)
        print("-" * 70)
        print(f"Leads on ACTIVE sales agents (dashboard 'Assigned Leads'): {sales_total}")
        print(f"Unassigned leads: {unassigned}")
        print(f"Total leads: {sum(counts.values())}")


if __name__ == "__main__":
    asyncio.run(main())
