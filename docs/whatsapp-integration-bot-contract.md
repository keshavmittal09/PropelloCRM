# WhatsApp Bot ↔ PropelloCRM Integration — Bot-Side Contract

**Audience:** Engineer working on the `kartikagg19/Whatsapp-agent` repo (the DreamHome WhatsApp bot).
**This doc is the spec for the PR you need to open on that repo.** No bot-side code has been written yet — the CRM-side endpoints are live.

---

## 1. Why this PR exists

PropelloCRM has just gained five `/api/whatsapp/*` endpoints that let the CRM trigger WhatsApp messages and receive conversation events back. The bot needs three small changes to use them:

1. Accept authenticated trigger requests from CRM (so the CRM can ask the bot to send a message to a lead).
2. After every inbound WhatsApp message, sync the conversation back to CRM so it appears on the lead's timeline.
3. Optionally pull lead context from CRM before the AI replies (improves response quality).

All CRM endpoints already exist. They are documented in §4.

---

## 2. New env vars on the bot

Add these to the bot's `.env` (and to its Render dashboard for production):

```env
# CRM integration
CRM_BASE_URL=https://propellocrm.onrender.com
CRM_WEBHOOK_SECRET=<must match the CRM's WHATSAPP_WEBHOOK_SECRET exactly>
CRM_TIMEOUT_MS=10000
```

`CRM_WEBHOOK_SECRET` is also used to **verify** inbound requests from CRM (auth on `/api/send`) — same value used for both directions.

---

## 3. Bot-side changes

### 3.1 Extend `POST /api/send` to accept CRM trigger payloads

**Current state** (`backend/src/routes/admin.js`, line 95): the endpoint exists but is unauthenticated and only takes `{phone, message}`.

**Required changes**:

