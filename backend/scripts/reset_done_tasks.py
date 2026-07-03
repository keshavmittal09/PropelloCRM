"""
Reset completed (done) tasks back to *pending* so sales agents can re-work them,
WITHOUT losing the Hot/Warm/Cold they already picked.

For every done task it first copies the classification out of the completion
remark ("Interest: Hot/Warm/Cold") onto Lead.last_call_interest — the field the
dashboard counts — so the dashboard still shows the correct hot/warm numbers even
after the tasks move back to pending. Then it sets the task back to pending.

Usage (from the backend/ directory, app venv active):

    python -m scripts.reset_done_tasks            # preview (safe, no changes)
    python -m scripts.reset_done_tasks --apply    # apply to Sunil/Chitra/Priyanka
    python -m scripts.reset_done_tasks --all --apply   # include every agent
"""
import argparse
import asyncio
import re

from sqlalchemy import select, or_, func

from app.db.base import AsyncSessionLocal
from app.models.agent import Agent
from app.models.models import Task
from app.models.lead import Lead

LIVE_SALES_AGENT_NAMES = ["Sunil", "Chitra", "Priyanka"]


def parse_interest(remark: str | None) -> str | None:
    if not remark:
        return None
    m = re.search(r"interest:?\s*(hot|warm|cold)", remark, re.IGNORECASE)
    return m.group(1).lower() if m else None


async def main(apply: bool, all_agents: bool) -> None:
    async with AsyncSessionLocal() as session:
        query = select(Task).where(Task.status == "done")
        if not all_agents:
            name_filters = [func.lower(Agent.name).like(f"%{n.lower()}%") for n in LIVE_SALES_AGENT_NAMES]
            sales_ids = select(Agent.id).where(Agent.is_active == True, or_(*name_filters))  # noqa: E712
            query = query.where(Task.assigned_to.in_(sales_ids))

        tasks = (await session.execute(query)).scalars().all()
        print(f"Found {len(tasks)} done task(s) to reset"
              + ("" if all_agents else " (Sunil/Chitra/Priyanka)"))

        backfilled = 0
        for t in tasks:
            interest = parse_interest(t.completion_remark)
            if interest and t.lead_id:
                lead = await session.get(Lead, t.lead_id)
                if lead and not lead.last_call_interest:
                    if apply:
                        lead.last_call_interest = interest
                    backfilled += 1
            if apply:
                t.status = "pending"
                t.completed_at = None

        print(f"Lead classifications preserved (backfilled to last_call_interest): {backfilled}")
        if apply:
            await session.commit()
            print(f"Reset {len(tasks)} task(s) to pending.")
        else:
            print("DRY RUN — nothing changed. Re-run with --apply to reset.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually reset (default is dry-run)")
    parser.add_argument("--all", action="store_true", help="Include every agent, not just the live sales team")
    args = parser.parse_args()
    asyncio.run(main(args.apply, args.all))
