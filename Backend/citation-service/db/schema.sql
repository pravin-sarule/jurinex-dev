-- Citation Service PostgreSQL Schema
-- Run this or use init_db() to create tables.

-- ---------------------------------------------------------------------------
-- citation_reports (existing; extended with new columns)
-- ---------------------------------------------------------------------------
-- id UUID PRIMARY KEY,
-- user_id VARCHAR,
-- query TEXT,
-- report_format JSONB,
-- status VARCHAR,  -- 'completed' | 'pending_hitl' | 'failed'
-- case_id VARCHAR,
-- citation_count INTEGER DEFAULT 0,
-- created_at TIMESTAMP DEFAULT NOW()
-- New columns (add via ALTER if table exists):
-- run_id UUID REFERENCES citation_pipeline_runs(id),
-- hitl_pending_count INTEGER DEFAULT 0,
-- hitl_approved_count INTEGER DEFAULT 0,
-- citations_approved_count INTEGER DEFAULT 0,
-- citations_quarantined_count INTEGER DEFAULT 0,
-- updated_at TIMESTAMP DEFAULT NOW()

-- ---------------------------------------------------------------------------
-- citation_pipeline_runs: one row per pipeline execution
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_pipeline_runs (
    id UUID PRIMARY KEY,
    user_id VARCHAR NOT NULL,
    case_id VARCHAR,
    query TEXT NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'running',  -- 'running' | 'completed' | 'failed' | 'pending_hitl'
    report_id UUID,
    citations_fetched_count INTEGER DEFAULT 0,
    citations_approved_count INTEGER DEFAULT 0,
    citations_quarantined_count INTEGER DEFAULT 0,
    citations_sent_to_hitl_count INTEGER DEFAULT 0,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user ON citation_pipeline_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_case ON citation_pipeline_runs(case_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON citation_pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started ON citation_pipeline_runs(started_at DESC);

-- ---------------------------------------------------------------------------
-- agent_logs: all agent/pipeline logs for auditing and debugging
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID REFERENCES citation_pipeline_runs(id) ON DELETE SET NULL,
    report_id UUID,
    agent_name VARCHAR(64) NOT NULL,   -- keyword_extractor, watchdog, fetcher, clerk, librarian, auditor, report_builder
    stage VARCHAR(64),                -- same as agent_name or sub-stage
    log_level VARCHAR(16) NOT NULL,    -- INFO, WARNING, ERROR, DEBUG
    message TEXT NOT NULL,
    metadata JSONB,                   -- counts, errors, extra context
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_run ON agent_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_report ON agent_logs(report_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at DESC);

-- ---------------------------------------------------------------------------
-- hitl_queue: citations sent for human verification (cannot be auto-verified)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hitl_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID,                      -- nullable: may be set after async pipeline completes
    run_id UUID REFERENCES citation_pipeline_runs(id) ON DELETE SET NULL,
    canonical_id VARCHAR(128) NOT NULL,  -- judgment/citation id
    citation_string VARCHAR(512),        -- human-readable citation e.g. "(2019) 10 SCC 1"
    query_context TEXT,                  -- original user query that triggered this citation
    web_source_url TEXT,                 -- URL where citation was found (google/web route)
    priority_score NUMERIC(4,3) DEFAULT 0.0,  -- 0.0–1.0; maps to SLA (>=0.85=4hrs, etc.)
    case_id VARCHAR,
    user_id VARCHAR NOT NULL,
    citation_snapshot JSONB NOT NULL,   -- full citation object as queued
    status VARCHAR(32) NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
    reason_queued VARCHAR(256),         -- e.g. 'quarantined', 'needs_review', 'low_confidence'
    reviewed_at TIMESTAMP,
    reviewed_by VARCHAR(128),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Migration: add new columns to existing hitl_queue tables
ALTER TABLE hitl_queue ALTER COLUMN report_id DROP NOT NULL;
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS citation_string VARCHAR(512);
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS query_context TEXT;
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS web_source_url TEXT;
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS priority_score NUMERIC(4,3) DEFAULT 0.0;

CREATE INDEX IF NOT EXISTS idx_hitl_report ON hitl_queue(report_id);
CREATE INDEX IF NOT EXISTS idx_hitl_status ON hitl_queue(status);
CREATE INDEX IF NOT EXISTS idx_hitl_user ON hitl_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_hitl_created ON hitl_queue(created_at DESC);

-- ---------------------------------------------------------------------------
-- report_citations: each citation in a report (approved, hitl_pending, quarantined)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_citations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL,
    canonical_id VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,  -- 'approved' | 'hitl_pending' | 'quarantined'
    citation_snapshot JSONB,     -- citation object at time of report
    hitl_queue_id UUID,          -- if status = hitl_pending, link to hitl_queue
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_citations_report ON report_citations(report_id);
CREATE INDEX IF NOT EXISTS idx_report_citations_status ON report_citations(status);

-- ---------------------------------------------------------------------------
-- citation_blacklist: confirmed fake / hallucinated citations (by normalized key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_blacklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    normalized_key TEXT UNIQUE NOT NULL,
    reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_citation_blacklist_key
    ON citation_blacklist(normalized_key);
