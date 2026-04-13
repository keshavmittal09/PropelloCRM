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
