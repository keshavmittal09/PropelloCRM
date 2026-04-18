# Call Campaign Analytics Dashboard — Implementation Plan

## Goal

Add an **enterprise-grade Call Campaign Analytics Dashboard** to the existing Propello CRM. When a campaign Excel/CSV/JSON is uploaded, the system ingests all data (including the extended fields: quality scores, timestamps, retries, attempt numbers), runs AI-powered analysis, computes priority scores (P1–P7), auto-assigns leads to calling agents, and renders a rich interactive dashboard with insights, visualizations, and lead detail drawers.

> [!IMPORTANT]
> This is for a production sales team. Every classification, priority assignment, and insight must be accurate. The system must handle Hindi names, malformed JSON, missing fields, and large datasets (2,000+ rows) without crashing.

---

## User Review Required

> [!IMPORTANT]
> **AI Cost Estimate (Groq LLaMA 3.3 70B)**
> - **Per campaign of ~36 connected calls**: ~$0.01–$0.03 (trivial)
> - **Per campaign of ~2,230 rows (442 connected)**: ~$0.05–$0.15
> - **Groq pricing**: $0.59/M input tokens, $0.79/M output tokens
> - **Only connected calls (with real transcripts) are sent to AI** — no-connect rows use rule-based scoring only
> - **Monthly estimate** (assuming 5 campaigns/week): ~$1–$3/month
>
> This is extremely cost-effective. The AI analysis adds deep per-lead insights (engagement summary, risk flags, recommended action, close probability) that rule-based scoring alone cannot provide.

> [!WARNING]
> **Extended Excel Schema** — The current `CampaignRow` schema only has 8 fields. The real Excel has **16 fields** including quality scores, timestamps, retries, and dial status. This plan extends the schema to capture everything. The existing campaign ingestion flow will be **backward-compatible** — old files with 8 fields still work.

---

## Data Schema (from Book1.xlsx)

The Excel has 2 sheets:
- **"csv raw Credai Campg_day3_14th"**: 2,230 rows, 387 unique phones (raw campaign dump)
- **"Sheet1"**: 36 rows (curated connected-call subset)

### All 16 Columns (source of truth)

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `name` | string | Lead name (may be Hindi: आर्मन सैयात) |
| 2 | `phone_number` | string | Phone (919975000000 format, no +) |
| 3 | `other_info` | string | JSON object, usually `{}` |
| 4 | `attempt_number` | int | Which attempt this call was (1, 2, 3) |
| 5 | `call_id` | string | Unique call ID (outbound-1776155605-fa3f082f) |
| 6 | `transcript` | string | Full transcript with AGENT/USER turns, or "transcript not found" |
| 7 | `recording_url` | string | VaaniVoice stream URL (no auth needed) |
| 8 | `extracted_entities` | string | JSON: Configuration_Preference, Budget_Estimate, Site_Visit_Agreed, Site_Visit_Date, Site_Visit_Time, whatsapp_followup, Senior Escalation, call_back_requested |
| 9 | `call_eval_tag` | string | "Yes" / "No" / empty |
| 10 | `summary` | string | AI-generated call summary, or empty for no-connect |
| 11 | `call_conversation_quality` | string | JSON: `{clarity, professionalism, problem_resolution, overall_quality}` (each 0–10) |
| 12 | `call_dialing_at` | datetime | When dialing started |
| 13 | `call_ringing_at` | datetime | When ringing started |
| 14 | `user_picked_up` | datetime | When user answered (null = no answer) |
| 15 | `num_of_retries` | int | Number of retry attempts for this phone |
| 16 | `dial_status_reason` | string | Dial failure reason (usually empty) |

### Key Statistics from Real Data

| Metric | Value |
|--------|-------|
| Total rows (raw) | 2,230 |
| Unique phones | 387 |
| Connected (real transcript) | 442 (19.8%) |
| Not connected | 1,788 (80.2%) |
| Eval = "Yes" | 2 (0.09%) |
| Eval = "No" | 441 |
| Eval = empty | 1,787 |
| Attempt 1 connection rate | 28.7% |
| Attempt 2 connection rate | 13.5% |
| Attempt 3 connection rate | 11.6% |
| Avg clarity score | 5.6/10 |
| Avg professionalism | 6.4/10 |
| Avg problem_resolution | 2.4/10 |
| Avg overall_quality | 4.2/10 |

