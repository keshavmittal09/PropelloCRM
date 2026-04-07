# PropelloCRM Backend

High-performance FastAPI backend powering lead ingestion, pipeline orchestration, automation scheduling, notifications, analytics, and communication workflows.

## Core Responsibilities

- Authentication and role-aware authorization.
- Lead lifecycle APIs and timeline tracking.
- Follow-up orchestration and scheduler jobs.
- Analytics aggregation and funnel visibility.
- WhatsApp and email workflow integration.
- Supabase PostgreSQL persistence and query layer.

## Key Modules

- app/main.py: Application bootstrap, router registration, startup lifecycle.
- app/core: Settings, dependencies, security primitives.
- app/db: SQLAlchemy engine/session setup and table initialization.
- app/models: ORM entities for CRM domain.
- app/routers: API endpoints for auth, leads, tasks, visits, analytics, notifications.
- app/services: Business logic for lead processing, messaging, and AI support.
- app/jobs: APScheduler periodic jobs.

## Production Requirements

- Python 3.10+
- Supabase PostgreSQL URL in async format.
- SECRET_KEY for JWT signing.
- WATI credentials for WhatsApp transport.
- Optional SendGrid API key for email automation.

## Environment Variables

Required:

- DATABASE_URL
- SECRET_KEY
- FRONTEND_URL

Automation:

- WATI_API_KEY
- WATI_BASE_URL
- WHATSAPP_DEFAULT_COUNTRY_CODE
- SENDGRID_API_KEY

Optional fallback:

- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_WHATSAPP_FROM

## Local Run

1. Create virtual environment.
2. Install dependencies from requirements.txt.
3. Configure .env.
4. Run:

uvicorn app.main:app --reload --port 8000

## Production Run

gunicorn app.main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT --timeout 120

## Data Integrity and Migration

- Production storage is Supabase-first.
- Existing SQLite datasets can be migrated once using migrate_sqlite_to_supabase.py.
- init_db imports all models to ensure complete metadata creation.

## Scheduler Jobs

- Hourly and daily lifecycle maintenance.
- Frequent follow-up execution for near real-time automation.
- Stale lead detection and escalation flows.

## API Quality Notes

- DTOs implemented via Pydantic schemas.
- SQLAlchemy async sessions used across handlers.
- Clear service-layer separation for maintainability.

## Next Engineering Upgrades

- Alembic-driven schema evolution workflow.
- Better observability with structured logging and tracing IDs.
- Retry/backoff policies for external messaging providers.
- OpenAPI examples expansion for external integrators.
