-- =============================================================================
-- STEP 4 — Add Missing Indexes
-- Risk: ZERO — adding indexes never changes data or query results, only speed.
-- Safe to run during live traffic. Each takes a few seconds on current data size.
-- =============================================================================

-- contacts.phone — used in every duplicate check during campaign ingestion
-- Note: May already exist if contact.py index was applied
CREATE INDEX IF NOT EXISTS idx_contacts_phone
ON contacts(phone);

-- leads.assigned_to — used in every agent's lead list query
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to
ON leads(assigned_to);

-- leads.stage — used in Kanban board queries
CREATE INDEX IF NOT EXISTS idx_leads_stage
ON leads(stage);

-- leads.lead_score — used in hot/warm/cold filtering
CREATE INDEX IF NOT EXISTS idx_leads_lead_score
ON leads(lead_score);

-- leads.updated_at — used in ORDER BY on almost every lead query
CREATE INDEX IF NOT EXISTS idx_leads_updated_at
ON leads(updated_at DESC);

-- tasks.assigned_to — used in every agent's task list
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to
ON tasks(assigned_to);

-- tasks.due_at — used in overdue sorting
CREATE INDEX IF NOT EXISTS idx_tasks_due_at
ON tasks(due_at);

-- tasks.status — used in pending/done filtering
CREATE INDEX IF NOT EXISTS idx_tasks_status
ON tasks(status);

-- tasks.lead_id — used in lead detail page task list
CREATE INDEX IF NOT EXISTS idx_tasks_lead_id
ON tasks(lead_id);

-- activities.lead_id — used in lead timeline
CREATE INDEX IF NOT EXISTS idx_activities_lead_id
ON activities(lead_id);

-- activities.performed_at — used in timeline ordering
CREATE INDEX IF NOT EXISTS idx_activities_performed_at
ON activities(performed_at DESC);

-- notifications.agent_id — used in every notification bell query
CREATE INDEX IF NOT EXISTS idx_notifications_agent_id
ON notifications(agent_id);

-- notifications.is_read — used in unread count badge
CREATE INDEX IF NOT EXISTS idx_notifications_is_read
ON notifications(agent_id, is_read);

-- Verify after: Pages should load noticeably faster. No functional change.
-- Check index existence:
-- SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;
