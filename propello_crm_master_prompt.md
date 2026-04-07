# Propello CRM — Master Product Specification Prompt

---

## SYSTEM CONTEXT

You are a senior full-stack engineer building a production-ready, industry-grade Real Estate CRM called **Propello CRM** from scratch. This CRM is the central nervous system for a real estate sales team. It receives leads from multiple sources (including an AI agent called Priya AI), manages the full sales pipeline, tracks agent activity, stores client history, and powers returning-caller memory for Priya AI.

This is not a prototype. Build everything as if it will handle real clients, real data, and real money. Code must be clean, modular, well-commented, and deployable.

---

## PRODUCT IDENTITY

- **Product name:** Propello CRM
- **Client:** Propello AI (run by Shardul Singh)
- **Purpose:** Centralized CRM for a real estate sales team that uses an AI voice/chat agent (Priya AI) as one of its lead channels
- **Users:** Admin (Shardul), Team Manager, Sales Agents
- **Devices:** Desktop + mobile responsive (no native app needed)
- **Auth:** Role-based auth (Admin / Manager / Agent) — JWT
- **Deployment target:** Backend on Render, Frontend on Vercel, Database on Supabase

---

## TECH STACK

### Backend
- **Framework:** FastAPI (Python 3.11+)
- **Database:** PostgreSQL via Supabase (free tier)
- **ORM:** SQLAlchemy 2.0 with async support
- **Migrations:** Alembic
- **Auth:** JWT (python-jose) + bcrypt password hashing
- **Background jobs:** APScheduler (for reminders, overdue task checks)
- **HTTP client:** httpx (for outbound webhooks to Priya / WhatsApp)
- **Env management:** python-dotenv
- **Server:** Uvicorn + Gunicorn

### Frontend
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS + shadcn/ui components
- **State management:** Zustand
- **Data fetching:** TanStack Query (React Query v5)
- **Drag and drop:** @dnd-kit/core (Kanban board)
- **Charts:** Recharts
- **Forms:** React Hook Form + Zod validation
- **HTTP:** Axios with interceptors
- **Notifications:** react-hot-toast

### Infrastructure
- **Backend deploy:** Render (free tier → paid)
- **Frontend deploy:** Vercel
- **Database:** Supabase (PostgreSQL)
- **File storage:** Supabase Storage (for documents, property images)
- **Environment secrets:** Render + Vercel env vars

---

## DATABASE SCHEMA

### Table: agents
Stores all CRM users (Admin, Manager, Agent). Auth lives here.
```
id              UUID PRIMARY KEY
name            VARCHAR(100)
email           VARCHAR(100) UNIQUE
password_hash   TEXT
role            ENUM('admin', 'manager', 'agent')
phone           VARCHAR(20)
is_active       BOOLEAN DEFAULT true
created_at      TIMESTAMP DEFAULT NOW()
```

### Table: contacts
People — buyers, sellers, brokers, investors.
```
id                  UUID PRIMARY KEY
name                VARCHAR(100)
phone               VARCHAR(20) UNIQUE   ← key identity field
email               VARCHAR(100)
type                ENUM('buyer','seller','broker','investor')
source              VARCHAR(50)          ← where they first came from
assigned_to         UUID → agents.id
tags                TEXT[]
personal_notes      TEXT                 ← "wife prefers ground floor, needs 2 parking"
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

### Table: properties
Real estate listings managed by the team.
```
id                  UUID PRIMARY KEY
title               VARCHAR(200)
description         TEXT
type                ENUM('apartment','villa','plot','commercial','office')
status              ENUM('available','sold','rented','under_negotiation')
transaction_type    ENUM('sale','rent','lease')
price               DECIMAL(15,2)
area_sqft           DECIMAL(10,2)
bedrooms            INT
bathrooms           INT
address             TEXT
city                VARCHAR(100)
locality            VARCHAR(100)
amenities           TEXT[]
media_urls          TEXT[]               ← Supabase Storage URLs
listed_by           UUID → agents.id
created_at          TIMESTAMP
```

### Table: leads
Central table. One row per lead. Heart of the CRM.
```
id                      UUID PRIMARY KEY
contact_id              UUID → contacts.id
source                  ENUM('priya_ai','website','facebook_ads','google_ads',
                              '99acres','magicbricks','walk_in','referral',
                              'email_campaign','manual')
