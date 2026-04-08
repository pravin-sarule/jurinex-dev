-- Migration 110: Create case_assignments table
--
-- The case_id and user_id column types are inferred at runtime by the
-- service (see app/api/routes/rbac/service.py → ensure_case_assignments_schema).
-- This migration creates the table using INTEGER for both, which matches
-- the current production schema (cases.id INTEGER, cases.user_id INTEGER).
--
-- If your deployment uses UUID for cases.id, drop and recreate with:
--   case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE
-- or simply let the service handle it automatically on first request.

CREATE TABLE IF NOT EXISTS case_assignments (
    id          SERIAL PRIMARY KEY,
    case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL,
    assigned_by INTEGER,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (case_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_case_assignments_user_id ON case_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_case_assignments_case_id ON case_assignments(case_id);
