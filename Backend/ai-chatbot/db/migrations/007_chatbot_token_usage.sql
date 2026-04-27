-- Token usage tracking for AI chatbot (text and audio models, separate rows per request/session)
-- Stores input/output tokens, model name, mode, IP address, and timestamp.

CREATE TABLE IF NOT EXISTS chatbot_token_usage (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    UUID        REFERENCES chat_sessions(id) ON DELETE SET NULL,
    mode          TEXT        NOT NULL CHECK (mode IN ('text', 'audio')),
    model_name    TEXT        NOT NULL,
    input_tokens  INTEGER     NOT NULL DEFAULT 0,
    output_tokens INTEGER     NOT NULL DEFAULT 0,
    total_tokens  INTEGER     GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
    ip_address    INET,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON chatbot_token_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_session_id ON chatbot_token_usage (session_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_mode       ON chatbot_token_usage (mode);
CREATE INDEX IF NOT EXISTS idx_token_usage_ip         ON chatbot_token_usage (ip_address);
