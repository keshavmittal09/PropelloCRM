-- =============================================================================
-- STEP 5 — Fix Campaign Delete FK Constraint
-- Risk: LOW — changes cascade behavior, no data deleted.
-- Only affects DELETE operations (not SELECT/INSERT/UPDATE).
--
-- Problem: You cannot delete a campaign if activities reference it.
-- Postgres blocks with FK violation error.
--
-- Current behavior: activities.campaign_id → campaigns(id) with RESTRICT (blocks delete)
-- New behavior: Activities keep existing but campaign_id becomes NULL when campaign is deleted
-- =============================================================================

-- First, check current constraint
-- SELECT rc.delete_rule FROM information_schema.referential_constraints rc
-- WHERE rc.constraint_name = 'activities_campaign_id_fkey';

-- Drop old constraint
ALTER TABLE activities
DROP CONSTRAINT IF EXISTS activities_campaign_id_fkey;

-- Add new constraint with SET NULL on delete
ALTER TABLE activities
ADD CONSTRAINT activities_campaign_id_fkey
  FOREIGN KEY (campaign_id)
  REFERENCES campaigns(id)
  ON DELETE SET NULL;

-- Verify after:
-- SELECT rc.delete_rule FROM information_schema.referential_constraints rc
-- WHERE rc.constraint_name = 'activities_campaign_id_fkey';
-- Should return: SET NULL

-- Test (if you have a test campaign to delete):
-- Delete a test campaign. Should succeed. Activities for that campaign should
-- still exist with campaign_id = null.
