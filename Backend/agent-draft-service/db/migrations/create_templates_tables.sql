-- Draft_DB: templates and related tables for template gallery API.
-- Run this against the database pointed to by DRAFT_DATABASE_URL.

-- Parent template metadata
CREATE TABLE IF NOT EXISTS templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    category    TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Assets (uploaded files) per template
CREATE TABLE IF NOT EXISTS template_assets (
    asset_id           TEXT PRIMARY KEY,
    template_id        TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    asset_type         TEXT,
    original_file_name TEXT,
    gcs_bucket         TEXT NOT NULL,
    gcs_path           TEXT NOT NULL,
    mime_type          TEXT,
    file_size_bytes    BIGINT,
    checksum           TEXT,
    uploaded_by        TEXT,
    uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_template_assets_template_id ON template_assets(template_id);

-- CSS versions per template
CREATE TABLE IF NOT EXISTS template_css (
    css_id      TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    paper_size  TEXT,
    court       TEXT,
    css_content TEXT NOT NULL,
    checksum    TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_template_css_template_id ON template_css(template_id);

-- HTML versions per template
CREATE TABLE IF NOT EXISTS template_html (
    html_id              TEXT PRIMARY KEY,
    template_id          TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    version              INTEGER NOT NULL,
    html_content         TEXT NOT NULL,
    derived_from_asset_id TEXT,
    checksum             TEXT,
    is_active            BOOLEAN NOT NULL DEFAULT true,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_template_html_template_id ON template_html(template_id);

-- Rendered preview images per template (for gallery)
CREATE TABLE IF NOT EXISTS template_images (
    image_id        TEXT PRIMARY KEY,
    template_id     TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    source_asset_id  TEXT,
    gcs_bucket      TEXT NOT NULL,
    gcs_path        TEXT NOT NULL,
    page_number     INTEGER,
    width_px        INTEGER,
    height_px       INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_template_images_template_id ON template_images(template_id);
