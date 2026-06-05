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
    "pool_recycle": 1800,
    "pool_pre_ping": True,
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

            # Feature 1-3: new columns on tasks and leads
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_remark TEXT"))
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_tags JSONB"))
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
