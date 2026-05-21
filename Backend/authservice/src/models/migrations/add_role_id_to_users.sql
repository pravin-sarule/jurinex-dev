-- Migration: Add role_id UUID FK column to users table
-- Drops the column first if it was previously added with wrong type (e.g. integer)

DO $$
BEGIN
  -- Drop the column if it exists with the wrong type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name = 'role_id'
      AND data_type != 'uuid'
  ) THEN
    ALTER TABLE users DROP COLUMN role_id;
  END IF;

  -- Add as UUID if not already present
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role_id'
  ) THEN
    ALTER TABLE users ADD COLUMN role_id UUID REFERENCES roles(id);
  END IF;
END
$$;
