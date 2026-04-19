# PROPELLO CRM — CAMPAIGN INGESTION MODULE
## Master Implementation Prompt

> **Purpose:** This document is a complete, self-contained prompt for an AI or developer to implement the Campaign Ingestion feature inside the existing Propello CRM (FastAPI backend + Next.js 14 frontend + Supabase/PostgreSQL).
> **Stack:** FastAPI · SQLAlchemy (async) · Pydantic v2 · Next.js 14 App Router · TypeScript · Tailwind · React Query · Zustand
> **Scope:** Do not touch anything outside of this feature unless explicitly stated. Priya.ai remains unchanged.

---

## 1. CONTEXT — WHAT THIS FEATURE IS AND WHY IT EXISTS

Propello AI runs outbound calling campaigns using an AI agent called **Niharika**. Niharika calls leads (e.g. prospects from a Credai Expo for a property called Krishna Aura) and has real conversations. After the campaign, the output is a structured file — CSV or JSON — containing every call's result.

Currently, that file is manually reviewed. The goal of this feature is: **upload the file → CRM automatically classifies every lead as Hot / Warm / Cold → correct stage and priority set → follow-up tasks created → agents see exactly who to action first, without reading a single row.**

Niharika runs on a **custom platform** (not Vapi or Bland.ai). The output format is either CSV or JSON depending on the campaign. Both must be supported.

---

## 2. THE EXACT CSV/JSON SCHEMA (source of truth)

Every campaign output file — regardless of format — contains these fields:

| Field | Type | Description |
|---|---|---|
| `call_id` | string | Unique identifier for the call (e.g. "outbound") |
| `name` | string | Lead's name — may be in Hindi or English (e.g. "अमीर", "Rahul Sharma") |
| `phone_number` | string | Phone with country code (e.g. "+919820991337") |
| `transcript` | string | Full call transcript with AGENT / USER turns |
| `recording_url` | string | Direct URL to the audio recording file |
| `extracted_entities` | string | JSON string of entities Niharika extracted — may be empty, null, or malformed. **Treat as optional/unreliable. Never crash if missing.** |
| `call_eval_tag` | string | "Yes" or "No" — whether the call met its objective per Niharika's evaluation |
| `summary` | string | Plain English paragraph summarising what happened on the call |

**For JSON format**, the same fields appear as keys in each object in an array.
**For CSV format**, these are the column headers.

---

## 3. THE COMPLETE WORKFLOW (implement exactly as described)

```
User navigates to /campaigns in the CRM sidebar
        ↓
User types a Campaign Name (e.g. "Krishna Aura — Credai Expo April 2026")
        ↓
User uploads a CSV or JSON file
        ↓
System parses and validates the file
        ↓
System shows a PREVIEW TABLE of all extracted rows before import
(user can review and confirm)
        ↓
User clicks "Import and Classify"
        ↓
For each row in the file:
    ↓
    Normalise phone number (strip spaces, ensure +91 prefix for Indian numbers)
    ↓
    Look up phone_number AND name in the leads/contacts table
    ↓
    ┌─────────── LEAD EXISTS? ───────────┐
    │ YES                                │ NO
    ↓                                   ↓
    Update the existing lead:           Create a new lead:
    - Append new campaign activity      - name, phone, source = "Campaign — [campaign name]"
      to timeline (do NOT replace       - score = classified result
      existing timeline)                - stage = auto-set from score
    - Re-score based on latest call     - priority = auto-set from score
    - Update stage ONLY if new          - first activity = campaign call entry
      score pushes it FORWARD           - auto-task created
      (never backward)                  - agent notification if Hot
    - Add auto-task for follow-up
    │                                   │
    └──────────────┬─────────────────────┘
                   ↓
    Use transcript + summary + recording_url
    to classify the lead (see Section 4)
        ↓
    Store classification result
        ↓
After all rows processed:
Show Import Summary screen:
"X leads processed — Y Hot, Z Warm, W Cold — A new leads created, B existing leads updated"
        ↓
Show classified lead list sorted Hot → Warm → Cold
```

---

## 4. THE CLASSIFICATION ENGINE (implement this exactly)

The classifier reads the `summary` field primarily. The `transcript` is used as a fallback if the summary is ambiguous. `extracted_entities` is used only if present and valid JSON — never rely on it as primary source.

### HOT Signals — any one of these = Hot

