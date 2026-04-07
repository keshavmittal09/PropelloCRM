# PropelloCRM

PropelloCRM is a production CRM platform for real-estate sales teams. It combines lead management, automated follow-ups, team workflows, and analytics in a single system.

## Status

- Frontend: deployed on Vercel
- Backend: deployed on Render
- Database: Supabase PostgreSQL

## Key Features

- Lead pipeline with board and detail views
- Contact, task, visit, and activity management
- Automated follow-ups (+15 minute workflow)
- Notification center for lead/task/visit updates
- Role-based authentication and JWT session handling
- Analytics for funnel, source performance, and agent activity

## Tech Stack

- Frontend: Next.js 14, React, Tailwind CSS
- Backend: FastAPI, SQLAlchemy (async), APScheduler
- Database: Supabase PostgreSQL
- Messaging: WATI (primary) with Twilio fallback
- Email: SendGrid integration path

## Repository Structure

- [frontend](frontend): web application
- [backend](backend): API, business logic, jobs, and models
- [docs/images](docs/images): architecture and product visuals

## Operator Documentation

- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
- [backend/README.md](backend/README.md)
- [frontend/README.md](frontend/README.md)

## API Entry Points

- Auth: `/api/auth/*`
- Leads: `/api/leads/*`
- Contacts: `/api/contacts/*`
- Tasks: `/api/tasks/*`
- Visits: `/api/visits/*`
- Analytics: `/api/analytics/*`

## Development

Run services from their respective folders:

- Frontend: `npm run dev` in [frontend](frontend)
- Backend: `uvicorn app.main:app --reload` in [backend](backend)

## Notes

- Production expects PostgreSQL (`postgresql+asyncpg://`), not SQLite.
- Configure environment variables in Vercel and Render before deployment.