---

## Priority Scoring Engine (P1–P7)

> [!NOTE]
> The P-system is **campaign dashboard only**. The rest of the CRM continues using Hot/Warm/Cold. Each lead gets BOTH: a `lead_score` (hot/warm/cold) for the CRM AND a `priority_tier` (P1–P7) for the campaign dashboard.

### Scoring Algorithm (0–100 points)

```
score = 0

# Entity-based signals (from extracted_entities)
if Site_Visit_Agreed == "yes":           score += 30
if whatsapp_followup == "yes":           score += 15
if Configuration_Preference is not null: score += 12
if Budget_Estimate is not null:          score += 10
if call_back_requested == "yes":         score += 8
if Senior_Escalation == "yes":           score += 5

# Quality-based signals (from call_conversation_quality)
if overall_quality >= 7:                 score += 15
elif overall_quality >= 5:               score += 8
elif overall_quality >= 3:               score += 3

# Engagement signals
if transcript_length > 1500:             score += 10
elif transcript_length > 700:            score += 6
elif transcript_length > 300:            score += 3

# Eval tag
if call_eval_tag == "Yes":               score += 15
elif call_eval_tag == "No" and score > 0: score += 0  # neutral
elif call_eval_tag == "No" and score == 0: score -= 5

# Negative signals (from transcript/summary keywords)
if "not interested" in summary:          score -= 10
if "already bought" in summary:          score -= 15
if "don't call" in summary:             score -= 20 (also flag DNC)
if no transcript / "transcript not found": score = -1 (no-connect)

# Attempt penalty
if attempt_number >= 3 and score < 20:   score -= 5
```

### Tier Mapping

| Tier | Score Range | Label | Action | SLA |
|------|------------|-------|--------|-----|
| P1 | 60–100 | 🔥 Immediate Action | Confirm site visit, send WA brochure | 1 hour |
| P2 | 40–59 | 🟠 High Priority | Call back within 2 hours | 2 hours |
| P3 | 25–39 | 🟡 Warm Follow-up | Schedule callback, invite for visit | 24 hours |
| P4 | 10–24 | 🔵 Retry | Retry in evening window (6–8 PM) | 48 hours |
| P5 | 1–9 | ⚪ Low Priority | Re-engage in 7 days | 7 days |
| P6 | 0 | ❌ No Interest | Archive, re-engage in 30 days | 30 days |
| P7 | < 0 / no-connect | 🚫 No Connect / DNC | Do not call / retry different time | — |

### Mapping P-tier → Hot/Warm/Cold

| P-Tier | CRM Lead Score |
|--------|---------------|
| P1, P2 | Hot |
| P3, P4 | Warm |
| P5, P6, P7 | Cold |

---

## AI-Powered Campaign Analysis

When a campaign is ingested, for each **connected call** (transcript length > 50 chars), the system sends the transcript + summary + entities to Groq and receives:

```json
{
  "engagement_level": "high" | "medium" | "low" | "none",
  "intent_signals": ["site_visit_interest", "price_inquiry", "config_discussed"],
  "objections": ["busy_right_now", "not_interested", "already_invested"],
  "recoverable_objection": true | false,
  "recommended_callback_time": "evening" | "morning" | "weekend" | null,
  "script_issues_detected": ["audio_loop", "monologue_heavy", "no_objection_handling"],
  "lead_quality_assessment": "A brief sentence about this lead's potential",
  "suggested_next_action": "Specific action for the calling agent",
  "close_probability": 0-100
}
```

This is stored in the activity's `meta` field alongside the rule-based P-tier score.

**For no-connect calls** (no transcript): skip AI, use rule-based P7 tier only.

---

## Computed Insights (15 insights auto-generated per campaign)

These are computed from the campaign data and displayed in the Insights tab:

