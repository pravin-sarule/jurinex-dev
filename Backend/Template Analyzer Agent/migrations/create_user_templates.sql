-- Create user_templates and related tables in Draft_DB (same structure as templates)
-- Used when a regular user (not admin/super-admin) uploads a template.

CREATE TABLE IF NOT EXISTS user_templates (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    sub_category VARCHAR(100),
    language VARCHAR(50) DEFAULT 'en',
    status VARCHAR(50) DEFAULT 'active',
    description TEXT,
    created_by UUID,
    user_id INTEGER NOT NULL,
    image_url TEXT,
    file_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_templates_user_id ON user_templates(user_id);

CREATE TABLE IF NOT EXISTS user_template_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES user_templates(template_id) ON DELETE CASCADE,
    template_fields JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_template_fields_template_id ON user_template_fields(template_id);

CREATE TABLE IF NOT EXISTS user_template_analysis_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES user_templates(template_id) ON DELETE CASCADE,
    section_name VARCHAR(255) NOT NULL,
    section_purpose TEXT,
    section_intro TEXT,
    section_prompts JSONB NOT NULL,
    order_index INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_template_sections_template_id ON user_template_analysis_sections(template_id);