| Concern | Change |
|---------|--------|
| Auth | Require `X-Webhook-Secret` header. If missing or `!== process.env.CRM_WEBHOOK_SECRET`, return 403. (Keep the existing dashboard caller working by also accepting requests from the dashboard's same-origin path — or, simpler, route the dashboard through a new `/api/dashboard/send` so `/api/send` becomes service-only.) |
| Payload | Accept `{ phone, message, call_id, template }`. `phone` and `message` are required; `call_id` and `template` are optional but should be persisted. |
| Idempotency | Cache `call_id` in memory (or in Supabase) for ~24h. If the same `call_id` comes in twice, return `{success: true, deduped: true}` without resending. |
| Logging | When saving the outbound message via `db.saveMessage(...)`, include `call_id` and `template` in a meta column or message prefix so it's visible in the dashboard chat history. |
| Response | On success → `200 {success: true}`. On Meta API failure → `200 {success: false, error: "..."}` (do not 500; CRM tolerates `success:false`). |

**Why**: CRM's `handle_trigger` calls `POST {CRM_BASE_URL}/api/send` with that exact payload and the secret header. Without auth, anyone on the internet who finds the bot URL can send WhatsApp messages on your business account.

### 3.2 Webhook handler: notify CRM after every AI turn

**Current state** (`backend/src/routes/webhook.js`, the `router.post('/')` handler): processes inbound WhatsApp messages, calls Gemini, sends a reply, saves both to Supabase. **It does not tell CRM anything.**

**Required additions** (do them *after* `await sendText(...)` so a CRM failure doesn't break the reply):

```js
// 1) Sync the INBOUND user message
fireAndForget(() => syncCrmTimeline({
  phone,
  direction: 'inbound',
  message: text,
  call_id: `wa-in-${msg.messageId}`,
  occurred_at: new Date().toISOString(),
}));

// 2) Sync the OUTBOUND AI reply (with intent/score/escalation signal)
fireAndForget(() => syncCrmTimeline({
  phone,
  direction: 'outbound',
  message: ai.reply_message,
  call_id: `wa-out-${msg.messageId}`,
  ai_score: ai.lead_score ? ai.lead_score * 10 : null,   // bot uses 1-10, CRM expects 0-100
  intent: ai.qualification_stage || null,
  qualified: !!ai.qualified,
  summary: ai.summary || null,
  profile_patch: {
    budget_range: ai.budget_range || null,
    intent: ai.intent || null,
  },
  // CRM auto-escalates when ai_score >= 70; explicit `escalate: true` also works.
}));
```

`fireAndForget` should swallow errors and log them — **never block the WhatsApp reply on CRM availability** (PRD: "no bot request should break CRM or block bot").

Helper:

```js
async function syncCrmTimeline(payload) {
  const url = `${process.env.CRM_BASE_URL}/api/whatsapp/timeline`;
  await axios.post(url, payload, {
    headers: { 'X-Webhook-Secret': process.env.CRM_WEBHOOK_SECRET },
    timeout: parseInt(process.env.CRM_TIMEOUT_MS || '10000'),
  });
}
function fireAndForget(fn) {
  Promise.resolve().then(fn).catch(e => console.error('[CRM sync]', e?.message));
}
```

### 3.3 (Optional but recommended) Pull lead context before AI runs

Before calling `getAIReply(...)`, fetch CRM's lead context and pass it as additional system prompt material. This is what makes the bot *aware* that the lead has CRM history.

```js
let crmContext = null;
try {
  const r = await axios.get(`${process.env.CRM_BASE_URL}/api/whatsapp/context`, {
    params: { phone, call_id: msg.messageId },
    headers: { 'X-Webhook-Secret': process.env.CRM_WEBHOOK_SECRET },
    timeout: parseInt(process.env.CRM_TIMEOUT_MS || '10000'),
  });
  if (r.data?.found) crmContext = r.data;
} catch (e) {
  console.error('[CRM context]', e?.message);
  // continue without context — bot still works
}

const ai = await getAIReply(text, history, existingLead, crmContext);
```

`getAIReply` would need a small change to accept `crmContext` and, if present, include lines like:

> *Existing CRM lead: stage=site_visit_scheduled, last interaction 2d ago, assigned to Rohit. Master profile: budget ₹1.21Cr, 2BHK interest.*

Skip this section in v1 if you want a minimal PR.

---

## 4. CRM endpoints the bot will call

All require header `X-Webhook-Secret: <CRM_WEBHOOK_SECRET>`. All return HTTP 200 with a structured body, even on internal failures.

### `POST /api/whatsapp/timeline` — sync inbound/outbound messages

Used by §3.2. Idempotent on `(lead, call_id, direction)`.

```json
{
  "phone": "919876543210",
  "direction": "inbound",                // or "outbound"
  "message": "Yes I'm interested in 2BHK",
  "call_id": "wa-in-msgid-abc123",       // any stable string per event
  "occurred_at": "2026-05-17T10:30:00Z", // optional
  "ai_score": 75,                        // 0-100, optional. >=70 triggers escalation
  "intent": "2BHK",                      // optional
  "qualified": true,                     // optional
  "summary": "Wants Saturday site visit",// optional, stored as last_remark
  "profile_patch": {                     // optional, merged into master_profile (non-null only)
    "budget_range": "1.21-1.5Cr",
    "preferred_visit": "Saturday"
  },
  "escalate": false                      // optional explicit override
}
```

Response:
```json
{ "status": "ok", "lead_id": "...", "activity_id": "...", "task_id": "..." }
```

### `GET /api/whatsapp/context?phone=919876543210&call_id=optional`

Used by §3.3. Returns lead profile + last 10 activities, or `{found: false}` if no matching contact.

### `POST /api/whatsapp/trigger` — CRM-only

You don't call this from the bot. CRM calls itself / its own UI calls this to send a single message via the bot.

### `POST /api/whatsapp/bulk-trigger` — CRM-only

Same — bot doesn't call this.

### `POST /api/whatsapp/escalate` — optional

Only needed if you want to escalate **without** sending a message sync. R4's auto-escalation on `ai_score >= 70` covers most cases.

```json
{ "phone": "919876543210", "reason": "Hot lead, requested callback", "ai_score": 85 }
```

---

## 5. Acceptance checklist for the PR

- [ ] `POST /api/send` rejects requests without `X-Webhook-Secret` (returns 403).
- [ ] `POST /api/send` accepts new fields `call_id`, `template`.
- [ ] Same `call_id` sent twice within 24h does not re-send to Meta.
- [ ] After each inbound WhatsApp message, CRM `/api/whatsapp/timeline` is called twice (once inbound, once outbound).
- [ ] Bot stays up and replies even if `CRM_BASE_URL` is unreachable (errors logged, not raised).
- [ ] `CRM_WEBHOOK_SECRET` exists in `.env.example` (no value).
- [ ] README updated to mention CRM integration.

---

## 6. Local end-to-end test

Run both services locally:

```bash
# Terminal 1 — CRM
cd propello-crm/backend
export WHATSAPP_WEBHOOK_SECRET="test-secret-123"
export WHATSAPP_BOT_BASE_URL="http://localhost:3000"
uvicorn app.main:app --reload --port 8000

# Terminal 2 — Bot
cd Whatsapp-agent/backend
export CRM_BASE_URL="http://localhost:8000"
export CRM_WEBHOOK_SECRET="test-secret-123"
npm start
```

### Test 1: CRM → Bot trigger
```bash
curl -X POST http://localhost:8000/api/whatsapp/trigger \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: test-secret-123" \
  -d '{"phone":"919876543210","call_id":"t1","message":"Test from CRM"}'
```
**Expect**: CRM responds 200 with `status: ok`, bot logs a send attempt, Meta delivers the message (or fails gracefully if `WHATSAPP_TOKEN` is invalid).

### Test 2: Idempotency
Re-run Test 1. **Expect**: `status: skipped, detail: duplicate_within_dedupe_window`. No second Meta send.

### Test 3: Bot → CRM timeline sync
Send a real WhatsApp message to the bot. **Expect**: CRM logs show two `/api/whatsapp/timeline` calls; in the CRM UI, the lead's activity timeline now shows two new entries (`whatsapp_inbound`, `whatsapp_outbound`) with the messages and AI metadata.

### Test 4: Escalation
Manually invoke timeline with `ai_score: 85`:
```bash
curl -X POST http://localhost:8000/api/whatsapp/timeline \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: test-secret-123" \
  -d '{"phone":"919876543210","direction":"inbound","message":"I want to buy now","call_id":"t-hot","ai_score":85}'
```
**Expect**: response includes `task_id`, a new HOT-lead task appears in the CRM, and (if a lead is assigned) the assigned agent gets an in-app notification.

### Test 5: Auth
Drop the secret header on any call. **Expect**: 403.

---

## 7. Things explicitly out of scope for this PR

- Changing the dashboard UI — not needed; existing CRM lead-detail timeline renders any `Activity` row regardless of type.
- Migrating bot's Supabase tables — bot keeps its own DB for chat history / knowledge base.
- Schema changes on either side beyond CRM's 4 additive enum values (already applied via `init_db()`).

---

## 8. Rollout order (when you're ready)

1. Deploy CRM changes (already done locally, push when ready). CRM endpoints will be live but the bot doesn't know about them yet — no behaviour change.
2. Set `WHATSAPP_WEBHOOK_SECRET` and `WHATSAPP_BOT_BASE_URL` in Render's CRM service env. Restart.
3. Open and merge the bot PR. Set matching env vars in the bot's Render service. Restart.
4. Smoke test live with one real WhatsApp message.
5. Roll out bulk-trigger usage only after smoke test passes.
