-- Section Versions Schema for Agentic Drafting System
-- Each section can have multiple versions; only one is active (live) at a time
-- Supports user refinement with feedback prompts and version history

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Template sections: hardcoded prompts per template (admin-configured)
CREATE TABLE IF NOT EXISTS template_sections (
    section_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL,
    section_key VARCHAR(100) NOT NULL, -- e.g. "introduction", "facts", "arguments"
    section_name VARCHAR(255) NOT NULL, -- Display name: "Introduction", "Statement of Facts"
    default_prompt TEXT NOT NULL, -- Hardcoded prompt for RAG/generation
    sort_order INT DEFAULT 0,
    is_required BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_template_section FOREIGN KEY (template_id) 
        REFERENCES templates(template_id) ON DELETE CASCADE,
    CONSTRAINT unique_section_per_template UNIQUE (template_id, section_key)
);

CREATE INDEX idx_template_sections_template ON template_sections(template_id, is_active, sort_order);

-- Section versions: generated content for each section (per draft)
CREATE TABLE IF NOT EXISTS section_versions (
    version_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    draft_id UUID NOT NULL,
    section_key VARCHAR(100) NOT NULL, -- Links to template_sections.section_key
    version_number INT NOT NULL DEFAULT 1,
    content_html TEXT NOT NULL, -- Generated HTML content for this section
    user_prompt_override TEXT, -- User's custom prompt for refinement (optional)
    rag_context_used TEXT, -- Librarian context chunks used for this version
    generation_metadata JSONB, -- { model, tokens, chunks_count, critic_score, etc. }
    is_active BOOLEAN DEFAULT TRUE, -- Only one version is "live" per section
    created_by_agent VARCHAR(50) DEFAULT 'drafter', -- Agent that created this version
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_section_draft FOREIGN KEY (draft_id) 
        REFERENCES user_drafts(draft_id) ON DELETE CASCADE,
    CONSTRAINT unique_version UNIQUE (draft_id, section_key, version_number)
);

CREATE INDEX idx_section_versions_draft ON section_versions(draft_id, section_key, is_active);
CREATE INDEX idx_section_versions_active ON section_versions(draft_id, is_active);

-- Critic reviews: validation results for section versions
CREATE TABLE IF NOT EXISTS section_reviews (
    review_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version_id UUID NOT NULL,
    critic_status VARCHAR(20) NOT NULL CHECK (critic_status IN ('PASS', 'FAIL', 'PENDING')),
    critic_score INT CHECK (critic_score >= 0 AND critic_score <= 100),
    critic_feedback TEXT,
    review_metadata JSONB, -- { model, tokens, issues: [], suggestions: [] }
    reviewed_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_review_version FOREIGN KEY (version_id) 
        REFERENCES section_versions(version_id) ON DELETE CASCADE
);

CREATE INDEX idx_section_reviews_version ON section_reviews(version_id, reviewed_at DESC);

-- Comments for clarity
COMMENT ON TABLE template_sections IS 'Admin-configured section prompts per template';
COMMENT ON TABLE section_versions IS 'Generated section content with versioning and user refinement';
COMMENT ON TABLE section_reviews IS 'Critic agent validation results';
COMMENT ON COLUMN section_versions.is_active IS 'Only one version is live per (draft_id, section_key)';
COMMENT ON COLUMN section_versions.user_prompt_override IS 'User feedback for refinement (null for initial generation)';
