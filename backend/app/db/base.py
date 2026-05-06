from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings


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

            # Bulk Task Ingest tables (additive — safe for production)
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS bulk_task_ingests (
                    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
                    batch_name VARCHAR(200) NOT NULL,
                    file_name VARCHAR(255),
                    uploaded_by VARCHAR REFERENCES agents(id),
                    total_records INTEGER DEFAULT 0,
                    hot_count INTEGER DEFAULT 0,
                    warm_count INTEGER DEFAULT 0,
                    cold_count INTEGER DEFAULT 0,
                    created_leads INTEGER DEFAULT 0,
                    created_tasks INTEGER DEFAULT 0,
                    skipped_records INTEGER DEFAULT 0,
                    failed_records INTEGER DEFAULT 0,
                    caller_names JSONB,
                    status VARCHAR(32) DEFAULT 'processing',
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_bulk_task_ingests_batch_name ON bulk_task_ingests (batch_name)"))

            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS bulk_task_records (
                    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
                    ingest_id VARCHAR NOT NULL REFERENCES bulk_task_ingests(id) ON DELETE CASCADE,
                    caller_name VARCHAR(200),
                    name VARCHAR(200),
                    call_id VARCHAR(200),
                    phone_number VARCHAR(30),
                    transcript_url TEXT,
                    recording_url TEXT,
                    extracted_entities TEXT,
                    call_eval_tags VARCHAR(200),
                    summary TEXT,
                    call_conversation_quality TEXT,
                    call_dialing_at VARCHAR(100),
                    call_ringing_at VARCHAR(100),
                    user_picked_up VARCHAR(100),
                    call_status VARCHAR(100),
                    duration VARCHAR(100),
                    lead_heat_bucket VARCHAR(32),
                    lead_heat_reason TEXT,
                    contact_id VARCHAR REFERENCES contacts(id),
                    lead_id VARCHAR REFERENCES leads(id) ON DELETE SET NULL,
                    task_id VARCHAR REFERENCES tasks(id) ON DELETE SET NULL,
                    assigned_to VARCHAR REFERENCES agents(id),
                    ingestion_status VARCHAR(32) DEFAULT 'pending',
                    extra_data JSONB,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_bulk_task_records_ingest_id ON bulk_task_records (ingest_id)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_bulk_task_records_call_id ON bulk_task_records (call_id)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_bulk_task_records_phone_number ON bulk_task_records (phone_number)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_bulk_task_records_lead_heat_bucket ON bulk_task_records (lead_heat_bucket)"))

