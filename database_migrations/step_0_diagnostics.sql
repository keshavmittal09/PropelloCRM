-- =============================================================================
-- STEP 0 — Read-Only Diagnostic Queries
-- Run these in Supabase SQL Editor. No changes made. Information gathering only.
-- =============================================================================

-- 0A: Get all enum types and values (critical before any role work)
-- Save this output - you'll need it for multi-tenancy work later
SELECT t.typname, e.enumlabel
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
ORDER BY t.typname, e.enumsortorder;

-- 0B: Check current column sizes that might be too small
SELECT table_name, column_name, character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
AND data_type = 'character varying'
AND character_maximum_length <= 20
ORDER BY table_name, column_name;

-- 0C: Check which indexes already exist
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename;

-- 0D: Check FK constraints
SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table,
       rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name;
