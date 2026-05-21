-- ── Branding profiles: per-user letterhead templates used when exporting responses ──

CREATE TABLE IF NOT EXISTS branding_profiles (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- user_id is TEXT to match the X-User-Id header value (may be integer string or UUID string)
    user_id         TEXT        NOT NULL,

    -- Profile identity
    name            TEXT        NOT NULL DEFAULT '',
    is_default      BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Letterhead text
    firm_name       TEXT        NOT NULL DEFAULT '',
    tagline         TEXT        NOT NULL DEFAULT '',
    bar_council_no  TEXT        NOT NULL DEFAULT '',
    office_address  TEXT        NOT NULL DEFAULT '',
    phone           TEXT        NOT NULL DEFAULT '',
    email           TEXT        NOT NULL DEFAULT '',

    -- Logo (base64 data-URI for local storage; GCS URL for server-side)
    logo            TEXT        DEFAULT NULL,
    logo_position   TEXT        NOT NULL DEFAULT 'right'
                        CHECK (logo_position IN ('left', 'center', 'right')),
    logo_width      INTEGER     NOT NULL DEFAULT 80,
    logo_height     INTEGER     NOT NULL DEFAULT 80,
    letterhead_alignment TEXT   NOT NULL DEFAULT 'left'
                        CHECK (letterhead_alignment IN ('left', 'center', 'right')),

    -- Document Header
    header_enabled  BOOLEAN     NOT NULL DEFAULT FALSE,
    header_text     TEXT        NOT NULL DEFAULT '',
    header_alignment TEXT       NOT NULL DEFAULT 'center'
                        CHECK (header_alignment IN ('left', 'center', 'right')),
    header_font_size INTEGER    NOT NULL DEFAULT 12,

    -- Document Footer
    footer_enabled  BOOLEAN     NOT NULL DEFAULT FALSE,
    footer_pattern  TEXT        NOT NULL DEFAULT 'Page {n} of {total}',
    footer_position TEXT        NOT NULL DEFAULT 'bottom-center'
                        CHECK (footer_position IN ('bottom-left', 'bottom-center', 'bottom-right')),
    footer_font_size INTEGER    NOT NULL DEFAULT 10,

    -- Watermark
    watermark       BOOLEAN     NOT NULL DEFAULT FALSE,
    watermark_text  TEXT        NOT NULL DEFAULT '',
    watermark_opacity NUMERIC(5,4) NOT NULL DEFAULT 0.07,
    watermark_angle INTEGER     NOT NULL DEFAULT -45,

    -- Typography
    font_family     TEXT        NOT NULL DEFAULT 'Georgia',
    font_size       INTEGER     NOT NULL DEFAULT 12,
    line_height     NUMERIC(4,2) NOT NULL DEFAULT 1.50,
    primary_color   TEXT        NOT NULL DEFAULT '#21C1B6',

    -- Page setup
    page_size       TEXT        NOT NULL DEFAULT 'a4'
                        CHECK (page_size IN ('a4', 'letter', 'legal')),
    orientation     TEXT        NOT NULL DEFAULT 'portrait'
                        CHECK (orientation IN ('portrait', 'landscape')),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

-- List page: fetch all profiles for a user ordered by creation date
CREATE INDEX IF NOT EXISTS idx_branding_profiles_user_id
    ON branding_profiles(user_id, created_at DESC);

-- Download-time fast lookup of the active default (partial index — very small)
CREATE UNIQUE INDEX IF NOT EXISTS branding_profiles_user_default_uq
    ON branding_profiles(user_id) WHERE is_default = TRUE;

-- ── Enforce single default per user via trigger ───────────────────────────────
-- When a profile is set as default, automatically clear the flag on all other
-- profiles for the same user so the UNIQUE partial index is never violated.

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

COMMENT ON TABLE branding_profiles IS
    'Per-user letterhead/branding templates applied to PDF and Word response exports.';

COMMENT ON COLUMN branding_profiles.logo IS
    'Base64 data-URI (frontend localStorage) or GCS object URL (server-side upload).';
COMMENT ON COLUMN branding_profiles.is_default IS
    'At most one row per user may have is_default = TRUE (enforced by trg_single_branding_default and branding_profiles_user_default_uq).';
