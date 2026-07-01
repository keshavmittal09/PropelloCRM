"""
Remove stale *pending* tasks so the Tasks → Pending board only shows work for the
currently live sales agents (Sunil, Chitra, Priyanka).

Any pending/overdue task assigned to someone else (a former agent) — or left
unassigned — is deleted. Done tasks are never touched, so history is preserved.

Usage (run from the backend/ directory with the app venv active):

    # Preview what would be removed (safe, no changes):
    python -m scripts.cleanup_pending_tasks

    # Actually delete them:
    python -m scripts.cleanup_pending_tasks --apply

    # Override the keep-list (case-insensitive name match):
    python -m scripts.cleanup_pending_tasks --keep "Sunil,Chitra,Priyanka" --apply
"""
import argparse
import asyncio

from sqlalchemy import select, or_, func

from app.db.base import AsyncSessionLocal
from app.models.agent import Agent
from app.models.models import Task

# Task statuses that appear on the "Pending" board (pending + overdue).
PENDING_STATUSES = ("pending", "overdue")
DEFAULT_KEEP = ["Sunil", "Chitra", "Priyanka"]


async def resolve_keep_agent_ids(session, keep_names: list[str]) -> list[str]:
    ids: list[str] = []
    for name in keep_names:
        result = await session.execute(
            select(Agent).where(func.lower(Agent.name).like(f"%{name.strip().lower()}%"))
        )
        matches = result.scalars().all()
        if not matches:
            print(f"  ⚠ no agent found matching '{name}'")
            continue
        for a in matches:
            print(f"  ✓ keep: {a.name} <{a.email}> [{a.role}] id={a.id}")
            ids.append(a.id)
    return ids


async def main(apply: bool, keep_names: list[str]) -> None:
    async with AsyncSessionLocal() as session:
        print("Resolving live agents to keep:")
        keep_ids = await resolve_keep_agent_ids(session, keep_names)
        if not keep_ids:
            print("Aborting: no keep-agents resolved (would delete everything).")
            return

        # Pending/overdue tasks NOT assigned to a live agent (incl. unassigned).
        stale_q = select(Task).where(
            Task.status.in_(PENDING_STATUSES),
            or_(Task.assigned_to.is_(None), Task.assigned_to.notin_(keep_ids)),
        )
        stale = (await session.execute(stale_q)).scalars().all()

        print(f"\nFound {len(stale)} stale pending task(s) to remove.")
        if not stale:
            return

        # Summarise by assignee for visibility.
        by_agent: dict[str, int] = {}
        for t in stale:
            by_agent[t.assigned_to or "(unassigned)"] = by_agent.get(t.assigned_to or "(unassigned)", 0) + 1
        for agent_id, count in sorted(by_agent.items(), key=lambda kv: -kv[1]):
            name = "(unassigned)"
            if agent_id != "(unassigned)":
                a = await session.get(Agent, agent_id)
                name = a.name if a else agent_id
            print(f"  - {name}: {count}")

        if not apply:
            print("\nDRY RUN — nothing deleted. Re-run with --apply to delete.")
            return

        for t in stale:
            await session.delete(t)
        await session.commit()
        print(f"\nDeleted {len(stale)} stale pending task(s).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually delete (default is dry-run)")
    parser.add_argument("--keep", default=",".join(DEFAULT_KEEP), help="Comma-separated agent names to keep")
    args = parser.parse_args()
    asyncio.run(main(args.apply, [n for n in args.keep.split(",") if n.strip()]))