stage                   ENUM('new','contacted','site_visit_scheduled',
                              'site_visit_done','negotiation','won','lost','nurture')
lead_score              ENUM('hot','warm','cold')
budget_min              DECIMAL(15,2)
budget_max              DECIMAL(15,2)
property_type_interest  VARCHAR(50)
location_preference     VARCHAR(200)
timeline                ENUM('immediate','1_month','3_months','6_months','exploring')
assigned_to             UUID → agents.id
interested_properties   UUID[]           ← array of property IDs shown
lost_reason             VARCHAR(200)     ← mandatory when stage=lost
days_in_stage           INT              ← computed, updated nightly
priority                ENUM('high','normal','low')
expected_close_date     DATE
last_contacted_at       TIMESTAMP
priya_memory_brief      TEXT             ← structured context fed back to Priya AI
call_count              INT DEFAULT 0
created_at              TIMESTAMP
updated_at              TIMESTAMP
```

### Table: activities
Immutable timeline log. Every touchpoint ever.
```
id              UUID PRIMARY KEY
lead_id         UUID → leads.id
contact_id      UUID → contacts.id
type            ENUM('call','whatsapp','email','site_visit','note',
                     'stage_change','priya_call','property_shown','task_completed')
title           VARCHAR(200)
description     TEXT
outcome         VARCHAR(100)     ← 'answered','voicemail','interested','not_interested'
performed_by    UUID → agents.id ← NULL if performed by Priya AI
performed_at    TIMESTAMP
meta            JSONB            ← flexible field: call duration, transcript summary, etc.
```

### Table: tasks
Follow-up items linked to leads.
```
id              UUID PRIMARY KEY
lead_id         UUID → leads.id
title           VARCHAR(200)
description     TEXT
task_type       ENUM('call','whatsapp','email','site_visit','document','other')
assigned_to     UUID → agents.id
due_at          TIMESTAMP
priority        ENUM('high','normal','low')
status          ENUM('pending','done','overdue','cancelled')
completed_at    TIMESTAMP
created_by      UUID → agents.id
created_at      TIMESTAMP
```

### Table: site_visits
Scheduled property visits — structured separately from activities.
```
id              UUID PRIMARY KEY
lead_id         UUID → leads.id
property_id     UUID → properties.id
scheduled_at    TIMESTAMP
agent_id        UUID → agents.id
status          ENUM('scheduled','done','cancelled','no_show')
client_confirmed BOOLEAN DEFAULT false
notes           TEXT
created_at      TIMESTAMP
```

### Table: notifications
In-app notification store.
```
id              UUID PRIMARY KEY
agent_id        UUID → agents.id
title           VARCHAR(200)
body            TEXT
type            ENUM('task_due','new_lead','stage_change','reminder','stale_lead')
is_read         BOOLEAN DEFAULT false
link            TEXT             ← /leads/{id} so clicking it navigates
created_at      TIMESTAMP
```

---

## API ENDPOINTS

### Auth
```
POST   /api/auth/login          → returns JWT token
POST   /api/auth/refresh        → refresh token
GET    /api/auth/me             → current agent profile
```

### Leads
```
GET    /api/leads               → list with filters (stage, source, score, agent, date)
POST   /api/leads               → create lead manually
GET    /api/leads/{id}          → single lead with full detail
PATCH  /api/leads/{id}          → update any field
DELETE /api/leads/{id}          → soft delete
PATCH  /api/leads/{id}/stage    → move stage (logs activity automatically)
GET    /api/leads/{id}/timeline → all activities for this lead
POST   /api/leads/{id}/note     → add a note (creates activity entry)
POST   /api/leads/{id}/call-log → log a call with outcome
POST   /api/leads/{id}/whatsapp → send WhatsApp template message
POST   /api/leads/inbound       → PUBLIC webhook — receives leads from all sources
GET    /api/leads/{id}/memory   → returns Priya memory brief for this phone number
GET    /api/leads/{id}/property-matches → returns matching properties from DB
```

### Contacts
```
GET    /api/contacts            → list with search
POST   /api/contacts            → create
GET    /api/contacts/{id}       → detail with linked leads
PATCH  /api/contacts/{id}       → update
GET    /api/contacts/lookup/{phone} → find by phone (used by Priya)
```

### Properties
```
GET    /api/properties          → list with filters
POST   /api/properties          → create listing
GET    /api/properties/{id}     → detail
PATCH  /api/properties/{id}     → update
POST   /api/properties/import   → CSV bulk import
GET    /api/properties/match    → match properties to a lead's requirements
```

### Tasks
```
GET    /api/tasks               → list (filterable by agent, status, due_date)
POST   /api/tasks               → create task on a lead
PATCH  /api/tasks/{id}          → update
PATCH  /api/tasks/{id}/complete → mark done
GET    /api/tasks/today         → today's tasks for current agent
GET    /api/tasks/overdue       → overdue tasks across team (manager view)
```

### Site Visits
```
GET    /api/visits              → list all visits (calendar feed)
POST   /api/visits              → schedule a visit
PATCH  /api/visits/{id}         → update status
POST   /api/visits/{id}/confirm → send WhatsApp confirmation to client
```

### Analytics
```
GET    /api/analytics/summary         → total leads, won, pipeline value (with date range)
GET    /api/analytics/funnel          → count per stage
GET    /api/analytics/by-source       → leads + conversion rate grouped by source
GET    /api/analytics/agent-performance → per-agent stats (leads, won, tasks done)
GET    /api/analytics/velocity        → avg days per stage
GET    /api/analytics/activity-heatmap → hourly lead activity map
```

### Notifications
```
GET    /api/notifications        → unread notifications for current agent
PATCH  /api/notifications/read-all → mark all read
```

---

## LEAD INBOUND WEBHOOK — DETAILED SPEC

`POST /api/leads/inbound` is the single entry point for ALL external lead sources.

**Request body:**
```json
{
  "source": "priya_ai",
  "name": "Rahul Sharma",
  "phone": "9876543210",
  "email": "rahul@gmail.com",
  "budget_min": 5000000,
  "budget_max": 12000000,
  "property_type": "apartment",
  "location_preference": "Gurgaon Sector 56",
  "timeline": "3_months",
  "lead_score": "hot",
  "transcript_summary": "Client looking for 3BHK ready to move. Wife prefers low floor. Needs 2 parking.",
  "call_duration_seconds": 187,
  "raw_transcript": "..."
}
```

**What the endpoint does:**
1. Check if contact with this phone already exists
2. If yes → update lead score, log new activity, update memory brief, return existing lead ID
3. If no → create contact + lead, tag source, auto-assign to least-busy agent
4. Log activity entry (call/form submit/ad click — based on source)
5. Create automatic follow-up task ("Call {name} within 24 hours")
6. Fire in-app notification to assigned agent
7. Update `priya_memory_brief` field with structured context
8. Return lead ID + contact ID + is_returning_caller flag

---

## PRIYA AI MEMORY SYSTEM — DETAILED SPEC

When Priya AI starts a call, it hits:
`GET /api/contacts/lookup/{phone}`

Response includes `priya_memory_brief` — a ready-to-inject string:

```
RETURNING CLIENT — DO NOT ask for name, budget, or requirements again.

