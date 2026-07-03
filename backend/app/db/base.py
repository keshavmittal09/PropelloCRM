from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings
import ssl


class Base(DeclarativeBase):
    pass


const_engine_kwargs = {
    "echo": settings.DEBUG,
    "pool_size": 10,
    "max_overflow": 20,
    "pool_timeout": 30,
    # Recycle connections well under typical idle timeouts to keep them fresh.
    "pool_recycle": 300,
    # NOTE: pool_pre_ping is intentionally OFF. With the asyncpg async engine its
    # ping() bridges async->sync via await_only and raises MissingGreenlet on
    # connection checkout, which crashed startup/requests. pool_recycle keeps
    # connections fresh instead.
}

parsed_url = make_url(settings.DATABASE_URL)
use_ssl = parsed_url.host not in {"localhost", "127.0.0.1", "::1"}
if use_ssl:
    const_engine_kwargs["connect_args"] = {"ssl": "require"}

engine = create_async_engine(
    settings.DATABASE_URL,
    **const_engine_kwargs
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def init_db():
    # Ensure all ORM models are imported so metadata contains every table.
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Apply additive schema changes for running PostgreSQL environments.
        if settings.DATABASE_URL.startswith("postgresql"):
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS campaign_id VARCHAR"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_ids JSONB"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS campaign_id VARCHAR"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS recording_url TEXT"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS transcript TEXT"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS call_summary TEXT"))
            await conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS call_eval_tag VARCHAR(10)"))

            await conn.execute(text("ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_campaign_id_fkey"))
            await conn.execute(text("ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_campaign_id_fkey"))
            await conn.execute(text("ALTER TABLE leads ADD CONSTRAINT leads_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id)"))
            await conn.execute(text("ALTER TABLE activities ADD CONSTRAINT activities_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id)"))

            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_leads_campaign_id ON leads (campaign_id)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_activities_campaign_id ON activities (campaign_id)"))

            await conn.execute(text("ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'campaign'"))
            await conn.execute(text("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'campaign_call'"))
            await conn.execute(text("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'task_completion_remark'"))
            await conn.execute(text("ALTER TYPE agent_role ADD VALUE IF NOT EXISTS 'call_agent'"))
            # NOTE: the 'reception' role value is added below in its own isolated
            # transaction so an enum failure can never abort the whole init_db.

            # Feature 1-3: new columns on tasks and leads
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_remark TEXT"))
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_tags JSONB"))
            # Structured heat + call status the agent chose on task completion (drive
            # the dashboard Hot/Warm/Cold/Callback counts). Backfilled from remark text below.
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_interest VARCHAR(20)"))
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_call_status VARCHAR(20)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS dnd BOOLEAN DEFAULT FALSE"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_remark VARCHAR(200)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_interaction_at TIMESTAMP"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS master_profile JSONB"))

            # Features 4-8: Performance tracking, rating, assignment schema
            # Priority enum values P1-P5
            await conn.execute(text("ALTER TYPE lead_priority ADD VALUE IF NOT EXISTS 'P1'"))
            await conn.execute(text("ALTER TYPE lead_priority ADD VALUE IF NOT EXISTS 'P2'"))
            await conn.execute(text("ALTER TYPE lead_priority ADD VALUE IF NOT EXISTS 'P3'"))
            await conn.execute(text("ALTER TYPE lead_priority ADD VALUE IF NOT EXISTS 'P4'"))
            await conn.execute(text("ALTER TYPE lead_priority ADD VALUE IF NOT EXISTS 'P5'"))

            # Agent performance & rating fields
            await conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS star_rating INTEGER"))
            await conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS performance_score NUMERIC(5,2) DEFAULT 0"))
            await conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS completion_rate NUMERIC(5,2) DEFAULT 0"))
            await conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS conversion_rate NUMERIC(5,2) DEFAULT 0"))
            await conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS avg_remark_quality NUMERIC(4,2) DEFAULT 0"))
            await conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS rating_set_by VARCHAR"))
            await conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS rating_set_at TIMESTAMP"))
            await conn.execute(text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_score_computed_at TIMESTAMP"))

            # Task remark quality fields
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remark_quality_score NUMERIC(4,2)"))
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remark_quality_feedback TEXT"))

            # Create performance_snapshots table if not exists
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS performance_snapshots (
                    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
                    agent_id VARCHAR NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                    snapshot_date TIMESTAMP DEFAULT NOW(),
                    performance_score NUMERIC(5,2) NOT NULL DEFAULT 0,
                    completion_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
                    conversion_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
                    avg_remark_quality NUMERIC(4,2) NOT NULL DEFAULT 0,
                    tasks_completed INTEGER NOT NULL DEFAULT 0,
                    leads_converted INTEGER NOT NULL DEFAULT 0
                )
            """))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_performance_snapshots_agent_id ON performance_snapshots (agent_id)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_performance_snapshots_snapshot_date ON performance_snapshots (snapshot_date)"))

            # Demographic profile fields (20260430 migration — were missing from init_db)
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS age_range VARCHAR(20)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS occupation VARCHAR(50)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS occupation_other VARCHAR(100)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS family_size VARCHAR(10)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS income_range VARCHAR(30)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS property_budget VARCHAR(30)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS preferred_location VARCHAR(200)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS purchase_timeline VARCHAR(20)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_call_status VARCHAR(20)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_call_topics JSONB DEFAULT '[]'"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_call_interest VARCHAR(10)"))

            # AI Call Analysis fields (PR #19 — AI workflow enhancement)
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS call_score INTEGER"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS call_sentiment VARCHAR(20)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS intent_level VARCHAR(20)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS interest_level VARCHAR(20)"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_recommended_action TEXT"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_call_transcript TEXT"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_call_summary TEXT"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_status VARCHAR(20) DEFAULT 'not_sent'"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_ai_call_date TIMESTAMP"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_call_date TIMESTAMP"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS max_retries_reached BOOLEAN DEFAULT FALSE"))
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_followup_date TIMESTAMP"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_leads_next_call_date ON leads (next_call_date)"))

            # New activity_type enum values (PR #19)
            await conn.execute(text("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'ai_call_completed'"))
            await conn.execute(text("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'ai_analysis_generated'"))
            await conn.execute(text("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'classified'"))
            await conn.execute(text("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'retry_scheduled'"))
            await conn.execute(text("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'whatsapp_auto_sent'"))
            await conn.execute(text("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'assignment_update'"))
            await conn.execute(text("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'priority_change'"))

            # WhatsApp chat history
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS whatsapp_messages (
                    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
                    phone VARCHAR NOT NULL,
                    contact_id VARCHAR REFERENCES contacts(id) ON DELETE SET NULL,
                    lead_id VARCHAR REFERENCES leads(id) ON DELETE SET NULL,
                    direction VARCHAR(10) NOT NULL DEFAULT 'inbound',
                    message TEXT NOT NULL,
                    wa_message_id VARCHAR UNIQUE,
                    sender_name VARCHAR,
                    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
            """))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_phone ON whatsapp_messages (phone)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_lead_id ON whatsapp_messages (lead_id)"))

            # Marker for leads imported via the Staff-page upload (separate batch)
            await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_uploaded BOOLEAN DEFAULT FALSE"))

    # Widen call-status/interest columns so longer values (e.g. 'not_interested')
    # fit. Run in isolated transactions so a failure can NEVER crash startup /
    # block the deploy.
    for stmt in (
        "ALTER TABLE leads ALTER COLUMN last_call_interest TYPE VARCHAR(30)",
        "ALTER TABLE leads ALTER COLUMN last_call_status TYPE VARCHAR(30)",
        # Dashboard-only 'reception' staff role — isolated so it never blocks startup.
        "ALTER TYPE agent_role ADD VALUE IF NOT EXISTS 'reception'",
        # One-time backfill of tasks.completion_interest from the remark text that the
        # completion form writes ("Interest: Hot"). Idempotent: only fills NULLs, so it
        # is a no-op once every done task carries a structured heat. Ordered priority
        # doesn't matter — a remark carries at most one "Interest:" line.
        "UPDATE tasks SET completion_interest = 'hot' WHERE completion_interest IS NULL "
        "AND status = 'done' AND completion_remark ILIKE '%interest: hot%'",
        "UPDATE tasks SET completion_interest = 'warm' WHERE completion_interest IS NULL "
        "AND status = 'done' AND completion_remark ILIKE '%interest: warm%'",
        "UPDATE tasks SET completion_interest = 'cold' WHERE completion_interest IS NULL "
        "AND status = 'done' AND completion_remark ILIKE '%interest: cold%'",
        # Non-heat outcomes too, so a lead whose latest call was one of these is
        # correctly dropped from the Hot/Warm/Cold counts (latest marking wins).
        "UPDATE tasks SET completion_interest = 'not_interested' WHERE completion_interest IS NULL "
        "AND status = 'done' AND completion_remark ILIKE '%interest: not interested%'",
        "UPDATE tasks SET completion_interest = 'busy' WHERE completion_interest IS NULL "
        "AND status = 'done' AND completion_remark ILIKE '%interest: busy%'",
        "UPDATE tasks SET completion_interest = 'unknown' WHERE completion_interest IS NULL "
        "AND status = 'done' AND completion_remark ILIKE '%interest: don''t know%'",
        # Backfill call status from the "Call status: <Label>" line the form writes,
        # so callback outcomes (No Answer / Call Back Later) are recognised historically.
        "UPDATE tasks SET completion_call_status = 'no_answer' WHERE completion_call_status IS NULL "
        "AND status = 'done' AND completion_remark ILIKE '%call status: no answer%'",
        "UPDATE tasks SET completion_call_status = 'callback' WHERE completion_call_status IS NULL "
        "AND status = 'done' AND completion_remark ILIKE '%call status: call back later%'",
        "UPDATE tasks SET completion_call_status = 'wrong_number' WHERE completion_call_status IS NULL "
        "AND status = 'done' AND completion_remark ILIKE '%call status: wrong number%'",
        "UPDATE tasks SET completion_call_status = 'connected' WHERE completion_call_status IS NULL "
        "AND status = 'done' AND completion_remark ILIKE '%call status: yes, connected%'",
    ):
        try:
            async with engine.begin() as conn2:
                await conn2.execute(text(stmt))
        except Exception:
            pass