1. **Connection Rate Funnel**: Dialed → Connected → Pitch Reached → Interested → Site Visit
2. **Attempt Decay Analysis**: Connection rate drops per attempt (28.7% → 13.5% → 11.6%)
3. **Transcript Length ↔ Quality Correlation**: Longer calls = higher quality scores
4. **Problem Resolution Gap**: avg 2.4/10 — the weakest dimension, needs script fix
5. **Retry Trap Detection**: Attempt 2+ shows diminishing returns — shift time window
6. **Time Window Analysis**: All calls in 14:00–16:00 → evening 18:00–20:00 untested
7. **Pitch Reach Rate**: % of connected calls where the agent actually delivered the pitch
8. **Turn Ratio Analysis**: When users talk more (ratio > 0.5), pitch rate doubles
9. **Audio Issue Detection**: Calls with clarity < 3 flagged as potential audio bugs
10. **DNC Risk Detection**: Leads explicitly saying "don't call" / "remove" → flag for compliance
11. **Missed Opportunity Leads**: High quality score + eval=No → scoring calibration issue
12. **Recoverable Objection Count**: "Meeting" / "out of station" objections that need callback
13. **Config Preference Extraction Rate**: How many leads revealed BHK/budget preferences
14. **WhatsApp Capture Rate**: % of connected calls where WA number was captured
15. **Agent Script Effectiveness Score**: Composite of quality dimensions across all calls

---

## Proposed Changes

### Backend

---

#### [MODIFY] [schemas.py](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/backend/app/schemas/schemas.py)

Extend `CampaignRow` to accept all 16 Excel fields:

```python
class CampaignRow(BaseModel):
    call_id: str = ""
    name: str = ""
    phone_number: str = ""
    transcript: str = ""
    recording_url: str = ""
    extracted_entities: str = ""
    call_eval_tag: str = ""
    summary: str = ""
    # Extended fields (optional for backward compatibility)
    other_info: str = ""
    attempt_number: Optional[int] = 1
    call_conversation_quality: str = ""
    call_dialing_at: Optional[str] = None
    call_ringing_at: Optional[str] = None
    user_picked_up: Optional[str] = None
    num_of_retries: Optional[int] = 0
    dial_status_reason: str = ""
```

Add campaign analytics response schemas:

```python
class CampaignAnalytics(BaseModel):
    campaign_id: str
    total_dialed: int
    total_connected: int
    connection_rate: float
    eval_yes: int
    eval_no: int
    eval_empty: int
    avg_clarity: float
    avg_professionalism: float
    avg_problem_resolution: float
    avg_overall_quality: float
    attempt_stats: list[dict]  # [{attempt: 1, total: N, connected: N, rate: %}]
    tier_distribution: dict  # {P1: N, P2: N, ...}
    hot_count: int
    warm_count: int
    cold_count: int
    insights: list[dict]  # [{id, title, description, severity, data}]
    transcript_length_buckets: list[dict]

class CampaignLeadDetail(BaseModel):
    lead_id: str
    name: str
    phone: str
    priority_tier: str  # P1-P7
    priority_score: int  # 0-100
    lead_score: str  # hot/warm/cold
    stage: str
    attempt_number: int
    call_eval_tag: str
    summary: str
    transcript: str
    recording_url: str
    extracted_entities: dict
    call_quality: dict  # {clarity, professionalism, problem_resolution, overall}
    call_dialing_at: Optional[str]
    user_picked_up: Optional[str]
    num_of_retries: int
    ai_analysis: Optional[dict]  # From Groq
    assigned_agent_name: Optional[str]
    action: str  # created/updated
```

---

#### [MODIFY] [campaign_service.py](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/backend/app/services/campaign_service.py)

1. Update `EXPECTED_FIELDS` to include all 16 columns
2. Update `parse_campaign_file()` to handle the extended schema + `.xlsx` files (using openpyxl)
3. Add `compute_priority_score()` function implementing the P1–P7 algorithm
4. Add `compute_priority_tier()` function mapping score → tier
5. Update `classify_lead()` to also return `priority_tier` and `priority_score`
6. Update `process_campaign_row()` to store extended fields in `activity.meta`
7. Add `compute_campaign_insights()` function that generates all 15 insights from aggregated data

