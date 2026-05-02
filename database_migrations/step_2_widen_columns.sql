-- =============================================================================
-- STEP 2 — Fix Truncation-Prone Columns
-- Risk: LOW — only widens columns, never narrows. Existing data unaffected.
-- App code unaffected. Safe to run during live traffic.
-- =============================================================================

-- campaign_leads: various VARCHAR fields that may get long values
-- Widening to prevent truncation crashes similar to call_eval_tag

ALTER TABLE campaign_leads
ALTER COLUMN call_eval_tag TYPE VARCHAR(100);

ALTER TABLE campaign_leads
ALTER COLUMN priority_tier TYPE VARCHAR(50);

ALTER TABLE campaign_leads
ALTER COLUMN intent_level TYPE VARCHAR(50);

ALTER TABLE campaign_leads
ALTER COLUMN engagement_quality TYPE VARCHAR(50);

ALTER TABLE campaign_leads
ALTER COLUMN drop_reason TYPE VARCHAR(200);

ALTER TABLE campaign_leads
ALTER COLUMN objection_type TYPE VARCHAR(100);

ALTER TABLE campaign_leads
ALTER COLUMN recommended_action TYPE VARCHAR(200);

ALTER TABLE campaign_leads
ALTER COLUMN config_interest TYPE VARCHAR(100);

ALTER TABLE campaign_leads
ALTER COLUMN budget_signal TYPE VARCHAR(100);

ALTER TABLE campaign_leads
ALTER COLUMN language_preference TYPE VARCHAR(50);

ALTER TABLE campaign_leads
ALTER COLUMN site_visit_timeframe TYPE VARCHAR(100);

ALTER TABLE campaign_leads
ALTER COLUMN retry_time_recommendation TYPE VARCHAR(100);

ALTER TABLE campaign_leads
ALTER COLUMN transcript_depth TYPE VARCHAR(50);

ALTER TABLE campaign_leads
ALTER COLUMN user_engagement_ratio TYPE VARCHAR(50);

ALTER TABLE campaign_leads
ALTER COLUMN action_taken TYPE VARCHAR(200);

-- Verify: Check column types in Supabase table editor
-- SELECT column_name, data_type, character_maximum_length
-- FROM information_schema.columns
-- WHERE table_name = 'campaign_leads'
-- ORDER BY column_name;
