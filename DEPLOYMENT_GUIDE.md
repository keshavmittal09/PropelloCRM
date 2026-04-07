# PropelloCRM Deployment Guide (Maintainer Only)

This guide is for project owners/operators, not end users.

## Scope

- Deploy backend on Render.
- Deploy frontend on Vercel.
- Run on Supabase PostgreSQL in production.
- Validate go-live quality and data integrity.
- Excludes chatbot deployment by design.

## 1. Prerequisites

1. GitHub repository access with latest code pushed.
2. Supabase project with database credentials.
3. Render account.
4. Vercel account.
5. WATI credentials.
6. Optional SendGrid credentials for email automation.

## 2. Production Environment Variables

## Backend (Render)

Required:

- DATABASE_URL
- SECRET_KEY
- FRONTEND_URL
- PRIYA_WEBHOOK_SECRET
- WATI_API_KEY
- WATI_BASE_URL
- WHATSAPP_DEFAULT_COUNTRY_CODE
- SENDGRID_API_KEY

Optional fallback:

- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_WHATSAPP_FROM

Notes:

- DATABASE_URL must start with postgresql+asyncpg://
- SQLite is blocked for production backend runtime.
- URL-encode special characters in DB password (example: @ -> %40)

## Frontend (Vercel)

Required:

- NEXT_PUBLIC_API_URL

Example:

- NEXT_PUBLIC_API_URL=https://your-backend-service.onrender.com

## 3. Supabase Setup

1. Open Supabase dashboard.
2. Copy Postgres connection URI.
3. Convert prefix to async SQLAlchemy format:

postgresql:// -> postgresql+asyncpg://

4. Use this value as DATABASE_URL in Render.
5. Confirm database is reachable from backend startup logs.

## 4. Backend Deployment (Render)

1. Create a new Web Service.
2. Connect repository.
3. Set Root Directory to backend.
4. Build command:

pip install -r requirements.txt

5. Start command:

gunicorn app.main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT --timeout 120

6. Add all backend env vars.
7. Deploy service.
8. Validate endpoints:

- GET /health
- GET /docs

## 5. Frontend Deployment (Vercel)

1. Import project in Vercel.
2. Set Root Directory to frontend.
3. Add NEXT_PUBLIC_API_URL.
4. Deploy.
5. Open app URL and validate login flow.

## 6. Production Wiring

1. Set backend FRONTEND_URL to final Vercel domain.
2. Redeploy backend after env update.
3. Verify browser requests and CORS behavior.

## 7. Database Initialization and Seed

Tables are initialized by backend startup via init_db.

Optional seed for initial users/data:

python seed.py

If migrating legacy local SQLite data:

python migrate_sqlite_to_supabase.py

## 8. Go-Live Smoke Tests

1. Login with valid credentials.
2. Create lead from UI.
3. Confirm records appear in Supabase public schema:

- contacts
- leads
- activities
- tasks
- followups

4. Change lead stage and verify timeline update.
5. Verify notification popup appears in frontend.
6. Wait for automated follow-up execution window and verify state update.
7. Trigger WhatsApp action and verify provider response.

## 9. Operational Checklist

1. Rotate secrets if previously exposed.
2. Enable service-level monitoring on Render.
3. Add domain mappings for frontend/backend.
4. Document env vars in password manager.
5. Keep backup/export strategy for Supabase.

## 10. Release Workflow

1. Use feature branches.
2. Validate frontend build and backend tests before merge.
3. Deploy backend first, frontend second.
4. Perform smoke tests after every production release.

## 11. Known Production Policies

1. Supabase PostgreSQL is single source of truth.
2. Do not use local SQLite in production.
3. Keep migration scripts owner-only and run intentionally.

## 12. Quick Rollback Plan

1. Revert to previous successful Git commit.
2. Redeploy backend service.
3. Redeploy frontend with previous env-validated build.
4. Re-run smoke tests.