- Explicit site visit confirmed, scheduled, or arranged
- "Pick-up arranged" / "family is coming" / "will come tomorrow"
- Asked for WhatsApp details to receive project brochure or pricing
- Discussed specific unit details: carpet area, BHK type, floor preference, loading percentage
- Down payment discussed or asked about
- Payment plan or home loan discussed
- `call_eval_tag` = "Yes" AND summary contains positive engagement language
- "Booked", "interested to book", "finalise", "confirm"

### WARM Signals — mixed intent = Warm

- "Could visit" / "might visit" / "will think about it" — willingness without commitment
- Expressed some interest but also hesitation or condition ("if price is right", "need to check with family")
- Referenced a previous positive interaction (Credai Expo, earlier call)
- Asked to call back at a later time / needs more time
- `call_eval_tag` = "Yes" but no concrete next step in summary

### COLD Signals — any one of these = Cold (unless overridden by a Hot signal)

- "Not interested" / "no interest" / "don't want"
- "Already bought" / "already invested elsewhere"
- "Budget too low" or budget clearly out of range
- Call ended with no next step and no positive signal
- Voicemail only / did not answer
- Asked to be removed / "don't call again"
- `call_eval_tag` = "No" AND summary shows no engagement

### Classification Priority Rule

If both Hot and Cold signals exist in the same summary → classify as **Warm** (mixed signals). Hot always overrides Cold if the hot signal is specific and concrete (e.g. actual visit arrangement).

### Auto-assignment Table Based on Classification

| Score | Stage Set To | Priority | Auto-task Created | Due In |
|---|---|---|---|---|
| Hot (visit mentioned) | `site_visit_scheduled` | High | "URGENT: Confirm tomorrow's site visit — reconfirm time and pick-up details" | 1 hour |
| Hot (no visit, general interest) | `negotiation` | High | "Hot lead — follow up within 1 hour" | 1 hour |
| Warm | `contacted` | Normal | "Follow-up call — invite for site visit" | 24 hours |
| Cold | `contacted` | Low | "Re-engage in 30 days" | 30 days |

### Notification Rule

For every **Hot** lead created or updated: fire an in-app notification to the assigned agent (or admin if unassigned): `"HOT LEAD: [Name] — [Campaign Name] — action required"`

---

## 5. PROJECT LINKING

- A **Project** in this CRM represents a real estate property (e.g. "Krishna Aura"). A project can have multiple campaigns under it.
- **One lead can belong to multiple projects.**
- At upload time, **no project linking is required from the user.** The user only provides the campaign name.
- After import, if a Project exists in the CRM whose name is contained in the campaign name (case-insensitive match), **auto-link the campaign to that project.**
  - Example: campaign name "Krishna Aura — Credai Expo April 2026" → matches project "Krishna Aura" → auto-link.
- If no match is found, the campaign sits unlinked. A manager can assign it to a project later from the Campaign detail page.
- Every lead created/updated from the campaign gets a **campaign tag** visible on their lead card.

### Project Module Requirements (add if not already present)

The Projects page must support:
1. Classify leads by project — a project page shows all leads tagged to it
2. Display leads on the project — list view with Hot/Warm/Cold badges
3. Edit or update project details — name, developer, location, BHK options, price range, brochure URL
4. Add/remove project tag on individual leads

---

## 6. DATABASE CHANGES REQUIRED

Add the following new tables. Do not modify existing tables except where explicitly stated.

### New Table: `campaigns`

```sql
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    project_id UUID REFERENCES projects(id),
    agent_name VARCHAR(100),
    total_calls INT DEFAULT 0,
    hot_count INT DEFAULT 0,
    warm_count INT DEFAULT 0,
    cold_count INT DEFAULT 0,
    new_leads_created INT DEFAULT 0,
    existing_leads_updated INT DEFAULT 0,
    uploaded_by UUID REFERENCES agents(id),
    created_at TIMESTAMP DEFAULT NOW()
);
```

### New Table: `projects` (if not already present)