Key changes:
- `parse_campaign_file()` gains `.xlsx` support via openpyxl
- New `compute_priority_score(summary, transcript, entities, quality, eval_tag, attempt, retries, transcript_length)` function
- Activity `meta` field now stores: quality scores, timestamps, attempt number, retries, priority_tier, priority_score, ai_analysis

---

#### [NEW] [campaign_analytics_service.py](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/backend/app/services/campaign_analytics_service.py)

New service for computing dashboard analytics from campaign data:

- `compute_campaign_analytics(campaign_id, db) → CampaignAnalytics`
- `compute_insights(activities) → list[dict]` — the 15 insight computations
- `compute_agent_assignments(leads, agents, db) → list[dict]` — auto-distribute to agents named "call agent"
- `get_campaign_lead_details(campaign_id, db) → list[CampaignLeadDetail]` — full lead details with all fields

---

#### [NEW] [campaign_ai_analyzer.py](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/backend/app/services/campaign_ai_analyzer.py)

AI-powered analysis using Groq for connected calls:

- `analyze_campaign_call(transcript, summary, entities, quality) → dict` — sends to Groq, returns structured analysis
- `batch_analyze_campaign(campaign_id, db) → int` — analyzes all connected calls in a campaign
- Uses the existing `_call_groq()` pattern from `ai_analyzer.py`
- Includes campaign-specific system prompt for real estate call analysis

---

#### [MODIFY] [campaigns.py (router)](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/backend/app/routers/campaigns.py)

Add new endpoints:

```
GET  /api/campaigns/{id}/analytics     → CampaignAnalytics (dashboard data)
GET  /api/campaigns/{id}/leads-detail  → list[CampaignLeadDetail] (with filters: tier, score, search)
POST /api/campaigns/{id}/analyze-ai    → trigger AI analysis on all connected calls
GET  /api/campaigns/{id}/agent-assignments → auto-assignment list for 3 "call agent" agents
POST /api/campaigns/{id}/assign-agents → execute the auto-assignment
```

---

#### [MODIFY] [config.py](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/backend/app/core/config.py)

Add: `CAMPAIGN_AI_ENABLED: bool = True` — toggle for AI analysis

---

#### [MODIFY] [requirements.txt](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/backend/requirements.txt)

Add: `openpyxl>=3.1.0` (for .xlsx file parsing)

---

### Frontend

---

#### [NEW] [campaigns/[id]/dashboard/page.tsx](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/frontend/app/campaigns/[id]/dashboard/page.tsx)

**Main Call Campaign Dashboard page** — this is the centerpiece. 5-tab layout:

**Tab 1: Campaign Overview**
- 8 KPI cards: Total Dialed, Connected, Connection Rate, Eval Yes, Hot/Warm/Cold counts, Avg Quality
- Connection funnel (horizontal bar chart): Dialed → Connected → Pitch → Interest → Site Visit
- Outcome pie chart: Connected vs No-Connect vs Retry
- Quality radar chart: 4 dimensions (clarity, professionalism, problem_resolution, overall)
- Call duration distribution bar chart (by transcript length bucket)

**Tab 2: Priority Queue**
- Filterable table of ALL leads sorted by priority tier (P1 first)
- Columns: Tier Badge | Score | Name | Phone | Eval | Attempt | Quality | Summary (truncated) | Action
- Filter bar: tier dropdown (P1–P7), search by name/phone
- Click row → opens Lead Detail Drawer
- Color-coded rows: P1=red bg, P2=orange, P3=yellow, P4=blue, P5=gray, P6=dark gray, P7=striped

**Tab 3: Insights & Playbook**
- 15 insight cards in a 3-column grid
- Each card: icon, title, description, data visualization (mini chart or stat)
- Severity badges: 🔴 Critical, 🟡 Warning, 🟢 Informational
- Actionable recommendations with each insight

