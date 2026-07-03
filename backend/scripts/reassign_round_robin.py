"""
Evenly redistribute leads (round-robin) across the live sales agents
(Sunil / Chitra / Priyanka) and re-point each lead's pending tasks to match.

The pool = every lead currently assigned to any of the three. They are sorted
deterministically and dealt out one-by-one so each agent ends up with an equal
share (±1). Run the dry-run first — it prints the CURRENT distribution (handy on
its own) and the proposed one.

Usage (from backend/):
    python -m scripts.reassign_round_robin           # preview only
    python -m scripts.reassign_round_robin --apply   # actually redistribute
"""
import argparse
import asyncio

from sqlalchemy import select, or_, func, update

from app.db.base import AsyncSessionLocal
from app.models.agent import Agent
from app.models.lead import Lead
from app.models.models import Task

LIVE_SALES_AGENT_NAMES = ["Sunil", "Chitra", "Priyanka"]
PENDING_STATUSES = ("pending", "overdue")


async def main(apply: bool) -> None:
    async with AsyncSessionLocal() as session:
        agents = []
        for name in LIVE_SALES_AGENT_NAMES:
            res = await session.execute(
                select(Agent).where(func.lower(Agent.name).like(f"%{name.lower()}%"), Agent.is_active == True)  # noqa: E712
            )
            a = res.scalars().first()
            if a:
                agents.append(a)
            else:
                print(f"  ⚠ no active agent matching '{name}'")
        if len(agents) < 2:
            print("Need at least 2 live agents; aborting.")
            return
        agent_ids = [a.id for a in agents]

        # Pool = leads currently assigned to any of the live agents.
        leads = (await session.execute(
            select(Lead).where(Lead.assigned_to.in_(agent_ids)).order_by(Lead.created_at.asc())
        )).scalars().all()

        def distribution(get_agent):
            d = {a.id: 0 for a in agents}
            for lead in leads:
                aid = get_agent(lead)
                if aid in d:
                    d[aid] += 1
            return d

        print(f"Pool: {len(leads)} leads assigned to the live sales team\n")
        current = distribution(lambda l: l.assigned_to)
        print("CURRENT distribution:")
        for a in agents:
            print(f"  {a.name}: {current[a.id]}")

        # Round-robin deal.
        new_owner = {}
        for i, lead in enumerate(leads):
            new_owner[lead.id] = agent_ids[i % len(agent_ids)]
        proposed = {a.id: 0 for a in agents}
        for aid in new_owner.values():
            proposed[aid] += 1
        print("\nPROPOSED (even) distribution:")
        for a in agents:
            print(f"  {a.name}: {proposed[a.id]}")

        moved = sum(1 for l in leads if l.assigned_to != new_owner[l.id])
        print(f"\n{moved} lead(s) would be reassigned.")

        if not apply:
            print("\nDRY RUN — nothing changed. Re-run with --apply.")
            return

        for lead in leads:
            target = new_owner[lead.id]
            if lead.assigned_to != target:
                lead.assigned_to = target
                # Re-point this lead's pending/overdue tasks to the new owner.
                await session.execute(
                    update(Task)
                    .where(Task.lead_id == lead.id, Task.status.in_(PENDING_STATUSES))
                    .values(assigned_to=target)
                )
        await session.commit()
        print(f"\nReassigned {moved} lead(s) and re-pointed their pending tasks.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually redistribute (default is dry-run)")
    args = parser.parse_args()
    asyncio.run(main(args.apply))