Client: Rahul Sharma | Called 3 times | Last call: 47 days ago
Budget: ₹80L–₹1.2Cr | Looking for: 3BHK, Gurgaon Sector 56–62, ready-to-move
Personal notes: Wife prefers ground floor or low rise. Needs 2 car parking. Son starting school next year — needs school nearby.
Properties shown: Godrej Meridien (liked but expensive), M3M Crown (visited, positive feedback)
Last outcome: Said needs 2 months to arrange funds. Was warm and engaged.
Pending commitment: Team was supposed to send DLF One Midtown brochure.
Current stage: Negotiation | Score: Hot

INSTRUCTIONS:
- Greet Rahul by name immediately
- Reference the last call naturally ("It's been a couple of months since we spoke")
- Ask if timeline or budget has changed
- Mention you have new listings in his range
- Remind him about the brochure that was pending
- Do NOT start from scratch — continue from where you left off
```

This brief is rebuilt automatically every time any agent logs a new activity, updates a note, or changes the lead stage.

---

## FRONTEND PAGES & COMPONENTS

### Pages
```
/                        → Dashboard (today's tasks, summary cards, activity feed)
/leads                   → Leads list (table view with filters)
/leads/board             → Kanban board (drag-and-drop pipeline)
/leads/[id]              → Lead detail (timeline, tasks, property matches, WhatsApp)
/contacts                → Contacts list
/contacts/[id]           → Contact detail with all linked leads
/properties              → Properties list with filters
/properties/[id]         → Property detail
/tasks                   → Full task manager view
/visits                  → Site visit calendar
/analytics               → Analytics dashboard
/settings                → Agent management, pipeline stage config (admin only)
```

### Key Components
```
KanbanBoard              → drag-and-drop with @dnd-kit, columns per stage
LeadCard                 → shows name, phone, score badge, source tag, days-in-stage indicator
LeadTimeline             → chronological activity log with icons per type
PropertyMatchPanel       → auto-matched listings shown on lead detail
QuickCallLog             → one-click call outcome logger
WhatsAppSender           → template picker + send button
TaskWidget               → today's tasks on dashboard
StatsCard                → metric display with trend arrow
FunnelChart              → Recharts funnel showing stage distribution
SourcePieChart           → leads by source breakdown
AgentLeaderboard         → performance table
NotificationBell         → unread count + dropdown
SiteVisitScheduler       → date/time picker that sends WhatsApp confirmation
DuplicateAlert           → banner when inbound lead matches existing phone
```

---

## BUSINESS LOGIC RULES

### Lead scoring auto-rules
- Budget > ₹1Cr AND timeline = "immediate" → Hot
- Timeline = "1_month" OR source = "priya_ai" (voice) → Warm
- Source = "website" form only, no call → Warm
- No response after 2 contacts → Cold

### Auto-assignment
- New lead assigned to agent with fewest active leads
- If tie → assigned to agent who was assigned longest ago
- Admin can manually reassign at any time

### Duplicate detection
- Match on phone number (exact) — primary
- Match on email (exact) — secondary
- If duplicate found: merge incoming data into existing record, log "Duplicate lead received from {source} — merged" as activity. Never create two records for same phone.

### Stale lead detection (runs nightly via APScheduler)
- Lead in same stage for 3+ days with no activity → mark `priority = high`, send notification to agent
- Lead in same stage for 7+ days → send notification to manager
- Update `days_in_stage` counter for all leads nightly

### Days-in-stage indicator (shown on Kanban card)
- 0–2 days → green
- 3–5 days → amber
- 6+ days → red

### Lost lead mandatory reason
- Stage change to "lost" requires `lost_reason` field
- Options: Budget too low / Went to competitor / Not responding / Not ready / Location mismatch / Other

### Task auto-creation
- New lead created → auto-task: "First contact — call within 24 hours" (High priority)
- Stage moved to "site_visit_scheduled" → auto-task: "Send visit confirmation on WhatsApp"
- Stage moved to "site_visit_done" → auto-task: "Follow up on feedback within 48 hours"
- Lead marked Lost → auto-task: "Schedule re-engagement in 60 days" (moved to nurture)

### Re-engagement queue
- Leads in "nurture" stage surface in a separate list
- Sorted by days since last contact
- Agent sees suggested WhatsApp message pre-filled

---

## WHATSAPP INTEGRATION

Uses Twilio or WATI API. Templates stored in DB, agent picks one, system fills variables.

Templates:
- `site_visit_confirmation` → "Hi {name}, your site visit for {property} is confirmed for {date} at {time}. Our agent {agent_name} will meet you there."
- `follow_up` → "Hi {name}, this is {agent_name} from Propello. Just checking in — have you had a chance to think about the properties we discussed?"
- `new_listing_alert` → "Hi {name}, a new {property_type} just listed in {location} at ₹{price}. Matches your requirements. Shall I share details?"
- `brochure_send` → "Hi {name}, as promised here's the brochure for {property_name}: {link}"

Every send is logged as an activity automatically.

---

## DEPLOYMENT ARCHITECTURE

```
Vercel (Frontend)
  Next.js 14 — crm.propello.ai

Render (Backend)
  FastAPI + Uvicorn — api.propello.ai
  APScheduler (runs inside same process for nightly jobs)

Supabase
  PostgreSQL database
  Storage bucket (property images, KYC documents)

External Services
  Twilio / WATI → WhatsApp messaging
  SMTP (SendGrid) → email notifications
```

### Environment variables (Backend)
```
DATABASE_URL=postgresql+asyncpg://...supabase...
SECRET_KEY=...
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
SENDGRID_API_KEY=...
PRIYA_WEBHOOK_SECRET=...
SUPABASE_URL=...
SUPABASE_KEY=...
```

### Environment variables (Frontend)
```
NEXT_PUBLIC_API_URL=https://api.propello.ai
NEXT_PUBLIC_APP_NAME=Propello CRM
```

---

## FOLDER STRUCTURE

### Backend
```
propello-crm-backend/
├── app/
│   ├── main.py                   ← FastAPI app, CORS, router registration
│   ├── core/
│   │   ├── config.py             ← Settings from env vars
│   │   ├── security.py           ← JWT creation, verification, password hashing
│   │   └── dependencies.py       ← get_db, get_current_user, require_role
│   ├── db/
│   │   ├── base.py               ← SQLAlchemy async engine + session
│   │   └── init_db.py            ← create tables on startup
│   ├── models/
│   │   ├── agent.py
│   │   ├── contact.py
│   │   ├── lead.py
│   │   ├── property.py
│   │   ├── activity.py
│   │   ├── task.py
│   │   ├── site_visit.py
│   │   └── notification.py
│   ├── schemas/
│   │   ├── lead.py               ← LeadCreate, LeadUpdate, LeadResponse, InboundLead
│   │   ├── contact.py
│   │   ├── property.py
│   │   ├── task.py
│   │   ├── activity.py
│   │   ├── analytics.py
│   │   └── auth.py
│   ├── routers/
│   │   ├── auth.py
│   │   ├── leads.py
│   │   ├── contacts.py
│   │   ├── properties.py
│   │   ├── tasks.py
│   │   ├── visits.py
│   │   ├── analytics.py
│   │   └── notifications.py
│   ├── services/
│   │   ├── lead_service.py       ← dedup, auto-assign, scoring, memory brief builder
│   │   ├── memory_service.py     ← builds priya_memory_brief from lead history
│   │   ├── notification_service.py
│   │   ├── whatsapp_service.py
│   │   ├── property_match_service.py
│   │   └── analytics_service.py
│   └── jobs/
│       └── scheduler.py          ← APScheduler: nightly stale check, days_in_stage update
├── alembic/                      ← DB migrations
├── requirements.txt
├── Dockerfile
└── .env
```

### Frontend
```
propello-crm-frontend/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                  ← Dashboard
│   ├── leads/
│   │   ├── page.tsx              ← Lead list (table)
│   │   ├── board/page.tsx        ← Kanban
│   │   └── [id]/page.tsx         ← Lead detail
│   ├── contacts/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   ├── properties/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   ├── tasks/page.tsx
│   ├── visits/page.tsx
│   ├── analytics/page.tsx
│   └── settings/page.tsx
├── components/
│   ├── leads/
│   │   ├── KanbanBoard.tsx
│   │   ├── KanbanColumn.tsx
│   │   ├── LeadCard.tsx
│   │   ├── LeadTimeline.tsx
│   │   ├── LeadDetailPanel.tsx
│   │   ├── QuickCallLog.tsx
│   │   ├── WhatsAppSender.tsx
│   │   └── PropertyMatchPanel.tsx
│   ├── dashboard/
│   │   ├── StatsCard.tsx
│   │   ├── TaskWidget.tsx
│   │   ├── ActivityFeed.tsx
│   │   └── SourceChart.tsx
│   ├── analytics/
│   │   ├── FunnelChart.tsx
│   │   ├── AgentLeaderboard.tsx
│   │   └── HeatmapChart.tsx
│   └── shared/
│       ├── Sidebar.tsx
│       ├── NotificationBell.tsx
│       ├── DuplicateAlert.tsx
│       ├── ScoreBadge.tsx
│       ├── SourceTag.tsx
│       └── DaysInStageIndicator.tsx
├── lib/
│   ├── api.ts                    ← Axios instance with JWT interceptor
│   ├── types.ts                  ← TypeScript interfaces matching backend schemas
│   └── utils.ts
├── store/
│   ├── useLeadStore.ts           ← Zustand
│   └── useNotificationStore.ts
└── hooks/
    ├── useLeads.ts               ← React Query hooks
    ├── useTasks.ts
    └── useAnalytics.ts
```

---

## BUILD ORDER (Phase by Phase)

### Phase 0 — Project setup (Day 1)
- Create Supabase project, get DB connection string
- Init FastAPI project, install all dependencies
- Init Next.js 14 project with TypeScript + Tailwind + shadcn/ui
- Set up GitHub repos (separate backend + frontend)
- Configure Render (backend) and Vercel (frontend) deployments
- Set all env vars in both platforms
- Verify end-to-end: Next.js can reach FastAPI, FastAPI can reach Supabase

### Phase 1 — Database + Core API (Days 2–4)
- Write all SQLAlchemy models
- Run Alembic migrations → all tables created in Supabase
- Build Auth endpoints (login, me, refresh)
- Build `/api/leads/inbound` webhook — the most critical endpoint
- Build lead CRUD endpoints
- Test with Postman / curl

### Phase 2 — Kanban Board (Days 5–7)
- Build leads list API with full filtering
- Build Kanban board in Next.js with @dnd-kit
- Drag card → PATCH /api/leads/{id}/stage → activity logged → board updates
- Implement LeadCard with score badge, source tag, days-in-stage indicator
- Mobile responsive layout

### Phase 3 — Lead Detail + Timeline (Days 8–10)
- Build activity endpoints
- Build lead detail page — full timeline, all fields
- Quick call log modal
- Add note modal
- Property match panel (property_match_service queries by budget + type + location)

### Phase 4 — Tasks Module (Days 11–12)
- Build task CRUD endpoints
- Auto-task creation on stage changes
- Today's tasks widget on dashboard
- Overdue task detection via APScheduler

### Phase 5 — Contacts + Properties (Days 13–15)
- Contacts CRUD + phone lookup endpoint
- Properties CRUD + CSV bulk import
- Link properties to leads
- Property detail page with interested buyers list

### Phase 6 — Priya Memory System (Days 16–17)
- Build memory_service.py — assembles priya_memory_brief from all activities
- Auto-rebuild brief on every activity log
- Test: call lookup endpoint with returning phone number → get full memory brief
- Connect to Priya AI backend (single GET call before every Vapi call)

### Phase 7 — WhatsApp Integration (Days 18–19)
- Build whatsapp_service.py with Twilio
- Template management
- WhatsApp sender component on lead detail page
- Every send auto-logged as activity

### Phase 8 — Analytics Dashboard (Days 20–22)
- Build all analytics endpoints
- Pipeline funnel chart (Recharts)
- Source breakdown pie chart
- Agent performance table
- Lead velocity chart
- Activity heatmap

### Phase 9 — Site Visit Scheduler (Days 23–24)
- Site visit CRUD
- Date/time picker UI
- WhatsApp confirmation trigger on schedule
- Calendar view page

### Phase 10 — Notifications + Polish (Days 25–27)
- In-app notification system
- Browser push notifications
- Stale lead nightly job (APScheduler)
- Duplicate detection on inbound webhook
- Re-engagement queue page
- Mobile responsiveness audit across all pages

### Phase 11 — Lead Source Integrations (Days 28–30)
- Website Web-to-Lead form → POST to /api/leads/inbound
- n8n workflow for Facebook/Google ads → POST to /api/leads/inbound
- n8n Gmail trigger for 99acres/MagicBricks emails → parse + POST
- Test all sources end-to-end

### Phase 12 — Deploy + QA (Days 31–35)
- Full deploy to Render + Vercel + Supabase
- End-to-end testing of all flows
- Performance audit (index all FK columns in DB)
- Error handling audit (all endpoints return proper HTTP codes)
- Mobile testing on real devices
- Demo walkthrough preparation for Shardul

---

## CORE INVARIANTS (never break these)

1. Every lead has exactly one contact — no orphan leads
2. Every inbound lead checks for duplicate phone before creating a new record
3. Every stage change is logged as an activity — always, no exceptions
4. priya_memory_brief is rebuilt every time a new activity is logged
5. Tasks are never deleted — only cancelled (audit trail must be complete)
6. Lost leads always have a lost_reason — enforce at API level
7. All timestamps stored in UTC, displayed in IST on frontend
8. No PII in logs — mask phone numbers in server logs

---

## WHAT SUCCESS LOOKS LIKE

A lead comes in from any of the 6 sources → appears on Kanban board in under 2 seconds → agent gets a notification → agent opens lead detail and sees all info extracted by Priya AI → agent calls client → logs the outcome in one click → CRM auto-creates the next follow-up task → client calls Priya AI 3 months later → Priya greets them by name and continues from where they left off → manager opens analytics dashboard and sees which channels are converting → Shardul sees the whole team operating in one place.

That is Propello CRM.
