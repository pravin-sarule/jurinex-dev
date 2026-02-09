-- Schema reference: Draft_DB with user_id as INTEGER (JWT user id).
-- Run after templates table exists. Use this as reference; 002 already creates tables with user_id INTEGER.
-- If your DB has user_drafts.user_id as UUID, run: ALTER TABLE user_drafts ALTER COLUMN user_id TYPE INTEGER USING (0);

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- template_fields: form fields per template (category-wise templates)
CREATE TABLE IF NOT EXISTS template_fields (
    field_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    CONSTRAINT fk_template FOREIGN KEY (template_id)
        REFERENCES templates(template_id) ON DELETE CASCADE,
    CONSTRAINT unique_field_per_template UNIQUE (template_id, field_name)
);
CREATE INDEX idx_template_fields_template ON template_fields(template_id);
CREATE INDEX idx_template_fields_active ON template_fields(template_id, is_active);

-- user_drafts: user_id is INTEGER (from JWT)
CREATE TABLE IF NOT EXISTS user_drafts (
    draft_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE INDEX idx_user_drafts_user ON user_drafts(user_id, status, updated_at DESC);
CREATE INDEX idx_user_drafts_template ON user_drafts(template_id);
CREATE INDEX idx_user_drafts_favorite ON user_drafts(user_id, is_favorite);

CREATE TABLE IF NOT EXISTS draft_field_data (
    draft_id UUID PRIMARY KEY,
    field_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    filled_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB,
    updated_at TIMESTAMP DEFAULT now(),
    CONSTRAINT fk_draft_data
        FOREIGN KEY (draft_id) REFERENCES user_drafts(draft_id) ON DELETE CASCADE
);
CREATE INDEX idx_draft_field_values_json ON draft_field_data USING GIN (field_values);

CREATE TABLE IF NOT EXISTS draft_field_values_normalized (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    draft_id UUID NOT NULL,
    field_id UUID NOT NULL,
    field_value TEXT NOT NULL,
    filled_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    CONSTRAINT fk_norm_draft FOREIGN KEY (draft_id) REFERENCES user_drafts(draft_id) ON DELETE CASCADE,
    CONSTRAINT fk_norm_field FOREIGN KEY (field_id) REFERENCES template_fields(field_id) ON DELETE CASCADE,
    UNIQUE (draft_id, field_id)
);
CREATE INDEX idx_norm_draft ON draft_field_values_normalized(draft_id);
CREATE INDEX idx_norm_field ON draft_field_values_normalized(field_id);

CREATE TABLE IF NOT EXISTS generated_documents (
    document_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE INDEX idx_doc_versions ON generated_documents(draft_id, version DESC);
