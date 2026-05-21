-- ── Patch: align branding_profiles table with the application schema ──────────
-- Handles the case where migration 120 created the table with the old schema
-- (logo_url TEXT, user_id INTEGER, missing header/footer/watermark columns).

-- 1. Rename logo_url → logo (safe — ADD then copy if RENAME fails on older PG)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'branding_profiles' AND column_name = 'logo_url'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'branding_profiles' AND column_name = 'logo'
    ) THEN
        ALTER TABLE branding_profiles RENAME COLUMN logo_url TO logo;
    END IF;

    -- If logo_url was already renamed or the column simply doesn't exist yet, add it
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'branding_profiles' AND column_name = 'logo'
    ) THEN
        ALTER TABLE branding_profiles ADD COLUMN logo TEXT DEFAULT NULL;
    END IF;
END;
$$;

-- 2. Change user_id from INTEGER → TEXT (no data loss; existing integers become '1', '2', …)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'branding_profiles'
           AND column_name = 'user_id'
           AND data_type IN ('integer', 'bigint', 'smallint')
    ) THEN
        ALTER TABLE branding_profiles
            ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
    END IF;
END;
$$;

-- 3. Add missing Document Header columns
ALTER TABLE branding_profiles
    ADD COLUMN IF NOT EXISTS header_enabled   BOOLEAN  NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS header_text      TEXT     NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS header_alignment TEXT     NOT NULL DEFAULT 'center',
    ADD COLUMN IF NOT EXISTS header_font_size INTEGER  NOT NULL DEFAULT 12;

-- 4. Add missing Document Footer columns
ALTER TABLE branding_profiles
    ADD COLUMN IF NOT EXISTS footer_enabled   BOOLEAN  NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS footer_pattern   TEXT     NOT NULL DEFAULT 'Page {n} of {total}',
    ADD COLUMN IF NOT EXISTS footer_position  TEXT     NOT NULL DEFAULT 'bottom-center',
    ADD COLUMN IF NOT EXISTS footer_font_size INTEGER  NOT NULL DEFAULT 10;

-- 5. Add missing Watermark detail columns
ALTER TABLE branding_profiles
    ADD COLUMN IF NOT EXISTS watermark_opacity NUMERIC(5,4) NOT NULL DEFAULT 0.07,
    ADD COLUMN IF NOT EXISTS watermark_angle   INTEGER      NOT NULL DEFAULT -45;

-- 6. Ensure the unique partial index exists (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS branding_profiles_user_default_uq
    ON branding_profiles(user_id) WHERE is_default = TRUE;

-- 7. Recreate the trigger function and trigger (idempotent via CREATE OR REPLACE / DROP IF EXISTS)
CREATE OR REPLACE FUNCTION enforce_single_branding_default()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.is_default = TRUE THEN
        UPDATE branding_profiles
           SET is_default = FALSE
         WHERE user_id = NEW.user_id
           AND id <> NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_single_branding_default ON branding_profiles;
CREATE TRIGGER trg_single_branding_default
    AFTER INSERT OR UPDATE OF is_default ON branding_profiles
    FOR EACH ROW EXECUTE FUNCTION enforce_single_branding_default();