# Starter call-agent accounts seeded on startup. Idempotent — only created if the
# email does not already exist. Change these passwords from the Staff page later.
DEFAULT_CALL_AGENTS = [
    {"name": "Nopur", "email": "nopur@propello.ai", "password": "nopur123", "role": "call_agent"},
    {"name": "Sales 1", "email": "sales1@propello.ai", "password": "sales1123", "role": "call_agent"},
    {"name": "Sales 2", "email": "sales2@propello.ai", "password": "sales2123", "role": "call_agent"},
]

# Krishna group staff accounts.
#   - krishna-group    : full admin access; its dashboard shows only the sales-team
#                        working set (assigned leads + agent-marked hot/warm/cold),
#                        never the full ~2500 lead database.
#   - reception-krishna: limited role — dashboard only, no other pages.
DEFAULT_STAFF_ACCOUNTS = [
    {"name": "Krishna Group", "email": "krishna-group@propelloai", "password": "krishna123", "role": "admin"},
    {"name": "Reception Krishna", "email": "reception-krishna@propelloai", "password": "reception123", "role": "reception"},
]


async def seed_default_agents():
    """Create the standard call-agent + Krishna staff accounts if missing."""
    from sqlalchemy import select
    from app.models.agent import Agent
    from app.core.security import hash_password

    created = 0
    # Commit each account independently so one failure (e.g. an unexpected role
    # value) can never roll back or block the others.
    for spec in DEFAULT_CALL_AGENTS + DEFAULT_STAFF_ACCOUNTS:
        try:
            async with AsyncSessionLocal() as session:
                existing = await session.execute(select(Agent).where(Agent.email == spec["email"]))
                if existing.scalar_one_or_none():
                    continue
                session.add(Agent(
                    name=spec["name"],
                    email=spec["email"],
                    password_hash=hash_password(spec["password"]),
                    role=spec["role"],
                ))
                await session.commit()
                created += 1
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("Could not seed account %s: %s", spec["email"], e)
    return created