```sql
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    developer VARCHAR(200),
    location VARCHAR(200),
    city VARCHAR(100),
    bhk_options TEXT[],
    price_range_min DECIMAL(15,2),
    price_range_max DECIMAL(15,2),
    brochure_url TEXT,
    status VARCHAR(30) CHECK (status IN ('active', 'completed', 'upcoming')),
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Modify existing `leads` table — add columns

```sql
ALTER TABLE leads ADD COLUMN campaign_id UUID REFERENCES campaigns(id);
ALTER TABLE leads ADD COLUMN project_ids UUID[];
```

### Modify existing `activities` table — add columns

```sql
ALTER TABLE activities ADD COLUMN campaign_id UUID REFERENCES campaigns(id);
ALTER TABLE activities ADD COLUMN recording_url TEXT;
ALTER TABLE activities ADD COLUMN transcript TEXT;
ALTER TABLE activities ADD COLUMN call_summary TEXT;
ALTER TABLE activities ADD COLUMN call_eval_tag VARCHAR(10);
```

---

## 7. BACKEND — FILES TO CREATE / MODIFY

### New file: `app/services/campaign_service.py`

Implement the following functions:

**`parse_campaign_file(file_content: bytes, filename: str) -> list[dict]`**
- Detects format from filename extension (.csv or .json)
- For CSV: use pandas or csv module, normalise column names (strip whitespace, lowercase)
- For JSON: parse array of objects
- Returns list of dicts with normalised keys matching the schema in Section 2
- Never crashes on missing/null fields — use `.get()` with defaults throughout

**`normalise_phone(phone: str) -> str`**
- Strip all spaces, dashes, parentheses
- If 10 digits and no country code, prepend +91
- Return consistent format: +919820991337

**`classify_lead(summary: str, transcript: str, call_eval_tag: str, extracted_entities: str) -> dict`**
- Implements the exact classification logic from Section 4
- Returns: `{"score": "hot"|"warm"|"cold", "stage": str, "priority": str, "task_title": str, "task_due_hours": int}`
- Uses keyword matching on `summary` first, `transcript` as fallback
- `extracted_entities` used only if valid parseable JSON
- Never raises an exception regardless of input quality

**`process_campaign_row(row: dict, campaign_id: str, db: Session) -> dict`**
- Calls `normalise_phone` and `classify_lead`
- Calls `find_existing_lead(phone, name, db)` for dedup
- If lead exists: updates summary/transcript/recording on existing activity log, re-scores, updates stage if forward-moving only, creates new activity entry, creates auto-task, fires notification if Hot
- If lead does not exist: creates new lead + contact, sets all classified fields, creates first activity entry, creates auto-task, fires notification if Hot
- Returns `{"action": "created"|"updated", "lead_id": str, "score": str}`

**`find_existing_lead(phone: str, name: str, db: Session) -> Lead | None`**
- Query by normalised phone number first (exact match)
- If no match, try fuzzy name match as secondary check (Levenshtein distance ≤ 2)
- Return the lead if found, None otherwise

**`auto_link_project(campaign_name: str, db: Session) -> str | None`**
- Query all projects, check if any project name is contained in the campaign name (case-insensitive)
- Return matching project_id or None

---

### New file: `app/routers/campaigns.py`

Implement these endpoints:

**`POST /api/campaigns/upload`**
- Accepts: `multipart/form-data` with fields: `file` (UploadFile), `campaign_name` (str), `agent_name` (str, optional, default "Niharika")
- Parses the file, returns preview data without writing to DB
- Response: `{"rows": [...parsed rows...], "total": int, "format_detected": "csv"|"json"}`

**`POST /api/campaigns/ingest`**
- Accepts: `{"campaign_name": str, "agent_name": str, "rows": [...]}`
- This is the confirmed-import endpoint called after user reviews preview
- Processes all rows using `process_campaign_row`
- Creates campaign record in `campaigns` table with final stats
- Runs `auto_link_project`
- Response: `{"campaign_id": str, "total": int, "hot": int, "warm": int, "cold": int, "created": int, "updated": int, "leads": [...]}`

**`POST /api/campaigns/ingest-single`** *(for future automation)*
- Accepts a single row as JSON (same fields as one CSV row) plus `campaign_name` and `agent_name`
- Processes it immediately
- Requires `X-Campaign-Secret` header validated against env var `CAMPAIGN_WEBHOOK_SECRET` — return 401 if missing or wrong
- Same response shape as a single-row version of the ingest endpoint

**`GET /api/campaigns`**
- Returns paginated list of all campaigns with stats
- Supports query params: `skip`, `limit`

**`GET /api/campaigns/{campaign_id}`**
- Returns campaign details + all leads from that campaign (with score, stage, name, phone)

---

### Modify: `app/main.py`

Register the new campaigns router:
```python
from app.routers.campaigns import router as campaigns_router
app.include_router(campaigns_router, prefix="/api/campaigns", tags=["Campaigns"])
```

---

## 8. FRONTEND — FILES TO CREATE / MODIFY

### New file: `app/campaigns/page.tsx`

**This page has three states:**

**State 1 — Upload Screen (default)**
- Campaign Name input field (required, text)
- Agent Name input field (optional, default "Niharika")
- Drag-and-drop file upload zone — accepts .csv and .json only
- Visual indication of accepted formats
- On file select + name entered → call `POST /api/campaigns/upload` → transition to State 2

**State 2 — Preview Screen**
- Shows a scrollable table of all parsed rows: Name | Phone | Summary (truncated to 80 chars) | Call Eval Tag
- Shows row count: "X rows detected from [filename]"
- "Back" button to re-upload
- "Import and Classify X Leads" primary button → call `POST /api/campaigns/ingest` → transition to State 3
- Show loading state during import with message "Classifying leads..."

**State 3 — Results Screen**
- Summary banner: "X leads processed — Y Hot · Z Warm · W Cold — A new · B updated"
- Colour-coded counts: Hot = red, Warm = amber, Cold = blue/grey
- Table of all processed leads sorted Hot first, then Warm, then Cold
- Each row shows: Score badge | Name | Phone | Summary snippet | Stage | Action (link to lead card)
- "View All Leads" button → navigates to /leads?source=campaign&campaign_id=[id]
- "Import Another Campaign" button → resets to State 1

---

### New file: `app/campaigns/[id]/page.tsx`

Campaign detail page showing:
- Campaign name, agent name, date, linked project (if any)
- Stats: total calls, Hot/Warm/Cold counts, new vs updated
- Full lead list from this campaign with score badges and links to lead detail pages
- "Assign to Project" dropdown if not yet linked to a project

---

### Modify: `components/shared/Sidebar.tsx`

Add "📣 Campaigns" nav item linking to /campaigns. Position it after "Leads" in the nav order.

---

### Modify: `components/leads/LeadComponents.tsx` — Timeline component

The timeline already renders activity entries. Extend it so that when an activity has `type = "campaign_call"`:
- Show a distinct visual style (purple/indigo badge labelled "Campaign Call")
- Show the `call_summary` field as the main description text
- Show a playable audio element if `recording_url` is present:
  ```tsx
  <audio controls src={activity.recording_url} className="w-full mt-2 h-8" />
  ```
- Show a collapsible "View Transcript" section that expands to show the full `transcript` (truncate at 2,000 chars with "Show more" if longer)
- Show `call_eval_tag` as a small badge: "Objective Met ✓" in green, or "Objective Not Met ✗" in red
- Show campaign name as a small tag: "📣 [campaign name truncated to 20 chars]"

---

### Modify: `components/leads/KanbanBoard.tsx` and `LeadCard.tsx`

Lead cards should show a campaign tag if `campaign_id` is set: small badge "📣 [campaign name, max 20 chars]"

---

### Modify: `lib/api.ts`

Add these API functions:
```typescript
uploadCampaignPreview(file: File, campaignName: string, agentName: string): Promise<CampaignPreview>
ingestCampaign(payload: CampaignIngestPayload): Promise<CampaignResult>
getCampaigns(skip?: number, limit?: number): Promise<Campaign[]>
getCampaign(id: string): Promise<CampaignDetail>
```

---

### Modify: `lib/types.ts`

Add these TypeScript interfaces:
```typescript
interface Campaign {
  id: string
  name: string
  agent_name: string
  project_id: string | null
  total_calls: number
  hot_count: number
  warm_count: number
  cold_count: number
  new_leads_created: number
  existing_leads_updated: number
  created_at: string
}

