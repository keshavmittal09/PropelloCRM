"""
Set priority by type ONLY for leads assigned to the live sales agents
(Sunil/Chitra/Priyanka) — the ~210 leads the sales team works:
  Hot  -> lead P1 / pending-task 'high'
  Warm -> lead P2 / pending-task 'normal'
  Cold -> lead P3 / pending-task 'low'

Every OTHER lead is reset to the neutral default (P3 / task 'normal') so the
whole database is not promoted to P1/P2.

Usage (from backend/):
    python -m scripts.backfill_lead_priority           # preview counts
    python -m scripts.backfill_lead_priority --apply
"""
import argparse
import asyncio

from sqlalchemy import select, update, func, or_

from app.db.base import AsyncSessionLocal
from app.models.agent import Agent
from app.models.lead import Lead
from app.models.models import Task

LIVE_SALES_AGENT_NAMES = ["Sunil", "Chitra", "Priyanka"]
LEAD_PRIORITY = {"hot": "P1", "warm": "P2", "cold": "P3"}
TASK_PRIORITY = {"hot": "high", "warm": "normal", "cold": "low"}
PENDING_STATUSES = ("pending", "overdue")


def sales_agent_ids():
    name_filters = [func.lower(Agent.name).like(f"%{n.lower()}%") for n in LIVE_SALES_AGENT_NAMES]
    return select(Agent.id).where(Agent.is_active == True, or_(*name_filters))  # noqa: E712


async def main(apply: bool) -> None:
    async with AsyncSessionLocal() as session:
        sales_ids = sales_agent_ids()
        assigned_total = (await session.execute(
            select(func.count(Lead.id)).where(Lead.assigned_to.in_(sales_ids))
        )).scalar()
        print(f"Leads assigned to the sales team: {assigned_total}")
        for score in ("hot", "warm", "cold"):
            n = (await session.execute(
                select(func.count(Lead.id)).where(Lead.assigned_to.in_(sales_ids), Lead.lead_score == score)
            )).scalar()
            print(f"  {score:<5}: {n} -> {LEAD_PRIORITY[score]}")

        if not apply:
            print("\nDRY RUN — nothing changed. Re-run with --apply.")
            return

        # 1) Reset EVERY lead + pending task to the neutral default first.
        await session.execute(update(Lead).values(priority="P3"))
        await session.execute(
            update(Task).where(Task.status.in_(PENDING_STATUSES)).values(priority="normal")
        )

        # 2) Apply type-based priority ONLY to sales-team-assigned leads.
        sales_lead_ids = select(Lead.id).where(Lead.assigned_to.in_(sales_ids))
        for score in ("hot", "warm", "cold"):
            await session.execute(
                update(Lead)
                .where(Lead.assigned_to.in_(sales_ids), Lead.lead_score == score)
                .values(priority=LEAD_PRIORITY[score])
            )
            await session.execute(
                update(Task)
                .where(
                    Task.lead_id.in_(select(Lead.id).where(Lead.assigned_to.in_(sales_ids), Lead.lead_score == score)),
                    Task.status.in_(PENDING_STATUSES),
                )
                .values(priority=TASK_PRIORITY[score])
            )
        await session.commit()
        print(f"\nDone. Prioritised {assigned_total} sales-team leads by type; reset all others to P3/normal.")
        _ = sales_lead_ids


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.apply))
