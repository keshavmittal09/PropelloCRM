"""
Lowercase any agent email that isn't already lowercase, so logins don't depend
on exact casing (e.g. "Priyanka@propello.ai" -> "priyanka@propello.ai"). Skips a
change that would collide with an existing lowercase email.

Usage (from backend/):
    python -m scripts.normalize_agent_emails            # preview
    python -m scripts.normalize_agent_emails --apply
"""
import argparse
import asyncio

from sqlalchemy import select, func

from app.db.base import AsyncSessionLocal
from app.models.agent import Agent


async def main(apply: bool) -> None:
    async with AsyncSessionLocal() as session:
        agents = (await session.execute(select(Agent))).scalars().all()
        existing = {(a.email or "").lower() for a in agents}
        changed = 0
        for a in agents:
            low = (a.email or "").strip().lower()
            if a.email == low:
                continue
            # Only change if the lowercase form isn't already taken by someone else.
            if low in existing and low != (a.email or "").lower():
                print(f"  ⚠ skip {a.email} -> {low} (collision)")
                continue
            print(f"  {a.email} -> {low}")
            if apply:
                a.email = low
            changed += 1
        if apply and changed:
            await session.commit()
        print(f"\n{'Updated' if apply else 'Would update'} {changed} email(s)."
              + ("" if apply else " Re-run with --apply."))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.apply))