**Tab 4: Agent Assignment**
- 3 agent columns (auto-distributed)
- Each column shows agent name, assigned lead count, tier breakdown
- Drag-and-drop to reassign (optional — phase 2)
- "Auto-Assign" button → calls POST /assign-agents → distributes leads
- Assignment rule: P1+P2 → most experienced agent, P3+P4 → mid, P5+ → junior (or round-robin for 3 "call agent" accounts)

**Tab 5: AI Analysis** (requires Groq API key)
- "Run AI Analysis" button → triggers batch analysis
- Progress indicator during analysis
- After completion: shows per-lead AI insights in expandable cards
- Campaign-level AI summary: script effectiveness, common objections, recommended improvements

---

#### [NEW] [CampaignLeadDrawer.tsx](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/frontend/components/leads/CampaignLeadDrawer.tsx)

**Slide-out drawer** that opens when clicking any lead in the priority queue. Contains:

1. **Header**: Name, phone, tier badge, score badge, eval tag badge
2. **Audio Player**: `<audio>` element with VaaniVoice stream URL (direct, no auth)
3. **Call Summary**: Full summary text
4. **Transcript Viewer**: Full transcript with AGENT/USER color coding (agent=blue, user=green), collapsible, "Show more" at 2000 chars
5. **Entity Grid**: 2×4 grid showing all extracted entities (Config Preference, Budget, Site Visit Agreed/Date/Time, WA followup, Senior Escalation, Callback)
6. **Quality Score Bars**: 4 horizontal progress bars (clarity, professionalism, problem_resolution, overall_quality) with color coding (0-3=red, 4-6=amber, 7-10=green)
7. **Call Metadata**: Attempt number, retries, dial time, ring time, pickup time
8. **AI Analysis** (if available): Engagement level, intent signals, objections, recommended action, close probability gauge
9. **Action Buttons**: "Open Lead in CRM", "Assign to Agent", "Create Task", "Send WhatsApp"

---

#### [MODIFY] [api.ts](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/frontend/lib/api.ts)

Add to `campaignsApi`:
```typescript
getCampaignAnalytics: (id: string) => api.get<CampaignAnalytics>(`/api/campaigns/${id}/analytics`).then(r => r.data),
getCampaignLeadsDetail: (id: string, params?: { tier?: string; search?: string }) =>
  api.get<CampaignLeadDetail[]>(`/api/campaigns/${id}/leads-detail`, { params }).then(r => r.data),
triggerAiAnalysis: (id: string) => api.post(`/api/campaigns/${id}/analyze-ai`).then(r => r.data),
getAgentAssignments: (id: string) => api.get(`/api/campaigns/${id}/agent-assignments`).then(r => r.data),
executeAgentAssignment: (id: string) => api.post(`/api/campaigns/${id}/assign-agents`).then(r => r.data),
```

---

#### [MODIFY] [types.ts](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/frontend/lib/types.ts)

Add:
```typescript
interface CampaignAnalytics {
  campaign_id: string
  total_dialed: number
  total_connected: number
  connection_rate: number
  eval_yes: number
  eval_no: number
  eval_empty: number
  avg_clarity: number
  avg_professionalism: number
  avg_problem_resolution: number
  avg_overall_quality: number
  attempt_stats: { attempt: number; total: number; connected: number; rate: number }[]
  tier_distribution: Record<string, number>
  hot_count: number
  warm_count: number
  cold_count: number
  insights: CampaignInsight[]
  transcript_length_buckets: { bucket: string; count: number; avg_quality: number }[]
}

interface CampaignInsight {
  id: string
  title: string
  description: string
  severity: 'critical' | 'warning' | 'info'
  metric_value: string
  recommendation: string
}

interface CampaignLeadDetail {
  lead_id: string
  name: string
  phone: string
  priority_tier: string
  priority_score: number
  lead_score: string
  stage: string
  attempt_number: number
  call_eval_tag: string
  summary: string
  transcript: string
  recording_url: string
  extracted_entities: Record<string, unknown>
  call_quality: { clarity: number; professionalism: number; problem_resolution: number; overall_quality: number }
  call_dialing_at: string | null
  user_picked_up: string | null
  num_of_retries: number
  ai_analysis: Record<string, unknown> | null
  assigned_agent_name: string | null
  action: string
}

// Extend existing CampaignRow
interface CampaignRow {
  call_id: string
  name: string
  phone_number: string
  transcript: string
  recording_url: string
  extracted_entities: string
  call_eval_tag: string
  summary: string
  other_info?: string
  attempt_number?: number
  call_conversation_quality?: string
  call_dialing_at?: string
  call_ringing_at?: string
  user_picked_up?: string
  num_of_retries?: number
  dial_status_reason?: string
}
```

