-- Draft_DB: template_fields, user_drafts, draft_field_data, draft_field_values_normalized, generated_documents.
-- Run after templates table exists. templates.template_id is UUID.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Form fields per template (for user fill-in form)
CREATE TABLE IF NOT EXISTS template_fields (
    field_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL,

    field_name VARCHAR(100) NOT NULL,
    field_label VARCHAR(255) NOT NULL,

    field_type TEXT CHECK (field_type IN (
        'text','number','email','phone','date','textarea',
        'select','radio','checkbox','file'
    )) DEFAULT 'text',

    is_required BOOLEAN DEFAULT FALSE,
    placeholder TEXT,
    default_value TEXT,

    validation_rules JSONB,
    options JSONB,
    help_text TEXT,

    field_group VARCHAR(100),
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),

    CONSTRAINT fk_template_fields FOREIGN KEY (template_id)
        REFERENCES templates(template_id) ON DELETE CASCADE,

    CONSTRAINT unique_field_per_template UNIQUE (template_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_template_fields_template ON template_fields(template_id);
CREATE INDEX IF NOT EXISTS idx_template_fields_active ON template_fields(template_id, is_active);


-- User's draft instance (clone of template attached to user)
CREATE TABLE IF NOT EXISTS user_drafts (
    draft_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id INTEGER NOT NULL,
    template_id UUID NOT NULL,

    draft_title VARCHAR(255),

    status TEXT DEFAULT 'draft',
    completion_percentage INT DEFAULT 0,

    is_favorite BOOLEAN DEFAULT FALSE,
    tags JSONB,
    notes TEXT,

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    completed_at TIMESTAMP,

    CONSTRAINT fk_template_draft
        FOREIGN KEY (template_id) REFERENCES templates(template_id)
);

CREATE INDEX IF NOT EXISTS idx_user_drafts_user ON user_drafts(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_drafts_template ON user_drafts(template_id);
CREATE INDEX IF NOT EXISTS idx_user_drafts_favorite ON user_drafts(user_id, is_favorite);


-- Draft field values (JSONB for flexible form data)
CREATE TABLE IF NOT EXISTS draft_field_data (
    draft_id UUID PRIMARY KEY,

    field_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    filled_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB,

    updated_at TIMESTAMP DEFAULT now(),

    CONSTRAINT fk_draft_data
        FOREIGN KEY (draft_id) REFERENCES user_drafts(draft_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_draft_field_values_json ON draft_field_data USING GIN (field_values);


-- Normalized field values (optional; for querying by field)
CREATE TABLE IF NOT EXISTS draft_field_values_normalized (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    draft_id UUID NOT NULL,
    field_id UUID NOT NULL,
    field_value TEXT NOT NULL,

    filled_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),

    CONSTRAINT fk_norm_draft FOREIGN KEY (draft_id) REFERENCES user_drafts(draft_id) ON DELETE CASCADE,
    CONSTRAINT fk_norm_field FOREIGN KEY (field_id) REFERENCES template_fields(field_id) ON DELETE CASCADE,

    UNIQUE (draft_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_norm_draft ON draft_field_values_normalized(draft_id);
CREATE INDEX IF NOT EXISTS idx_norm_field ON draft_field_values_normalized(field_id);


-- Generated output documents (PDF etc.) from draft
CREATE TABLE IF NOT EXISTS generated_documents (
    document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    draft_id UUID NOT NULL,

    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_type TEXT DEFAULT 'pdf',

    file_size BIGINT,
    version INT DEFAULT 1,
    is_final BOOLEAN DEFAULT FALSE,

    generated_at TIMESTAMP DEFAULT now(),

    CONSTRAINT fk_doc_draft FOREIGN KEY (draft_id) REFERENCES user_drafts(draft_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_doc_versions ON generated_documents(draft_id, version DESC);
