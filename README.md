# PropelloCRM

PropelloCRM is a production-ready CRM tailored for real-estate sales teams. It provides lead ingestion and processing, a pipeline (kanban) interface, campaign ingestion and analysis, tasks and visits, agent performance tracking, automated follow-ups, multi-channel notifications (WhatsApp/email/in-app), and analytics.

This README reflects the current codebase (backend and frontend) and includes quickstart steps, environment variables, deployment notes, and known caveats.

**Contents**
- **Overview** — What the system is and core responsibilities.
- **Architecture** — Backend and frontend responsibilities and key files.
- **Quickstart (developer)** — install, env, run commands for local dev.
- **Environment variables** — required and important optional settings.
- **Deployment notes** — Vercel / Render / Supabase guidance.
- **Known issues & runtime caveats** — important behavioral notes.
- **Where to look in the code** — quick file map for maintainers.

**Overview**

PropelloCRM combines:
- Inbound lead ingestion (webhooks, Priya AI, campaign uploads) and duplicate handling
- Lead lifecycle (stages, scoring, priority, assignment, notes, call/log activities)
- Kanban board and paginated lead listing
- Campaign processing and a call-campaign dashboard (batch upload → analysis → assignment)
- Tasks, site visits, and task-completion workflows (including AI remark scoring)
- Notifications and broadcasts (in-app, WhatsApp via WATI/Twilio fallback, email via SendGrid)
- Role-aware UI and APIs: `admin`, `manager`, `agent`, `call_agent` scopes

**Architecture (high level)**

- Backend: FastAPI + async SQLAlchemy + APScheduler. Main app: [backend/app/main.py](backend/app/main.py).
- Database: PostgreSQL (Supabase-friendly). SQLAlchemy models in [backend/app/models](backend/app/models).
- Frontend: Next.js 14 (App Router), React, Tailwind, TanStack Query, Zustand. App entry: [frontend/app/layout.tsx](frontend/app/layout.tsx).
- API client: [frontend/lib/api.ts](frontend/lib/api.ts) — this maps to nearly all server routes.

Core runtime responsibilities are split across routers and service layers in `backend/app/routers` and `backend/app/services`.

**Quickstart — Developer (local)**

Prerequisites
- Node 18+ and npm
- Python 3.11 or 3.12 (recommended; building some wheel packages fails on 3.13 on Windows without MSVC/Rust)
- PostgreSQL (or a Supabase project)

1) Backend: create a virtualenv and install

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

2) Create a `.env` in `backend/` (see `backend/.env.example`) and set at minimum:
- `DATABASE_URL` (must start with `postgresql+asyncpg://`)
- `SECRET_KEY`
- `FRONTEND_URL`

3) Run backend locally

```powershell
# from repository root
Set-Location backend
uvicorn app.main:app --reload --port 8000
```

4) Frontend: install and run

```bash
cd frontend
npm install
npm run dev
```

Open the app at `http://localhost:3000` and the API at `http://localhost:8000`.

**Environment variables (summary)**

Required (minimum for local dev)
- `DATABASE_URL` — Example: `postgresql+asyncpg://user:pass@host:5432/dbname` (SQLite not supported)
- `SECRET_KEY` — JWT signing key
- `FRONTEND_URL` — frontend origin for CORS

Important automation / integrations
- `WATI_API_KEY`, `WATI_BASE_URL` — primary WhatsApp
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` — Twilio fallback
- `SENDGRID_API_KEY` — optional email transport
- `PRIYA_WEBHOOK_SECRET`, `CAMPAIGN_WEBHOOK_SECRET` — webhook secrets

Other toggles and settings live in [backend/app/core/config.py](backend/app/core/config.py).

**Run & build commands**

Backend (dev):
```powershell
uvicorn app.main:app --reload --port 8000
```

Backend (production example):
```bash
gunicorn app.main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT --timeout 120
```

Frontend (dev/build):
```bash
cd frontend
npm run dev
npm run build   # production build
npm run start   # run production build locally
```

**Deployment notes**

- Frontend is suitable for Vercel (App Router). Use `NEXT_PUBLIC_API_URL` to point to the deployed backend.
- Backend is set up for containerized deployments (Render, Docker). See [backend/Dockerfile](backend/Dockerfile) and [backend/render.yaml](backend/render.yaml).
- Database: use Supabase / managed PostgreSQL. Ensure `DATABASE_URL` uses the `postgresql+asyncpg://` scheme.

**Where to look in the code (quick links)**
- App bootstrap: [backend/app/main.py](backend/app/main.py)
- Router registry & grouped endpoints: [backend/app/routers/routers.py](backend/app/routers/routers.py)
- Lead domain & endpoints: [backend/app/models/lead.py](backend/app/models/lead.py), [backend/app/routers/leads.py](backend/app/routers/leads.py)
- Tasks & notifications: [backend/app/models/models.py](backend/app/models/models.py), [backend/app/routers/routers.py](backend/app/routers/routers.py)
- Campaign ingestion + analysis: [backend/app/routers/campaigns.py](backend/app/routers/campaigns.py), [backend/app/services/campaign_service.py](backend/app/services/campaign_service.py)
- Frontend app shell & dashboard: [frontend/app/page.tsx](frontend/app/page.tsx), [frontend/components/shared/Sidebar.tsx](frontend/components/shared/Sidebar.tsx)
- Frontend API client: [frontend/lib/api.ts](frontend/lib/api.ts)

**Known issues & runtime caveats (observed during review)**

- TypeScript deprecation warnings: `tsconfig.json` contains `moduleResolution: "node"` and `baseUrl` settings that trigger deprecation warnings for future TypeScript versions. Not a current build blocker, but plan upgrades carefully. (See `frontend/tsconfig.json`.)
- Windows + Python 3.13 build issues: some backend dependencies (notably `asyncpg` and `pydantic-core`) may fail to install on Windows Python 3.13 without MSVC build tools and Rust toolchain. Recommend using Python 3.11 or 3.12 for local development on Windows.
- Timezone handling: application normalizes datetimes to timezone-naive UTC before DB writes for tasks and notifications. Keep client timestamps consistent (send ISO strings without offset or ensure server-side normalization). See task handling code in [backend/app/routers/routers.py](backend/app/routers/routers.py).
- DB scheme & migrations: Alembic is present but make sure migrations are used when evolving models (there are `alembic/versions/*` files). Use `alembic` for production schema upgrades.
- README / docs mismatch: the previous root README was out of date — this file is now intended to reflect the codebase.

**Recommended next maintenance items (suggested issues)**

- Refresh `frontend/tsconfig.json` to remove deprecated options or include `"ignoreDeprecations": "6.0"` to suppress the TypeScript 7.0 migration warning.
- Add an integration test or CI job to run `python -m compileall backend/app` and `npm run build` so regressions are caught in CI.
- Add a simple `Makefile` or top-level dev script to standardize dev commands for contributors.
- Document the expected Python version and Dockerbase image used for Render in `DEPLOYMENT_GUIDE.md`.

---

If you'd like, I can (pick one):

- Draft a PR with this README and a small CI config to run the build checks (recommended),
- Produce a detailed actionable issues list in Markdown/JSON that you can import into a tracker,
- Or update `DEPLOYMENT_GUIDE.md` and `backend/README.md` with step-by-step production deployment recipes.

Next step: I can now create the updated README commit/PR or generate the issues list — tell me which.

