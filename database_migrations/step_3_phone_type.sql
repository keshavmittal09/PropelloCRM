-- =============================================================================
-- STEP 3 — Fix Phone Number Type Mismatch
-- Risk: LOW — type change with explicit cast, no data loss.
--
-- Problem: campaign_leads.phone_number is BIGINT. contacts.phone is VARCHAR(20).
-- The duplicate-check logic compares them — fragile and can cause silent mismatches.
--
-- VERIFY in campaign_service.py: Line 165-174 shows normalise_phone() returns string.
-- No arithmetic is performed on phone_number. Safe to convert.
-- =============================================================================

-- Safe cast: BIGINT → VARCHAR, all numbers convert cleanly
-- Using VARCHAR(25) to handle international numbers with + prefix
ALTER TABLE campaign_leads
ALTER COLUMN phone_number TYPE VARCHAR(25)
USING phone_number::TEXT;

-- Verify after: Open campaign dashboard in the app.
-- Check that campaign leads still display phone numbers correctly.
--
-- SELECT phone_number FROM campaign_leads LIMIT 10;
