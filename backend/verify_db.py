import asyncio
from app.db.base import AsyncSessionLocal
from app.models.lead import Lead
from app.models.contact import Contact
from app.models.followup import FollowUp
from app.models.models import Activity
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as session:
        # Check Leads
        result = await session.execute(select(Lead))
        leads = result.scalars().all()
        print(f"--- Total Leads: {len(leads)} ---")
        for lead in leads:
            contact = await session.get(Contact, lead.contact_id)
            print(f"Lead ID: {lead.id} | Name: {contact.name if contact else 'Unknown'} | Source: {lead.source}")
        
        # Check Followups
        result = await session.execute(select(FollowUp))
        fups = result.scalars().all()
        print(f"\n--- Total Scheduled FollowUps: {len(fups)} ---")
        for f in fups:
            print(f"FollowUp: {f.channel} | Template: {f.template} | Trigger: {f.triggered_by} | Status: {f.status} | Scheduled: {f.scheduled_at}")
            
        # Check Activities
        result = await session.execute(select(Activity))
        acts = result.scalars().all()
        print(f"\n--- Total Activities Logged: {len(acts)} ---")
        for a in acts:
            print(f"Activity: {a.type} | Title: {a.title} | Outcome: {a.outcome}")

if __name__ == "__main__":
    asyncio.run(main())
