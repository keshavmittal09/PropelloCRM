from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.config import settings
from app.db.base import init_db
from app.jobs.scheduler import start_scheduler
from app.routers.auth import router as auth_router
from app.routers.leads import router as leads_router
from app.routers.webhooks import router as webhooks_router
from app.routers.ai import router as ai_router
from app.routers.priya_bridge import router as priya_router
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
    # Startup
    logger.info("Starting Propello CRM API...")
    await init_db()
    start_scheduler()
    logger.info("Database initialized. Scheduler started.")
    yield
    # Shutdown
    logger.info("Shutting down Propello CRM API...")


app = FastAPI(
    title="Propello CRM API",
    description="Real Estate CRM powering Priya AI and the Propello sales team",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS — allow Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register all routers
app.include_router(auth_router,          prefix="/api/auth",          tags=["Auth"])
app.include_router(leads_router,         prefix="/api/leads",         tags=["Leads"])
app.include_router(webhooks_router,      prefix="/api/webhooks",      tags=["Webhooks"])
app.include_router(ai_router,            prefix="/api/ai",            tags=["AI Engine"])
app.include_router(priya_router,         prefix="/api/priya",         tags=["Priya Bridge"])
app.include_router(contacts_router,      prefix="/api/contacts",      tags=["Contacts"])
app.include_router(properties_router,    prefix="/api/properties",    tags=["Properties"])
app.include_router(tasks_router,         prefix="/api/tasks",         tags=["Tasks"])
app.include_router(visits_router,        prefix="/api/visits",        tags=["Site Visits"])
app.include_router(analytics_router,     prefix="/api/analytics",     tags=["Analytics"])
app.include_router(notifications_router, prefix="/api/notifications", tags=["Notifications"])


@app.get("/")
async def root():
    return {"status": "ok", "product": "Propello CRM", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
