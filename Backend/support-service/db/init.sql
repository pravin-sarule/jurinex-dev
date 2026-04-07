CREATE TABLE IF NOT EXISTS support_queries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  ticket_number TEXT UNIQUE,
  user_email TEXT,
  user_name TEXT,
  subject TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  message TEXT NOT NULL,
  attachment_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',
  status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  admin_note TEXT,
  seen_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_queries_user_id_created_at
ON support_queries (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_queries_status_created_at
ON support_queries (status, created_at DESC);
