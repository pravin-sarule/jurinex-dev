-- Migration: Create user_professional_profiles table
-- This table stores professional profile information for users

CREATE TABLE IF NOT EXISTS user_professional_profiles (
    id SERIAL PRIMARY KEY,
    -- Foreign Key: Link with users table
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    
    /* -----------------------------
       Profile Completion Status
       ----------------------------- */
    is_profile_completed BOOLEAN DEFAULT FALSE,
    
    /* -----------------------------
       AI Preference & Output Style
       ----------------------------- */
    preferred_tone VARCHAR(255),
    preferred_detail_level VARCHAR(255),      
    citation_style VARCHAR(255),
    perspective TEXT,
    typical_client TEXT,
    highlights_in_summary TEXT,
    
    /* -----------------------------
       Organization Information
       ----------------------------- */
    organization_name VARCHAR(255),
    
    /* -----------------------------
       Professional & Jurisdictional Info
       ----------------------------- */
    primary_role TEXT,
    experience TEXT,
    primary_jurisdiction TEXT,
    main_areas_of_practice TEXT,
    organization_type VARCHAR(255),
    bar_enrollment_number VARCHAR(255),
    
    /* -----------------------------
       Metadata
       ----------------------------- */
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Add index for faster lookup by user_id
CREATE INDEX IF NOT EXISTS idx_user_professional_profiles_user_id ON user_professional_profiles(user_id);

-- Add a function to update the updated_at column automatically
CREATE OR REPLACE FUNCTION update_user_professional_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add a trigger to update the updated_at column on each update
CREATE TRIGGER update_user_professional_profiles_updated_at
BEFORE UPDATE ON user_professional_profiles
FOR EACH ROW
EXECUTE FUNCTION update_user_professional_profiles_updated_at();





