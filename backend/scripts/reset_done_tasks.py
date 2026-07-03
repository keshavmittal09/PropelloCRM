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

from sqlalchemy import select, or_, func

from app.db.base import AsyncSessionLocal
from app.models.agent import Agent
from app.models.models import Task

LIVE_SALES_AGENT_NAMES = ["Sunil", "Chitra", "Priyanka"]


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

        # Clean reset: the task goes back to pending and its completion outcome is
        # cleared, so the dashboard (which counts each lead's latest DONE task's
        # completion_interest) starts from zero and fills in again only as agents
        # re-classify these leads on real calls.
        if apply:
            for t in tasks:
                t.status = "pending"
                t.completed_at = None
                t.completion_remark = None
                t.completion_tags = None
                t.completion_interest = None
                t.completion_call_status = None
            await session.commit()
            print(f"Reset {len(tasks)} task(s) to pending (completion outcome cleared).")
        else:
            print("DRY RUN — nothing changed. Re-run with --apply to reset.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually reset (default is dry-run)")
    parser.add_argument("--all", action="store_true", help="Include every agent, not just the live sales team")
    args = parser.parse_args()
    asyncio.run(main(args.apply, args.all))
