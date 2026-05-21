-- Migration: Add domain_role column to users table
-- Captures the user's professional domain selected at registration

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'domain_role'
  ) THEN
    ALTER TABLE users ADD COLUMN domain_role VARCHAR(50) DEFAULT 'OTHER';
  END IF;
END
$$;
