-- Citation service: track which cases a user has attached for citation report context.
-- When a case is attached, all files in that case are considered "case file context" for citation generation.

CREATE TABLE IF NOT EXISTS citation_attached_cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    attached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, case_id)
);

CREATE INDEX IF NOT EXISTS idx_citation_attached_cases_user_id ON citation_attached_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_citation_attached_cases_case_id ON citation_attached_cases(case_id);