---

#### [MODIFY] [useQueries.ts](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/frontend/hooks/useQueries.ts)

Add:
```typescript
export const useCampaignAnalytics = (id: string) =>
  useQuery({ queryKey: ['campaign-analytics', id], queryFn: () => campaignsApi.getCampaignAnalytics(id), enabled: !!id })

export const useCampaignLeadsDetail = (id: string, params?: { tier?: string; search?: string }) =>
  useQuery({ queryKey: ['campaign-leads-detail', id, params], queryFn: () => campaignsApi.getCampaignLeadsDetail(id, params), enabled: !!id })
```

---

#### [MODIFY] [campaigns/[id]/page.tsx](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/frontend/app/campaigns/[id]/page.tsx)

Add a prominent "Open Dashboard" button that navigates to `/campaigns/[id]/dashboard`. Also add the stat cards for tier distribution (P1–P7) alongside the existing Hot/Warm/Cold cards.

---

#### [MODIFY] [campaigns/page.tsx](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/frontend/app/campaigns/page.tsx)

After import results (State 3), add "Open Campaign Dashboard →" button that navigates to the new dashboard page.

---

#### [MODIFY] [Sidebar.tsx](file:///c:/Users/Lenovo/Desktop/propello-crm/propello-crm/frontend/components/shared/Sidebar.tsx)

No change needed — Campaigns is already in the sidebar.

---

## UI/UX Design Specifications

### Design Language (matching existing CRM)
- **Background**: `bg-[#f7f5f2]` (warm cream)
- **Cards**: `bg-white border border-[#eadfce] rounded-3xl shadow-sm`
- **Text**: Primary `#2a231d`, Secondary `#7f7266`, Muted `#8c7f73`
- **Accent**: `#c86f43` (copper/terracotta)
- **Charts**: Use Recharts (already installed)
- **Animations**: Use existing `crm-page-enter`, `crm-fade-up`, `crm-stagger` classes

### Tab Design
- Horizontal tab bar with pill-shaped active indicator
- Active: `bg-[#2a231d] text-white rounded-full px-5 py-2`
- Inactive: `text-[#7f7266] hover:text-[#2a231d]`

### Priority Tier Badges
| Tier | Background | Text | Border |
|------|-----------|------|--------|
| P1 | `bg-red-50` | `text-red-700` | `border-red-200` |
| P2 | `bg-orange-50` | `text-orange-700` | `border-orange-200` |
| P3 | `bg-amber-50` | `text-amber-700` | `border-amber-200` |
| P4 | `bg-blue-50` | `text-blue-700` | `border-blue-200` |
| P5 | `bg-gray-50` | `text-gray-600` | `border-gray-200` |
| P6 | `bg-gray-100` | `text-gray-500` | `border-gray-300` |
| P7 | `bg-gray-200` | `text-gray-400` | `border-gray-300` + striped |

### Lead Detail Drawer
- Slide in from right, 520px width
- Overlay with `bg-black/30` backdrop
- White background with the same warm-cream card styling
- Close button + "Open in CRM" button in header

---

## Implementation Order (18 steps)

### Phase 1: Backend Foundation (Steps 1–6)
1. Add `openpyxl` to requirements.txt
2. Extend `CampaignRow` schema with all 16 fields
3. Update `parse_campaign_file()` for .xlsx support + extended fields
4. Add `compute_priority_score()` and `compute_priority_tier()` functions
5. Update `process_campaign_row()` to store extended data in activity.meta
6. Add campaign analytics response schemas

