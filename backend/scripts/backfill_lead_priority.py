"""
Backfill priority from lead type so it matches the upload rule:
  Hot  -> lead P1 / pending-task 'high'
  Warm -> lead P2 / pending-task 'normal'
  Cold -> lead P3 / pending-task 'low'

Updates Lead.priority for every lead, and the priority of each lead's
pending/overdue tasks so agents call Hot leads first.

Usage (from backend/):
    python -m scripts.backfill_lead_priority           # preview counts
    python -m scripts.backfill_lead_priority --apply
"""
import argparse
import asyncio

from sqlalchemy import select, update, func

from app.db.base import AsyncSessionLocal
from app.models.lead import Lead
from app.models.models import Task

LEAD_PRIORITY = {"hot": "P1", "warm": "P2", "cold": "P3"}
TASK_PRIORITY = {"hot": "high", "warm": "normal", "cold": "low"}
PENDING_STATUSES = ("pending", "overdue")


async def main(apply: bool) -> None:
    async with AsyncSessionLocal() as session:
        for score in ("hot", "warm", "cold"):
            n = (await session.execute(
                select(func.count(Lead.id)).where(Lead.lead_score == score)
            )).scalar()
            print(f"  {score:<5} leads: {n}  -> priority {LEAD_PRIORITY[score]} / task {TASK_PRIORITY[score]}")

        if not apply:
            print("\nDRY RUN — nothing changed. Re-run with --apply.")
            return

        lead_updates = 0
        task_updates = 0
        for score in ("hot", "warm", "cold"):
            r1 = await session.execute(
                update(Lead).where(Lead.lead_score == score).values(priority=LEAD_PRIORITY[score])
            )
            lead_updates += r1.rowcount or 0
            r2 = await session.execute(
                update(Task)
                .where(
                    Task.lead_id.in_(select(Lead.id).where(Lead.lead_score == score)),
                    Task.status.in_(PENDING_STATUSES),
                )
                .values(priority=TASK_PRIORITY[score])
            )
            task_updates += r2.rowcount or 0
        await session.commit()
        print(f"\nUpdated {lead_updates} lead(s) and {task_updates} pending task(s).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.apply))