interface CampaignRow {
  call_id: string
  name: string
  phone_number: string
  transcript: string
  recording_url: string
  extracted_entities: string
  call_eval_tag: string
  summary: string
}

interface CampaignPreview {
  rows: CampaignRow[]
  total: number
  format_detected: 'csv' | 'json'
}

interface CampaignIngestPayload {
  campaign_name: string
  agent_name: string
  rows: CampaignRow[]
}

interface CampaignResult {
  campaign_id: string
  total: number
  hot: number
  warm: number
  cold: number
  created: number
  updated: number
  leads: LeadSummary[]
}
```

---

## 9. REAL-WORLD TEST CASES (validate against these before shipping)

The implementation must handle both leads from the actual call campaign screenshot correctly:

**Test Lead 1 — अमित्फा (+919820991337)**
- Summary: "Niharika from Krishna Group called Amitfa referencing his Credai Expo visit to discuss their flats. The customer expressed disinterest in purchasing but said he could visit the site. The call ended with no specific date or time set and no further interest in the property."
- Expected classification: **Warm** (disinterest = Cold signal + "could visit" = Warm signal → mixed = Warm)
- Expected stage: `contacted`
- Expected priority: Normal
- Expected auto-task: "Follow-up call — invite for site visit" due in 24 hours
- Expected notification: none (Warm leads do not trigger notification)

**Test Lead 2 — अमीर (+918881013538)**
- Summary: "The agent from Krishna Group called to follow up on the user's interest from the Credai expo, explaining the new 45-floor tower with 2, 3, and 4 BHK options. The user confirmed interest in a 2 BHK, discussed carpet area, built-up area, loading percentage, and down payment options, and asked for WhatsApp details. The call concluded with arranging a site visit for tomorrow with pick-up arrangements for the user's family and sending project details via WhatsApp."
- Expected classification: **Hot** (site visit arranged + pick-up confirmed + WhatsApp requested + specific unit discussed + down payment discussed)
- Expected stage: `site_visit_scheduled`
- Expected priority: High
- Expected auto-task: "URGENT: Confirm tomorrow's site visit — reconfirm time and pick-up details" due in 1 hour
- Expected notification: "HOT LEAD: अमीर — [campaign name] — action required"

---

## 10. ERROR HANDLING REQUIREMENTS

- If a row is missing `name` AND `phone_number` → skip the row, log a warning, continue processing remaining rows. Never abort the entire import.
- If `recording_url` is an invalid URL → store it as-is, do not validate URLs during import.
- If `extracted_entities` is not valid JSON → treat as empty, do not fail the row.
- If `transcript` is extremely long (>50,000 chars) → store in full but truncate UI display to first 2,000 chars with a "Show more" toggle.
- If the file has 0 valid rows after parsing → return a clear error: "No valid rows found in file. Check column headers match expected format."
- If a duplicate phone number appears multiple times within the same uploaded file → process the first occurrence, skip subsequent ones, include a count of skipped duplicates in the import summary.
- If the database write fails for a single row → log the error, skip that row, continue. Report failed rows in the import summary.

---

## 11. THE AUTOMATED PATH (future-proof, build now)

The endpoint `POST /api/campaigns/ingest-single` is the hook for future automation. Once Niharika's platform supports webhooks, each call's result will POST to this endpoint automatically — no manual CSV upload needed. The same classification engine runs. The same dedup logic applies.

Build this endpoint now so the automation path requires zero additional backend changes later. The only difference from manual import is the `X-Campaign-Secret` authentication header.

---

## 12. WHAT NOT TO CHANGE

- Do not modify any existing lead CRUD logic outside of adding `campaign_id` to create/update functions
- Do not modify the Priya.ai memory service or the `/api/leads/inbound` endpoint
- Do not change authentication or role logic
- Do not change the Kanban board drag-and-drop logic
- Do not change any existing page layouts or navigation except the sidebar addition
- The existing `activities` table structure must remain backward-compatible — new columns are additive only

---

## 13. SUMMARY OF ALL FILES TO CREATE OR MODIFY

| File | Action |
|---|---|
| `app/services/campaign_service.py` | CREATE |
| `app/routers/campaigns.py` | CREATE |
| `app/main.py` | MODIFY — register router |
| `frontend/app/campaigns/page.tsx` | CREATE |
| `frontend/app/campaigns/[id]/page.tsx` | CREATE |
| `frontend/components/shared/Sidebar.tsx` | MODIFY — add nav item |
| `frontend/components/leads/LeadComponents.tsx` | MODIFY — campaign_call activity rendering |
| `frontend/components/leads/KanbanBoard.tsx` | MODIFY — campaign tag on cards |
| `frontend/lib/api.ts` | MODIFY — add campaign API functions |
| `frontend/lib/types.ts` | MODIFY — add campaign interfaces |
| DB migration | CREATE — campaigns table, projects table, alter leads + activities |

---

*End of implementation prompt. Build exactly what is described here — no more, no less.*