### Phase 2: Analytics Engine (Steps 7–9)
7. Create `campaign_analytics_service.py` with `compute_campaign_analytics()`
8. Create `campaign_ai_analyzer.py` with Groq integration
9. Add agent auto-assignment logic (query agents with "call agent" in name/role)

### Phase 3: API Endpoints (Steps 10–11)
10. Add analytics, leads-detail, agent-assignment endpoints to campaigns router
11. Add AI analysis trigger endpoint

### Phase 4: Frontend Dashboard (Steps 12–16)
12. Add TypeScript types and API functions
13. Add React Query hooks
14. Build the Campaign Dashboard page (5 tabs)
15. Build the Lead Detail Drawer component
16. Build insight cards, chart components, agent assignment UI

### Phase 5: Integration & Polish (Steps 17–18)
17. Connect upload flow → dashboard (add "Open Dashboard" after import)
18. Test with real Book1.xlsx data, verify all 15 insights compute correctly

---

## Summary of All Files to Create or Modify

| File | Action |
|------|--------|
| `backend/requirements.txt` | MODIFY — add openpyxl |
| `backend/app/schemas/schemas.py` | MODIFY — extend CampaignRow + add analytics schemas |
| `backend/app/services/campaign_service.py` | MODIFY — xlsx support, priority scoring, extended fields |
| `backend/app/services/campaign_analytics_service.py` | **CREATE** — analytics computation engine |
| `backend/app/services/campaign_ai_analyzer.py` | **CREATE** — Groq-powered campaign analysis |
| `backend/app/routers/campaigns.py` | MODIFY — add analytics/detail/assignment endpoints |
| `backend/app/core/config.py` | MODIFY — add CAMPAIGN_AI_ENABLED flag |
| `frontend/lib/types.ts` | MODIFY — add CampaignAnalytics, CampaignLeadDetail, CampaignInsight |
| `frontend/lib/api.ts` | MODIFY — add campaign analytics API functions |
| `frontend/hooks/useQueries.ts` | MODIFY — add campaign analytics hooks |
| `frontend/app/campaigns/page.tsx` | MODIFY — add "Open Dashboard" after import |
| `frontend/app/campaigns/[id]/page.tsx` | MODIFY — add "Open Dashboard" button + tier stats |
| `frontend/app/campaigns/[id]/dashboard/page.tsx` | **CREATE** — main dashboard page (5 tabs) |
| `frontend/components/leads/CampaignLeadDrawer.tsx` | **CREATE** — lead detail slide-out drawer |

---

## Verification Plan

### Automated Tests
- Upload `Book1.xlsx` via the CRM campaigns page
- Verify all 2,230 rows parse (raw sheet) OR all 36 rows parse (Sheet1)
- Verify priority scoring: the 1 "Yes" eval lead (Abdul Raqib) gets P1
- Verify the 2 leads with Config_Preference get P2 or higher
- Verify no-connect leads get P7
- Verify Hot/Warm/Cold mapping matches P-tier rules
- Verify all 15 insights compute without errors
- Verify dashboard loads with all 5 tabs rendering

### Manual Verification
- Open the dashboard and verify charts render correctly
- Click a lead → verify drawer shows transcript, audio player, entities, quality bars
- Verify Hindi names display correctly (आर्मन सैयात)
- Run AI analysis → verify Groq returns structured analysis
- Verify agent auto-assignment distributes leads to 3 "call agent" accounts

---

## n8n Integration Points (for future use)

> [!NOTE]
> n8n workflow implementation is deferred. These are the **webhook endpoints** that the n8n workflow will call when ready:
> - `POST /api/campaigns/ingest-single` — already exists, accepts single call results
> - `POST /api/campaigns/{id}/analyze-ai` — triggers AI analysis
> - The n8n flow will be: VaaniVoice call complete → webhook to n8n → n8n calls ingest-single → n8n calls analyze-ai → n8n sends Slack notification

---

*End of implementation plan. Awaiting approval to begin execution.*
