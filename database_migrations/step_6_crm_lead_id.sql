-- =============================================================================
-- STEP 6 — Add crm_lead_id Link to campaign_leads
-- Risk: ZERO — adding a nullable column. Existing data unaffected.
-- App code unaffected (new column, nothing reads it yet).
--
-- Problem: When a campaign lead is promoted to a CRM lead, there's no explicit
-- link between the two. The connection is implicit via phone number match — fragile.
-- =============================================================================

-- Add nullable crm_lead_id column with FK to leads table
ALTER TABLE campaign_leads
ADD COLUMN IF NOT EXISTS crm_lead_id VARCHAR;

-- Add foreign key constraint (SET NULL when CRM lead is deleted)
ALTER TABLE campaign_leads
ADD CONSTRAINT fk_campaign_leads_crm_lead_id
  FOREIGN KEY (crm_lead_id)
  REFERENCES leads(id)
  ON DELETE SET NULL;

-- Add index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_campaign_leads_crm_lead_id
ON campaign_leads(crm_lead_id);

-- Verify after: Check Supabase table editor — campaign_leads should have
-- a new nullable crm_lead_id column. App behavior: completely unchanged
-- (no code reads this yet).
--
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'campaign_leads' AND column_name = 'crm_lead_id';
