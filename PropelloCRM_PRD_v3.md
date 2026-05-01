# PropelloCRM — Product Requirements Document
**Version:** 3.0 (Final)
**Author:** Keshav Mittal
**Status:** Ready for AI Implementation
**Last Updated:** May 2026

> ⚠️ **AI NOTE:** All schema assumptions verified against actual source files (lead.py, models.py, config.py, PageContents.tsx). Do not invent columns or components — use what exists unless explicitly told to create.

---

## Table of Contents
1. [Problem Statement](#1-problem-statement)
2. [Full Role & Hierarchy Map](#2-full-role--hierarchy-map)
3. [Feature 0 — Multi-Tenant Organization Architecture](#3-feature-0--multi-tenant-organization-architecture)
4. [Feature 1 — UI/UX Consistency Overhaul](#4-feature-1--uiux-consistency-overhaul)
5. [Feature 2 — Mobile-First UI for call_agent](#5-feature-2--mobile-first-ui-for-call_agent)
6. [Feature 3 — Smart Task Completion Form](#6-feature-3--smart-task-completion-form)
7. [Feature 4 — Lead Demographic Profile Sync](#7-feature-4--lead-demographic-profile-sync)
8. [Backend Changes Required](#8-backend-changes-required)
9. [API Contract](#9-api-contract)
10. [Implementation Order](#10-implementation-order)
11. [Open Questions](#11-open-questions)
12. [Proactive Suggestions](#12-proactive-suggestions)
13. [Out of Scope for v1](#13-out-of-scope-for-v1)
14. [Appendix A — Confirmed File Map](#appendix-a--confirmed-file-map)
15. [Appendix B — Existing Fields Reference](#appendix-b--existing-fields-reference)

---

## 1. Problem Statement

### Problem 1 — No Multi-Tenancy
Propello (the owner/operator) wants to sell this CRM to multiple real estate companies (Organizations). Currently there is zero data isolation — one database shared with no client separation. A client of Propello can theoretically see another client's leads, agents, and data. This is a blocker for selling the product commercially.

### Problem 2 — Broken UI Consistency
Every page has ad-hoc styling. Colors, spacing, button sizes, card patterns, and interaction models differ across pages and roles. The UX is inconsistent for every user type.

### Problem 3 — No Mobile Experience for call_agent
Call agents work exclusively on mobile. The task list currently renders as a desktop HTML **table** (confirmed in PageContents.tsx line ~103). This is completely unusable on mobile.

### Problem 4 — Wasted Data Collection
The `master_profile` JSON field on Lead exists but is empty for most leads. `UnifiedTaskCompletionSheet` already exists but collects only a basic remark. Valuable call data is lost every day.

---

## 2. Full Role & Hierarchy Map

### Complete Hierarchy (new)

```
super_admin                        ← Propello/Shardul — sees ALL organizations
  └── org_admin                    ← Client's top-level admin (was "admin")
        └── manager                ← Team manager within an org
              ├── agent            ← Field/sales agent
              └── call_agent       ← Outbound calling agent, mobile-only
```

### Role Descriptions

| Role | Who | Access Scope |
|---|---|---|
| `super_admin` | Propello owner (Shardul + team) | All organizations, all data, org management |
| `org_admin` | Client's IT admin or owner | Everything within their org only |
| `manager` | Team lead within org | Their team's leads, tasks, agents |
| `agent` | Sales/field agent | Own + assigned leads, tasks, visits |
| `call_agent` | Outbound caller | Assigned tasks + leads only, mobile-only |

### Role Capability Matrix

| Capability | super_admin | org_admin | manager | agent | call_agent |
|---|---|---|---|---|---|
| Create/manage organizations | ✅ | ❌ | ❌ | ❌ | ❌ |
| View all organizations | ✅ | ❌ | ❌ | ❌ | ❌ |
| View org dashboard | ✅ | own org | own org | ❌ | ❌ |
| Manage org agents/roles | ✅ | own org | ❌ | ❌ | ❌ |
| View all leads (org-wide) | ✅ | ✅ | ✅ | own | assigned |
| Assign leads | ✅ | ✅ | ✅ | ❌ | ❌ |
| Edit lead profile | ✅ | ✅ | ✅ | ✅ | via form only |
| View Kanban | ✅ | ✅ | ✅ | ✅ | ❌ |
| View Tasks | ✅ | ✅ | ✅ | ✅ | ✅ (own only) |
| Mark task done | ✅ | ✅ | ✅ | ✅ | ✅ |
| Upload campaigns | ✅ | ✅ | ✅ | ❌ | ❌ |
| View analytics | ✅ | ✅ | own team | self | ❌ |
| Write to master_profile | ✅ | ✅ | ✅ | ✅ | via form only |

### JWT Token Shape (new)
```json
{
  "sub": "agent_id",
  "role": "call_agent",
  "org_id": "org_abc123",
  "is_super_admin": false
}
```
`super_admin` tokens have `is_super_admin: true` and `org_id: null`.

---

## 3. Feature 0 — Multi-Tenant Organization Architecture

> ⚠️ **This must be implemented FIRST. Everything else depends on it.**

### 3.1 Architecture Decision

**Single database, row-level isolation via `org_id`.**

Every table gets an `org_id` foreign key. Every query is automatically scoped to the current user's `org_id`. `super_admin` bypasses this filter.

Same URL (`propellocrm.com`), different login. Org is determined from the JWT, not the URL.

### 3.2 New Model: Organization

```python
# backend/app/models/organization.py  ← CREATE THIS FILE

class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)  # e.g. "prestige-realty"
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    plan: Mapped[str] = mapped_column(
        SAEnum("trial", "basic", "pro", "enterprise", name="org_plan"),
        default="trial"
    )
    max_agents: Mapped[int] = mapped_column(Integer, default=10)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    agents = relationship("Agent", back_populates="organization")
```

### 3.3 Add org_id to Every Existing Table

Run as a single Alembic migration. Add to ALL tables:

```sql
-- migration: add_org_id_to_all_tables.py

ALTER TABLE agents      ADD COLUMN org_id VARCHAR REFERENCES organizations(id);
ALTER TABLE leads       ADD COLUMN org_id VARCHAR REFERENCES organizations(id);
ALTER TABLE contacts    ADD COLUMN org_id VARCHAR REFERENCES organizations(id);
ALTER TABLE tasks       ADD COLUMN org_id VARCHAR REFERENCES organizations(id);
ALTER TABLE activities  ADD COLUMN org_id VARCHAR REFERENCES organizations(id);
ALTER TABLE campaigns   ADD COLUMN org_id VARCHAR REFERENCES organizations(id);
ALTER TABLE properties  ADD COLUMN org_id VARCHAR REFERENCES organizations(id);
ALTER TABLE site_visits ADD COLUMN org_id VARCHAR REFERENCES organizations(id);
ALTER TABLE notifications ADD COLUMN org_id VARCHAR REFERENCES organizations(id);
ALTER TABLE performance_snapshots ADD COLUMN org_id VARCHAR REFERENCES organizations(id);

-- Add indexes for all org_id columns (critical for performance)
CREATE INDEX idx_leads_org_id       ON leads(org_id);
CREATE INDEX idx_contacts_org_id    ON contacts(org_id);
CREATE INDEX idx_tasks_org_id       ON tasks(org_id);
CREATE INDEX idx_agents_org_id      ON agents(org_id);
CREATE INDEX idx_activities_org_id  ON activities(org_id);
CREATE INDEX idx_campaigns_org_id   ON campaigns(org_id);
CREATE INDEX idx_properties_org_id  ON properties(org_id);
```

Also add `org_id` to the SQLAlchemy model classes in Python.

### 3.4 Update Agent Model

Add to `Agent`:
```python
org_id: Mapped[str | None] = mapped_column(String, ForeignKey("organizations.id"), nullable=True, index=True)
role: Mapped[str] = mapped_column(
    SAEnum("super_admin", "org_admin", "manager", "agent", "call_agent", name="agent_role"),
    default="agent"
)
organization = relationship("Organization", back_populates="agents")
```

> [VERIFY: Check existing `Agent` model for current role enum values. Rename "admin" → "org_admin" carefully — update all role checks in codebase.]

### 3.5 Query Scoping Middleware

Create a dependency: `backend/app/core/tenant.py`

```python
# Every protected endpoint injects this dependency
async def get_org_scope(current_agent = Depends(get_current_agent)) -> str | None:
    if current_agent.role == "super_admin":
        return None  # No filter — sees everything
    return current_agent.org_id

# Usage in any router:
async def list_leads(org_id = Depends(get_org_scope), db = Depends(get_db)):
    query = select(Lead)
    if org_id:
        query = query.where(Lead.org_id == org_id)
    ...
```

**Every single DB query must use this pattern.** No exceptions. Missing this on one endpoint = data leak.

### 3.6 Super Admin Dashboard

New page: `/super-admin` — only accessible to `super_admin` role.

```
┌─────────────────────────────────────────────┐
│ Propello CRM — Owner Dashboard              │
│                                             │
│ Organizations (4)          [+ New Org]      │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ Prestige Realty      Pro    12 agents   │ │
│ │ Last active: 2h ago        [View] [Edit]│ │
│ ├─────────────────────────────────────────┤ │
│ │ DLF Mumbai           Basic   5 agents   │ │
│ │ Last active: 1d ago        [View] [Edit]│ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ Platform Stats                              │
│ Total leads: 4,821  |  Orgs: 4  |  Agents: 43│
└─────────────────────────────────────────────┘
```

When `super_admin` clicks **View** on an org → switches context into that org's dashboard (impersonation mode, read-only). Banner at top: "Viewing as: Prestige Realty [Exit]".

### 3.7 Login Flow Changes

Login page additions:
- After successful auth, JWT contains `org_id` + `role`
- If `super_admin` → redirect to `/super-admin`
- If any other role → redirect to org's dashboard (`/`)
- No org selector on login page — org is determined by agent's account

### 3.8 Data Migration for Existing Data

```python
# One-time migration script: backend/scripts/migrate_existing_data_to_org.py
# 1. Create a default org: "Default Organization"
# 2. Set org_id = default_org.id on ALL existing rows in all tables
# 3. Set org_id on all existing agents
# Run ONCE after deploying the migration
```

---

## 4. Feature 1 — UI/UX Consistency Overhaul

### 4.1 Root Problem (Confirmed from Code)

From `PageContents.tsx`:
- `priorityColor` maps `task.priority` (high/normal/low) to colors
- Lead priority (`lead_score`: hot/warm/cold) has different color logic in different components
- No shared badge components — every component defines its own inline styles
- Hardcoded hex colors (`#1f1914`, `#7a7065`, `#faf5ee`) scattered across 581 lines

### 4.2 Design Token File

Create: `frontend/lib/design-tokens.ts`

```typescript
export const priorityColors = {
  // Task priority (high/normal/low)
  task: {
    high:   { badge: 'text-red-700 bg-red-50 border border-red-200',    dot: 'bg-red-500'    },
    normal: { badge: 'text-amber-700 bg-amber-50 border border-amber-200', dot: 'bg-amber-400' },
    low:    { badge: 'text-blue-700 bg-blue-50 border border-blue-200',  dot: 'bg-blue-400'   },
  },
  // Lead score (hot/warm/cold) — used on lead cards, kanban, task cards
  lead: {
    hot:  { border: 'border-l-red-500',    badge: 'text-red-700 bg-red-50 border border-red-200',    dot: 'bg-red-500'    },
    warm: { border: 'border-l-orange-400', badge: 'text-orange-700 bg-orange-50 border border-orange-200', dot: 'bg-orange-400' },
    cold: { border: 'border-l-blue-400',   badge: 'text-blue-700 bg-blue-50 border border-blue-200',  dot: 'bg-blue-400'   },
  },
}

export const taskStatusColors = {
  pending:   'bg-amber-100 text-amber-800',
  done:      'bg-emerald-100 text-emerald-700',
  overdue:   'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

export const leadStageColors: Record<string, string> = {
  new:                    'bg-purple-100 text-purple-700',
  contacted:              'bg-blue-100 text-blue-700',
  site_visit_scheduled:   'bg-yellow-100 text-yellow-800',
  site_visit_done:        'bg-indigo-100 text-indigo-700',
  negotiation:            'bg-orange-100 text-orange-700',
  won:                    'bg-emerald-100 text-emerald-700',
  lost:                   'bg-red-100 text-red-700',
  nurture:                'bg-gray-100 text-gray-600',
}

// Minimum tap target for mobile (WCAG AA)
export const TAP_TARGET = 'min-h-[48px]'
```

### 4.3 Shared Components to Standardize

All in `frontend/components/shared/`. Create if missing, standardize if exists.

**`<LeadScoreBadge score="hot|warm|cold" />`**
Uses `priorityColors.lead.badge`. Replaces all inline lead score styling.

**`<TaskStatusBadge status="pending|done|overdue|cancelled" />`**
Uses `taskStatusColors`. Single component used everywhere.

**`<LeadStageBadge stage="new|contacted|..." />`**
Uses `leadStageColors`.

**`<TaskCard task={task} onDone={fn} onCall={fn} showLead={bool} />`**
Mobile-optimized card. Used on tasks page AND lead detail.
- Left border = lead score color (4px)
- Shows: lead name, task type icon + title, due time in plain language, Call + Done buttons

**`<BottomSheet open={bool} onClose={fn} title="">`**
Wrapper for mobile sheets. On mobile: slides from bottom. On desktop: centered modal.
`UnifiedTaskCompletionSheet` should use this as its container.

**`<Chip label="" selected={bool} onClick={fn} size="sm|md" />`**
Tap chip. Single + multi-select variants. Used in forms and filters.

**`<EmptyState icon="" title="" subtitle="" />`**
Replaces all inline "No tasks" empty states.

**`<PageHeader title="" subtitle="" actions={ReactNode} />`**
Consistent top of every page. Handles mobile vs desktop spacing.

### 4.4 Split PageContents.tsx

`PageContents.tsx` is 581 lines containing multiple page components. Split into:

```
frontend/components/pages/
  TasksPageContent.tsx     ← extract TasksPageContent + TaskEditModal
  ContactsPageContent.tsx  ← extract ContactsPageContent
  PropertiesPageContent.tsx
  VisitsPageContent.tsx
  PageContents.tsx         ← re-export all (keeps imports working)
```

### 4.5 Tasks Page — Desktop Table Fix

The current table layout stays for desktop. Fix only these issues:
- Replace inline `priorityColor` Record with `priorityColors.task` from design tokens
- Replace inline status badge styles with `<TaskStatusBadge />`
- Replace "Done" button style — use consistent green button from shared tokens
- Add lead score colored dot next to task title (pull from `task.lead.lead_score`)

---

## 5. Feature 2 — Mobile-First UI for call_agent

### 5.1 Scope
`call_agent` role, mobile viewport (< 768px). Must not affect desktop or other roles.

Detection: `useIsMobile()` hook already exists. Role: `useAuthStore().agent.role`.

Condition: `isMobile && agent.role === 'call_agent'`

### 5.2 Bottom Navigation

Add to `frontend/app/layout.tsx` — render only when `isMobile && role === 'call_agent'`:

```tsx
// Tabs
[{ icon: ClipboardList, label: 'Tasks',     href: '/tasks'     },
 { icon: Users,         label: 'My Leads',  href: '/leads'     },
 { icon: Bell,          label: 'Alerts',    href: '/notifications', badge: unreadCount },
 { icon: User,          label: 'Me',        href: '/me'        }]
```

Active tab: brand color icon + label. Inactive: gray.
Bottom padding on `<main>`: add `pb-20` when bottom nav is showing so content isn't hidden.

**Hide sidebar** when `isMobile && role === 'call_agent'` — sidebar renders `null`.

### 5.3 Tasks Page — Mobile Card Layout

In `TasksPageContent` (after splitting), detect `isMobile && role === 'call_agent'`:

**Replace the `<table>` with card list:**

```tsx
// Mobile card list — replaces table entirely
<div className="space-y-3 px-4">
  {tasks.map(task => (
    <TaskCard
      key={task.id}
      task={task}
      onDone={() => setCompletingTask(task)}
      onCall={() => window.location.href = `tel:${task.lead?.contact?.phone}`}
      showLead={true}
    />
  ))}
</div>
```

**`<TaskCard />` layout:**
```
┌─────────────────────────────────────────┐
▌  🔴 HOT · Rahul Sharma                 ▌  ← 4px left border (lead score color)
▌  📞 Call Follow-up                      ▌
▌  ⏰ Today · 3:00 PM                     ▌
▌                                         ▌
▌  [📞 Call Now]      [✅ Mark Done]      ▌
└─────────────────────────────────────────┘
```

- Left border: `lead.lead_score` color (hot=red, warm=orange, cold=blue)
- Due time: plain language — "Today 3pm", "Tomorrow 9am", "⚠️ Overdue · 2 days ago"
- Call Now: `tel:` href — opens dialer
- Mark Done: opens `UnifiedTaskCompletionSheet` (existing component, to be upgraded per Feature 3)
- Minimum button height: 48px

**Header — mobile:**
```
Tasks (12 pending)
[All]  [Pending]  [Done]
```
Chips replace the current pill tabs. Remove the assignee filter dropdown for `call_agent` (they only see own tasks).

### 5.4 My Leads — Mobile

On `/leads` for `call_agent` on mobile — render list view, skip Kanban:

```
┌─────────────────────────────────────────┐
▌  🔴  Rahul Sharma                       ▌
▌  📞 98XXXXXX89  |  Stage: Contacted     ▌
▌  Last contact: 3 days ago               ▌
└─────────────────────────────────────────┘
```

Filter: own assigned leads only (already implemented via `params.assigned_to = agent.id`).

### 5.5 Lead Detail — Mobile (call_agent)

On `/leads/[id]`, when `isMobile && role === 'call_agent'`, render simplified view:

```
[← Back]           Rahul Sharma
─────────────────────────────
📞 98XXXXXX89             [Call]
🔴 HOT  |  Contacted
─────────────────────────────
👤 Profile
  Age: 34  |  Salaried
  Family: 4  |  Budget: 40–70L
  Location: Noida
  ████████░░  80%
─────────────────────────────
📋 Pending Tasks (2)
  [TaskCard components here]
─────────────────────────────
📝 Recent Activity (last 3)
  [see all →]
```

Profile data from `lead.master_profile`. Completeness % = filled keys / 7 expected keys × 100.

### 5.6 Me Tab — /me (New Page)

Create `frontend/app/me/page.tsx` — only for `call_agent` on mobile.

```
👤 Raju Kumar  ·  Call Agent
   Prestige Realty            ← org name

Today
  ✅ Tasks done: 8 / 15
  📞 Calls made: 12
  🔥 Hot leads: 4

This Week
  Tasks completed: 43
  Connection rate: 72%

[Sign Out]
```

Data from: tasks filtered by `assigned_to=me` + `completed_at >= today`.

---

## 6. Feature 3 — Smart Task Completion Form

### 6.1 Key Finding from Code

`UnifiedTaskCompletionSheet` is already a **4-step form** at `frontend/components/tasks/UnifiedTaskCompletionSheet.tsx`.
It already calls `tasksApi.completeWithRemark()` and `leadsApi.updateMasterProfile()`.

**DO NOT rebuild it.** Fix the 4 specific bugs below only.

Call signature stays exactly the same:
```tsx
<UnifiedTaskCompletionSheet
  task={completingTask}
  lead={completingTask.lead ?? null}
  onClose={() => setCompletingTask(null)}
  onComplete={() => { ... }}
/>
```

### 6.2 Current 4-Step Structure

| Step | Name | Status |
|---|---|---|
| 1 | Call Details (call status, interest, topics) | ✅ Working |
| 2 | Customer Profile (age, occupation, family, income, budget, location, timeline, living, investment) | ⚠️ Bug: forces all fields |
| 3 | Lead Edit (contact name, phone, email) | ✅ Working — but missing follow-up UI |
| 4 | Confirm & Submit | ✅ Working |

### 6.3 Bug Fixes Required

#### Bug 1 — Step 2 forces ALL demographic fields (critical UX bug)

**Current broken code (in the Next button handler, step === 2 branch):**
```tsx
const required = [age, occupation, familySize, income, budget, preferredLocation, timeline, livingSituation, investmentPurpose]
if (required.some(v => v === null || v === '')) {
  toast.error("Please answer all customer profile questions...")
  return
}
```

**Fix — delete this validation block entirely.** Replace with just:
```tsx
setStep(s => s + 1)
```

No demographic field is required. "Don't Know" is valid. Only Q1 (call status on Step 1) is required.

#### Bug 2 — Follow-up scheduling has state but no UI

`followupOption`, `followupDate`, `followupTime`, `getNextFollowupDate()`, and `FOLLOWUP_OPTIONS` all exist but are never rendered. The confirm step references `followupOption` in the summary but it's always null.

**Fix — add follow-up UI at the TOP of Step 3, before the existing lead edit section:**

```tsx
{step === 3 && (
  <div className="space-y-5">
    {/* NEW: Follow-up section */}
    <div>
      <p className="text-sm font-semibold text-[#1f1914] mb-2">Schedule next follow-up</p>
      <div className="flex flex-wrap gap-2">
        {FOLLOWUP_OPTIONS.map(opt => (
          <SelectChip
            key={opt.value}
            label={opt.label}
            selected={followupOption === opt.value}
            onClick={() => setFollowupOption(opt.value === followupOption ? null : opt.value)}
          />
        ))}
      </div>
      {/* Custom date picker if no quick option selected */}
      {!followupOption && (
        <div className="flex gap-2 mt-3">
          <input type="date" value={followupDate} onChange={e => setFollowupDate(e.target.value)}
            className="flex-1 px-3 py-2 border border-[#e1d3c2] rounded-xl text-sm" />
          <input type="time" value={followupTime} onChange={e => setFollowupTime(e.target.value)}
            className="w-28 px-3 py-2 border border-[#e1d3c2] rounded-xl text-sm" />
        </div>
      )}
    </div>

    {/* NEW: Additional note */}
    <div>
      <p className="text-sm font-semibold text-[#1f1914] mb-2">Additional note (optional)</p>
      <textarea
        value={remarkText}
        onChange={e => setRemarkText(e.target.value)}
        maxLength={300}
        placeholder="Anything else to remember..."
        rows={3}
        className="w-full px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-[#fefcfa] focus:outline-none focus:border-[#c86f43]"
      />
    </div>

    {/* EXISTING: Lead edit section — keep as-is below */}
    {!showLeadEdit
      ? <Step3LeadEdit ... />
      : <Step3LeadEditForm ... />
    }
  </div>
)}
```

**Also add smart pre-fill on step change:**
```tsx
useEffect(() => {
  if (step === 3 && followupOption === null) {
    if (interest === 'hot') setFollowupOption('tomorrow_morning')
    else if (interest === 'warm') setFollowupOption('3_days')
    else if (interest === 'cold') setFollowupOption('1_week')
    else if (callStatus !== 'connected') setFollowupOption('tomorrow_morning')
  }
}, [step])
```

#### Bug 3 — 80-char remark padding hack

**Current frontend hack:**
```tsx
// Pad remark_text to 80 chars if needed (backend requires min_length=80)
const MIN_CHARS = 80
const paddedRemark = remark_text.length >= MIN_CHARS
  ? remark_text
  : remark_text + ' [Task completed via mobile form]'
```

**Fix on backend first:** Find the schema handling `tasksApi.completeWithRemark` — look in `backend/app/schemas/` and `backend/app/routers/routers.py` for `remark_text` field with `min_length=80`. Remove that constraint.

**Then remove the frontend hack** — delete `MIN_CHARS`, `paddedRemark`, use `remark_text` directly.

#### Bug 4 — Field name mismatch (verify before fixing)

The component reads `lead?.property_budget` but `lead.py` has no `property_budget` column. Check `frontend/lib/types.ts`:
- If `Lead` type has `property_budget` as a field → check what the backend actually returns in the lead API response
- The `master_profile` JSON uses `budget_bracket` as the key
- Align field names so budget pre-populates correctly

### 6.4 Form Behavior Rules (unchanged — already correct)

| Rule | Status |
|---|---|
| Q1 required to proceed | ✅ Already enforced |
| Cannot dismiss without submitting | ✅ X only on Step 1 |
| Pre-populate from lead | ✅ Already works for most fields |
| All Step 2 fields optional | ❌ Fix Bug 1 |
| Follow-up shown and pre-filled | ❌ Fix Bug 2 |
| No padding hack | ❌ Fix Bug 3 |

---

## 7. Feature 4 — Lead Demographic Profile Sync

### 7.1 No New DB Columns Needed

All existing fields are sufficient:

**On Lead (existing, update these):**
- `lead_score` ← from Q2
- `budget_min`, `budget_max` ← from Q8 bracket
- `location_preference` ← from Q9
- `timeline` ← from Q10
- `last_remark` ← from Q12 note
- `last_interaction_at` ← set to now
- `call_count` ← increment on every connected call
- `master_profile: JSON` ← main demographic store (merge, never replace)

**On Task (existing, update these):**
- `completion_remark` ← Q12 note (append with timestamp)
- `completion_tags: JSON` ← `{call_status, interest_level, topics, demographics_keys_updated}`
- `remark_quality_score` ← auto-calculate
- `remark_quality_feedback` ← auto-generate
- `completed_at` ← now
- `status` ← "done"

### 7.2 master_profile Schema

```python
# backend/app/schemas/master_profile.py  ← CREATE

class MasterProfile(TypedDict, total=False):
    age_range: str
    occupation: str
    occupation_other: str
    family_size: str
    income_range: str
    budget_bracket: str
    preferred_location: str
    purchase_timeline: str
    last_call_status: str
    last_call_topics: list
    last_call_interest: str
    profile_updated_at: str   # ISO timestamp
    profile_updated_by: str   # agent_id
    completeness_score: int   # 0-100

EXPECTED_DEMOGRAPHIC_KEYS = [
    "age_range", "occupation", "family_size",
    "income_range", "budget_bracket",
    "preferred_location", "purchase_timeline"
]
# completeness_score = len(filled keys from above) / 7 * 100
```

### 7.3 Service Logic

New file: `backend/app/services/demographic_service.py`

```
Function: update_lead_from_task_completion(task_id, agent_id, org_id, payload)

1. Validate task belongs to this org (org_id check)
2. Mark task done: status="done", completed_at=now
3. Set completion_tags = {call_status, interest_level, topics, ...}
4. Merge demographics into master_profile (never overwrite with "unknown")
5. Update lead columns: lead_score, budget_min/max, location_preference, timeline, last_remark, last_interaction_at, call_count++
6. Calculate completeness_score → store in master_profile
7. Calculate remark_quality_score → store on task
8. Create Activity (type=task_completion_remark, org_id=org_id)
9. If next_followup_at set → create new Task (org_id=org_id)
10. Return: {task, lead_fields_updated: [...], completeness_score, next_task_created}
```

### 7.4 Budget Bracket → DB Value Mapping

```python
BUDGET_TO_RANGE = {
    "under_20L":  (0,          2_000_000),
    "20L-40L":    (2_000_000,  4_000_000),
    "40L-70L":    (4_000_000,  7_000_000),
    "70L-1Cr":    (7_000_000,  10_000_000),
    "1Cr-2Cr":    (10_000_000, 20_000_000),
    "2Cr+":       (20_000_000, None),
}
```

---

## 8. Backend Changes Required

### 8.1 New Files to Create

```
backend/app/models/organization.py           ← Organization model
backend/app/routers/organizations.py         ← CRUD for super_admin
backend/app/schemas/task_complete.py         ← TaskCompleteRequest, response
backend/app/schemas/master_profile.py        ← MasterProfile TypedDict
backend/app/services/demographic_service.py ← update_lead_from_task_completion()
backend/app/core/tenant.py                   ← get_org_scope() dependency
backend/scripts/migrate_existing_data_to_org.py ← one-time data migration
backend/alembic/versions/add_org_id_to_all_tables.py ← migration
backend/alembic/versions/add_organization_table.py   ← migration
```

### 8.2 Modified Files

```
backend/app/models/lead.py         ← add org_id column
backend/app/models/models.py       ← add org_id to all models
backend/app/routers/routers.py     ← upgrade task complete endpoint + add org_scope
backend/app/routers/leads.py       ← add org_scope to all queries, add profile endpoint
backend/app/main.py                ← register new organization router
```

### 8.3 Modified/New Endpoints

#### `POST /api/tasks/{task_id}/complete` — Modified
Now accepts full structured payload. Calls `demographic_service.update_lead_from_task_completion()`.
Validates `task.org_id == current_user.org_id` before processing.

#### `GET /api/tasks/my` — Verify or create
Returns tasks for current agent only, sorted overdue → today → future.
`?status=pending|done|all`

#### `GET /api/leads/{lead_id}/profile` — New
Returns lead + contact + master_profile + last 5 activities + pending tasks.
Used by mobile lead detail.

#### `PATCH /api/leads/{lead_id}/master-profile` — New
Direct edit for org_admin/manager/agent. Blocked for call_agent (403).

#### `GET /api/organizations` — New (super_admin only)
Lists all organizations with stats.

#### `POST /api/organizations` — New (super_admin only)
Creates a new organization.

#### `GET /api/organizations/{org_id}/stats` — New (super_admin only)
Returns org-level stats: agent count, lead count, task completion rate.

#### `POST /api/organizations/{org_id}/impersonate` — New (super_admin only)
Returns a scoped JWT for that org (for impersonation/view mode). Read-only flag in token.

### 8.4 Auth Changes

Update JWT creation to include `org_id` and `is_super_admin` flag.
Update `get_current_agent` dependency to extract these.
All existing role checks: update "admin" → "org_admin" string comparisons.

---

## 9. API Contract

### TaskCompleteRequest

```python
# backend/app/schemas/task_complete.py

class DemographicsInput(BaseModel):
    age_range: Optional[str] = None
    occupation: Optional[str] = None
    occupation_other: Optional[str] = None
    family_size: Optional[str] = None
    income_range: Optional[str] = None
    budget_bracket: Optional[str] = None
    preferred_location: Optional[str] = None
    purchase_timeline: Optional[str] = None

class TaskCompleteRequest(BaseModel):
    call_status: Literal["connected", "no_answer", "wrong_number", "callback"]
    interest_level: Optional[Literal["hot", "warm", "cold", "unknown"]] = None
    topics_discussed: Optional[List[str]] = Field(default_factory=list)
    demographics: Optional[DemographicsInput] = None
    next_followup_at: Optional[datetime] = None
    note: Optional[str] = Field(None, max_length=300)

class TaskCompleteResponse(BaseModel):
    task_id: str
    status: str
    lead_fields_updated: List[str]
    next_task_created: bool
    completeness_score: int   # 0-100
```

### Valid Option Values

```python
CALL_STATUS     = ["connected", "no_answer", "wrong_number", "callback"]
INTEREST_LEVEL  = ["hot", "warm", "cold", "unknown"]
TOPICS          = ["price", "location", "flat_size", "loan", "site_visit", "other"]
AGE_RANGE       = ["under_20", "20-30", "30-40", "40-50", "50-60", "60+", "unknown"]
OCCUPATION      = ["salaried_private", "salaried_government", "self_employed",
                   "professional", "farmer", "student", "homemaker", "unknown", "other"]
FAMILY_SIZE     = ["1-2", "3-4", "5-6", "6+", "unknown"]
INCOME_RANGE    = ["under_20000", "20000-40000", "40000-75000",
                   "75000-150000", "150000+", "unknown"]
BUDGET_BRACKET  = ["under_20L", "20L-40L", "40L-70L", "70L-1Cr",
                   "1Cr-2Cr", "2Cr+", "unknown"]
TIMELINE        = ["immediately", "soon", "later", "exploring", "unknown"]
```

---

## 10. Implementation Order

> **Do NOT skip steps or do them out of order. Each step depends on the previous.**

```
PHASE 1 — Foundation (do first, everything depends on this)
  Step 1: Create Organization model + migration
  Step 2: Add org_id to all existing models + migration
  Step 3: Run data migration script (assign all existing data to default org)
  Step 4: Update Agent model (add org_id, update role enum)
  Step 5: Create tenant.py (get_org_scope dependency)
  Step 6: Update ALL existing query endpoints to use org_scope
  Step 7: Update JWT to include org_id + is_super_admin
  Step 8: Update all role string checks "admin" → "org_admin"

PHASE 2 — Super Admin
  Step 9: Organization CRUD endpoints
  Step 10: Super admin dashboard page (/super-admin)
  Step 11: Impersonation endpoint + banner UI

PHASE 3 — UI Consistency
  Step 12: Create design-tokens.ts
  Step 13: Create/standardize shared components (badges, TaskCard, BottomSheet, Chip)
  Step 14: Split PageContents.tsx
  Step 15: Update desktop tasks table to use design tokens

PHASE 4 — Mobile UX
  Step 16: Bottom nav for call_agent mobile
  Step 17: Mobile task card list view
  Step 18: Mobile lead detail view
  Step 19: Create /me page

PHASE 5 — Task Completion + Demographics
  Step 20: Create task_complete.py schema + master_profile.py schema
  Step 21: Create demographic_service.py
  Step 22: Upgrade POST /tasks/{id}/complete endpoint
  Step 23: Upgrade UnifiedTaskCompletionSheet internals (3-step form)
  Step 24: Add profile completeness bar to lead cards
```

---

## 11. Open Questions

| # | Question | Impact | Owner |
|---|---|---|---|
| 1 | What is the current role string for "admin" in the Agent model? "admin" or "org_admin"? | All role checks in codebase | [FIND in Agent model + all routers] |
| 2 | Should `super_admin` accounts be stored in the agents table with `org_id=null`? Or a separate table? | Auth architecture | Shardul |
| 3 | When super_admin creates a new org — does it auto-create an org_admin account? Or manually? | Onboarding flow | Shardul |
| 4 | Should "Wrong Number" auto-update lead stage to a special status or flag DND? | Lead lifecycle | Shardul |
| 5 | ✅ RESOLVED — `UnifiedTaskCompletionSheet` calls `tasksApi.completeWithRemark()`. Find this in `frontend/lib/api.ts` to see the exact endpoint URL. | — | — |
| 6 | Is there a `/me` route or profile page already? | Feature 2 step 19 | [CHECK frontend/app/] |

---

## 12. Proactive Suggestions

### 12.1 Org-Level Plan Limits
`Organization.max_agents` field already in the model. Enforce on agent creation — if org has hit `max_agents`, block new agent registration. Shows orgs on upgrade path naturally.

### 12.2 Remark Quality Already Modeled
`remark_quality_score` and `remark_quality_feedback` already on `Task`. Use them immediately:
- 0 fields collected → score 0.0, feedback "Minimal"
- 1-2 fields → 0.3, "Basic"
- 3-5 fields → 0.65, "Good"
- 6-7 fields → 1.0, "Excellent"

Powers manager performance view with zero extra DB work.

### 12.3 Profile Completeness Bar on Lead Cards
One line per card. Sourced from `master_profile.completeness_score`:
- 0-30% → red bar
- 30-70% → orange bar
- 70-100% → green bar

### 12.4 Call Now Auto-Log
When agent taps Call Now on a task card, fire a background API call to create an Activity:
`type="call"`, `outcome="dialing"`, `performed_at=now`.
1 API call. Gives managers full call attempt visibility.

### 12.5 Org Slug for Future Subdomain Support
`Organization.slug` is already in the model. Even though v1 uses same URL, the slug enables future subdomain routing (`prestige.propellocrm.com`) with zero DB changes.

---

## 13. Out of Scope for v1

- Subdomain per organization
- WhatsApp integration from task card
- Voice input / speech-to-text
- AI call summaries (Groq is configured but not in this PRD)
- Offline / PWA mode
- Mobile redesign of Kanban, Campaigns, Analytics, Staff pages
- Manager mobile dashboard
- Billing / payment for org plans
- Org self-signup (orgs created by super_admin only for now)

---

## Appendix A — Confirmed File Map

| What | Path | Action |
|---|---|---|
| Lead model | `backend/app/models/lead.py` | Add `org_id` column |
| All other models | `backend/app/models/models.py` | Add `org_id` to all |
| **New:** Organization model | `backend/app/models/organization.py` | CREATE |
| **New:** Schemas | `backend/app/schemas/task_complete.py` | CREATE |
| **New:** Schemas | `backend/app/schemas/master_profile.py` | CREATE |
| **New:** Service | `backend/app/services/demographic_service.py` | CREATE |
| **New:** Tenant scope | `backend/app/core/tenant.py` | CREATE |
| **New:** Org router | `backend/app/routers/organizations.py` | CREATE |
| Task endpoint | `backend/app/routers/routers.py` | Modify complete endpoint |
| Lead endpoints | `backend/app/routers/leads.py` | Add org_scope + profile endpoint |
| App bootstrap | `backend/app/main.py` | Register org router |
| Alembic | `backend/alembic/versions/` | 2 new migration files |
| **Tasks page (entry)** | `frontend/app/tasks/page.tsx` | Do not touch (1 line) |
| **Tasks page (actual)** | `frontend/components/pages/PageContents.tsx` | Split + modify |
| **Existing completion sheet** | `frontend/components/tasks/UnifiedTaskCompletionSheet.tsx` | Upgrade internals |
| Task components | `frontend/components/tasks/` | Add TaskCard |
| Shared components | `frontend/components/shared/` | Add badges, BottomSheet, Chip |
| **New:** Design tokens | `frontend/lib/design-tokens.ts` | CREATE |
| Global layout | `frontend/app/layout.tsx` | Add bottom nav logic |
| **New:** Me page | `frontend/app/me/page.tsx` | CREATE |
| **New:** Super admin page | `frontend/app/super-admin/page.tsx` | CREATE |
| API client | `frontend/lib/api.ts` | Add new endpoints |
| Auth store | `frontend/store/useAuthStore.ts` | Add org_id + is_super_admin |
| Mobile header | `frontend/components/mobile/MobileHeader.tsx` | Already exists |
| isMobile hook | `frontend/hooks/useIsMobile.ts` | Already exists |

---

## Appendix B — Existing Fields Reference

### Lead — existing columns (do not re-add)
```
lead_score:          "hot"|"warm"|"cold"    ← UPDATE from Q2
budget_min:          Numeric(15,2)          ← UPDATE from Q8
budget_max:          Numeric(15,2)          ← UPDATE from Q8
location_preference: String(200)            ← UPDATE from Q9
timeline:            String(50)             ← UPDATE from Q10
last_remark:         String(200)            ← UPDATE from Q12
last_interaction_at: DateTime               ← SET to now on submit
call_count:          Integer                ← INCREMENT on connected call
master_profile:      JSON                   ← MERGE demographics here
priority:            "P1"|"P2"|"P3"|"P4"|"P5"|"high"|"normal"|"low"
stage:               "new"|"contacted"|"site_visit_scheduled"|...
priya_memory_brief:  Text                   ← DO NOT TOUCH (Priya AI)
ai_analysis:         JSON                   ← DO NOT TOUCH (AI engine)
```

### Task — existing columns (do not re-add)
```
completion_remark:       Text            ← Q12 note, append format
completion_tags:         JSON            ← {call_status, interest_level, topics, ...}
remark_quality_score:    Numeric(4,2)    ← auto-calculate on submit
remark_quality_feedback: Text            ← auto-generate on submit
completed_at:            DateTime        ← set on submit
status:                  "pending"|"done"|"overdue"|"cancelled"
task_type:               "call"|"whatsapp"|"email"|"site_visit"|"document"|"other"
```

### Activity types — use existing enum values
```
"task_completed"           ← when task is marked done
"task_completion_remark"   ← detailed form submission record (USE THIS)
"call"                     ← for Call Now auto-log
```

### Frontend — already exists (do not rebuild)
```
UnifiedTaskCompletionSheet   ← upgrade internals only
MobileHeader                 ← already exists
useIsMobile hook             ← already exists
useAuthStore                 ← add org_id field
useAllTasks hook             ← already exists
tasksApi, authApi, etc.      ← add new methods
```
