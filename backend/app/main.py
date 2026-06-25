from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import asyncio
from app.core.config import settings
from app.core.dependencies import get_current_user, get_db
from app.db.base import init_db, seed_default_agents
from app.jobs.scheduler import start_scheduler
from app.routers.auth import router as auth_router
from app.routers.leads import router as leads_router
from app.routers.webhooks import router as webhooks_router
from app.routers.ai import router as ai_router
from app.routers.campaign_dashboard import router as campaign_dashboard_router
from app.routers.campaigns import router as campaigns_router
from app.routers.projects import router as projects_router
from app.routers.priya_bridge import router as priya_router
from app.routers.whatsapp_chats import router as whatsapp_chats_router
from app.routers.me import router as me_router
from app.routers.routers import (
    contacts_router,
    properties_router,
    tasks_router,
    visits_router,
    analytics_router,
    notifications_router,
)
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Propello CRM API...")
    last_error = None
    for attempt in range(1, settings.DB_CONNECT_RETRIES + 1):
        try:
            await init_db()
            last_error = None
            break
        except Exception as e:
            last_error = e
            logger.warning(
                "Database connection attempt %s/%s failed: %s",
                attempt,
                settings.DB_CONNECT_RETRIES,
                e,
            )
            if attempt < settings.DB_CONNECT_RETRIES:
                await asyncio.sleep(settings.DB_CONNECT_RETRY_DELAY_SECONDS)

    if last_error:
        logger.error("Database initialization failed after retries. Exiting startup.")
        raise last_error

    try:
        created = await seed_default_agents()
        if created:
            logger.info("Seeded %s default call-agent account(s).", created)
    except Exception as e:
        logger.warning("Default agent seeding skipped: %s", e)

    start_scheduler()
    logger.info("Database initialized. Scheduler started.")
    yield
    logger.info("Shutting down Propello CRM API...")


# Create app with lifespan
app = FastAPI(
    title="Propello CRM API",
    description="Real Estate CRM powering Priya AI and the Propello sales team",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS Middleware - configured via environment
allowed_origins = [
    origin.strip() 
    for origin in settings.CORS_ORIGINS.split(",") 
    if origin.strip()
]
logger.info(f"CORS enabled for origins: {allowed_origins}")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global exception handler to ensure CORS headers are always returned
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> Response:
    logger.exception(f"Unhandled exception: {exc}")
    import traceback as _tb
    # TEMP DEBUG: include the last app frames so we can pinpoint greenlet origins.
    frames = [f"{fr.filename.split('/app/')[-1]}:{fr.lineno} {fr.name}"
              for fr in _tb.extract_tb(exc.__traceback__) if "/app/" in fr.filename]
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {str(exc)}", "where": frames[-6:]},
    )


@app.get("/health")
async def health():
    return {"status": "ok"}


# Register all routers (AFTER CORS middleware)
app.include_router(auth_router,          prefix="/api/auth",          tags=["Auth"])
app.include_router(leads_router,         prefix="/api/leads",         tags=["Leads"])
app.include_router(webhooks_router,      prefix="/api/webhooks",      tags=["Webhooks"])
app.include_router(ai_router,            prefix="/api/ai",            tags=["AI Engine"])
app.include_router(campaign_dashboard_router, prefix="/api/campaign", tags=["Campaign Dashboard"])
app.include_router(campaigns_router,     prefix="/api/campaigns",     tags=["Campaigns"])
app.include_router(projects_router,      prefix="/api/projects",      tags=["Projects"])
app.include_router(priya_router,         prefix="/api/priya",         tags=["Priya Bridge"])
app.include_router(contacts_router,      prefix="/api/contacts",      tags=["Contacts"])
app.include_router(properties_router,    prefix="/api/properties",    tags=["Properties"])
app.include_router(tasks_router,         prefix="/api/tasks",         tags=["Tasks"])
app.include_router(visits_router,        prefix="/api/visits",        tags=["Site Visits"])
app.include_router(analytics_router,     prefix="/api/analytics",     tags=["Analytics"])
app.include_router(notifications_router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(me_router,            prefix="/api/me",            tags=["My Data"])
app.include_router(whatsapp_chats_router, prefix="/api/whatsapp",     tags=["WhatsApp Chats"])


@app.post("/api/performance/recompute")
async def recompute_performance(
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    if current_user.role not in {"admin", "manager"}:
        raise HTTPException(status_code=403, detail="Admin/Manager only")

    from app.services.performance_service import compute_all_agents_performance

    result = await compute_all_agents_performance(db, days=30)
    return {"status": "ok", **result}


@app.get("/")
async def root():
    return {"status": "ok", "product": "Propello CRM", "version": "1.0.0"}


# Build marker to prove which code is actually running after a deploy.
@app.get("/api/_build")
async def build_marker():
    return {"build": "2026-06-25-debug-trace"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
