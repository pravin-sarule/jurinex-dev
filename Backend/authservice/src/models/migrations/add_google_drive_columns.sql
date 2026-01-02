-- Migration to add Google Drive OAuth columns to users table
-- Run this migration once to enable Google Drive integration

-- Add columns for Google Drive refresh token storage
ALTER TABLE users
ADD COLUMN IF NOT EXISTS google_drive_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS google_drive_token_expiry TIMESTAMPTZ;

-- Add index for faster lookups (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_users_google_drive_refresh_token 
ON users(google_drive_refresh_token) 
WHERE google_drive_refresh_token IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN users.google_drive_refresh_token IS 'OAuth2 refresh token for Google Drive API access';
COMMENT ON COLUMN users.google_drive_token_expiry IS 'Expiry timestamp for the Google Drive access token';



