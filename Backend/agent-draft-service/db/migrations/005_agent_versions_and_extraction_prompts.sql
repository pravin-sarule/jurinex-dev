-- Agent Modifier System: agent_versions and extraction_prompts tables.
-- Stores versioned autopopulation agent code and configurable extraction prompt templates.
-- Run against DRAFT_DATABASE_URL.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── agent_versions ────────────────────────────────────────────────────────────
-- Stores versioned snapshots of the autopopulation agent code.
CREATE TABLE IF NOT EXISTS agent_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL DEFAULT 'LegalDocumentFieldExtractor',
    version         VARCHAR(20)  NOT NULL DEFAULT '1.0.0',
    model           VARCHAR(100) NOT NULL DEFAULT 'claude-sonnet-4-5',
    code            TEXT         NOT NULL,
    system_prompt   TEXT         NOT NULL DEFAULT '',
    batch_size      INT          NOT NULL DEFAULT 12,
    max_tokens      INT          NOT NULL DEFAULT 4000,
    temperature     NUMERIC(4,3) NOT NULL DEFAULT 0.1,
    timeout_ms      INT          NOT NULL DEFAULT 30000,
    -- performance tracking
    avg_accuracy    NUMERIC(5,4),
    success_rate    NUMERIC(5,4),
    avg_processing_ms INT,
    usage_count     INT          NOT NULL DEFAULT 0,
    perf_updated_at TIMESTAMPTZ,
    -- lifecycle
    status          VARCHAR(20)  NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'deprecated', 'testing')),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Only one active version at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_versions_active
    ON agent_versions (name)
    WHERE status = 'active';

-- ── extraction_prompts ────────────────────────────────────────────────────────
-- Configurable prompt templates used by the autopopulation agent.
CREATE TABLE IF NOT EXISTS extraction_prompts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    category        VARCHAR(50)  NOT NULL
                        CHECK (category IN ('structured_fields', 'hybrid_fields', 'boilerplate', 'validation')),
    template        TEXT         NOT NULL,
    model           VARCHAR(100) NOT NULL DEFAULT 'claude-sonnet-4-5',
    max_tokens      INT          NOT NULL DEFAULT 4000,
    temperature     NUMERIC(4,3) NOT NULL DEFAULT 0.1,
    -- performance tracking
    success_rate    NUMERIC(5,4),
    avg_accuracy    NUMERIC(5,4),
    usage_count     INT          NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_extraction_prompts_category
    ON extraction_prompts (category);

-- ── auto-update updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_agent_versions_updated_at'
    ) THEN
        CREATE TRIGGER trg_agent_versions_updated_at
        BEFORE UPDATE ON agent_versions
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_extraction_prompts_updated_at'
    ) THEN
        CREATE TRIGGER trg_extraction_prompts_updated_at
        BEFORE UPDATE ON extraction_prompts
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;
