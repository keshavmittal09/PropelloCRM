-- =============================================================================
-- STEP 7 — Fix bhk_options Column Type (OPTIONAL — do last)
-- Risk: MEDIUM — type conversion. Do this only if projects.bhk_options actually
-- has data and the values are comma-separated strings.
--
-- IMPORTANT: Check what's actually in bhk_options first before running!
-- =============================================================================

-- CHECK FIRST: see what's actually in bhk_options
SELECT id, name, bhk_options FROM projects WHERE bhk_options IS NOT NULL LIMIT 10;

-- If the values look like "2BHK, 3BHK" (comma-separated string), run this:
/*
ALTER TABLE projects
ALTER COLUMN bhk_options TYPE JSONB
USING CASE
  WHEN bhk_options IS NULL THEN NULL
  ELSE to_jsonb(string_to_array(trim(bhk_options), ','))
END;
*/

-- If the values are already JSON-like or empty — skip this step entirely.
--
-- NOTE: Check backend/app/models/campaign.py line 16:
--   bhk_options: Mapped[list | None] = mapped_column(Text, nullable=True)
-- If Python model reads bhk_options as a string, the model needs updating too.
-- Only do this step if you're ready to update both DB and model together.
