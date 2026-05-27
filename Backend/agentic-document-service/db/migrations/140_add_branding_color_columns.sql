-- Letterhead / footer / body text colors + per-line font sizes (camelCase in API)

ALTER TABLE branding_profiles
    ADD COLUMN IF NOT EXISTS firm_name_font_size  INTEGER  NOT NULL DEFAULT 16,
    ADD COLUMN IF NOT EXISTS firm_name_color      TEXT     NOT NULL DEFAULT '#000000',
    ADD COLUMN IF NOT EXISTS tagline_font_size    INTEGER  NOT NULL DEFAULT 9,
    ADD COLUMN IF NOT EXISTS tagline_color        TEXT     NOT NULL DEFAULT '#000000',
    ADD COLUMN IF NOT EXISTS meta_font_size       NUMERIC(4,1) NOT NULL DEFAULT 8.5,
    ADD COLUMN IF NOT EXISTS meta_color           TEXT     NOT NULL DEFAULT '#000000',
    ADD COLUMN IF NOT EXISTS header_color         TEXT     NOT NULL DEFAULT '#000000',
    ADD COLUMN IF NOT EXISTS footer_color         TEXT     NOT NULL DEFAULT '#000000',
    ADD COLUMN IF NOT EXISTS body_text_color      TEXT     NOT NULL DEFAULT '#000000';
