-- Dummy data for hitl_queue (Human-in-the-Loop citation verification queue)
-- Run after schema is applied. report_id and run_id are optional (nullable).
-- Uses realistic citation_snapshot JSON matching report_builder output.

-- Ensure all columns exist (for DBs created from older schema)
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS report_id UUID;
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS canonical_id VARCHAR(128);
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS citation_string VARCHAR(512);
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS query_context TEXT;
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS web_source_url TEXT;
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS priority_score NUMERIC(4,3) DEFAULT 0.0;
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS case_id VARCHAR(255);
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS citation_snapshot JSONB;
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'pending';
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS reason_queued VARCHAR(256);
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(128);
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Insert without report_id/run_id (standalone queue items)
INSERT INTO hitl_queue (
    report_id,
    run_id,
    canonical_id,
    citation_string,
    query_context,
    web_source_url,
    priority_score,
    case_id,
    user_id,
    citation_snapshot,
    reason_queued,
    status
) VALUES
(
    NULL,
    NULL,
    'ik-doc-12345',
    '(2019) 10 SCC 1',
    'anticipatory bail conditions under Section 438 CrPC Supreme Court',
    'https://indiankanoon.org/doc/12345/',
    0.872,
    NULL,
    'user-demo-001',
    '{
        "id": "cit-001",
        "verificationStatus": "PENDING",
        "verificationStatusLabel": "Requires review",
        "confidence": 65,
        "caseName": "Arnab Manoranjan Goswami v. State of Maharashtra",
        "primaryCitation": "(2019) 10 SCC 1",
        "alternateCitations": ["AIR 2020 SC 100"],
        "court": "Supreme Court of India",
        "coram": "Justice D.Y. Chandrachud, Justice Hemant Gupta",
        "benchType": "Division Bench",
        "dateOfJudgment": "27 November 2020",
        "statutes": ["Section 438, Code of Criminal Procedure, 1973", "Article 21, Constitution of India"],
        "ratio": "The court held that the approach in grant of anticipatory bail must be liberal and the conditions imposed should not amount to denial of bail.",
        "excerpt": {"para": "Para 42", "text": "The court observed that personal liberty is a constitutional imperative and the power to grant anticipatory bail must be exercised with due regard to the same."},
        "source": "indian_kanoon",
        "sourceLabel": "Indian Kanoon",
        "sourceApplication": "Indian Kanoon",
        "canonicalId": "ik-doc-12345",
        "priorityScore": 0.872,
        "queryContext": "anticipatory bail conditions under Section 438 CrPC Supreme Court"
    }'::jsonb,
    'quarantined',
    'pending'
),
(
    NULL,
    NULL,
    'google-hash-abc789',
    'AIR 1978 SC 597',
    'bail last seen theory murder',
    'https://example.com/judgment/air-1978-sc-597',
    0.654,
    'case-xyz-456',
    'user-demo-001',
    '{
        "id": "cit-002",
        "verificationStatus": "PENDING",
        "verificationStatusLabel": "Requires review",
        "confidence": 52,
        "caseName": "Maneka Gandhi v. Union of India",
        "primaryCitation": "AIR 1978 SC 597",
        "alternateCitations": ["(1978) 1 SCC 248"],
        "court": "Supreme Court of India",
        "coram": "Justice P.N. Bhagwati, Justice M.H. Beg",
        "benchType": "Constitution Bench",
        "dateOfJudgment": "25 January 1978",
        "statutes": ["Article 21, Constitution of India", "Article 14, Constitution of India"],
        "ratio": "Procedure established by law under Article 21 must be fair, just and reasonable.",
        "excerpt": {"para": "Para 7", "text": "The principle of natural justice is an essential ingredient of procedure established by law."},
        "source": "google",
        "sourceLabel": "Google Search",
        "sourceApplication": "Google Search",
        "canonicalId": "google-hash-abc789",
        "priorityScore": 0.654,
        "queryContext": "bail last seen theory murder"
    }'::jsonb,
    'web_unverified',
    'pending'
),
(
    NULL,
    NULL,
    'local-judgment-001',
    '(2022) 5 SCC 300',
    'dowry death presumption Section 304B IPC',
    NULL,
    0.521,
    NULL,
    'user-demo-002',
    '{
        "id": "cit-003",
        "verificationStatus": "PENDING",
        "verificationStatusLabel": "Requires review",
        "confidence": 48,
        "caseName": "Satvir Singh v. State of Punjab",
        "primaryCitation": "(2022) 5 SCC 300",
        "alternateCitations": [],
        "court": "Supreme Court of India",
        "coram": "Justice M.R. Shah, Justice B.V. Nagarathna",
        "benchType": "Division Bench",
        "dateOfJudgment": "28 April 2022",
        "statutes": ["Section 304B, Indian Penal Code, 1860", "Section 113B, Indian Evidence Act, 1872"],
        "ratio": "For conviction under Section 304B IPC, the prosecution must establish that the death was caused by burns or bodily injury or occurred otherwise than under normal circumstances within seven years of marriage.",
        "excerpt": {"para": "Para 18", "text": "The presumption under Section 113B of the Evidence Act is a statutory presumption which can be rebutted by the accused."},
        "source": "google",
        "sourceLabel": "Google Search",
        "sourceApplication": "Google Search",
        "canonicalId": "local-judgment-001",
        "priorityScore": 0.521,
        "queryContext": "dowry death presumption Section 304B IPC"
    }'::jsonb,
    'verification_failed',
    'pending'
);

-- Optional: one approved and one rejected for testing list filters
INSERT INTO hitl_queue (
    report_id,
    run_id,
    canonical_id,
    citation_string,
    query_context,
    web_source_url,
    priority_score,
    case_id,
    user_id,
    citation_snapshot,
    reason_queued,
    status,
    reviewed_at,
    reviewed_by
) VALUES
(
    NULL,
    NULL,
    'ik-doc-99999',
    '(2020) 8 SCC 1',
    'quashing of FIR abuse of process',
    'https://indiankanoon.org/doc/99999/',
    0.710,
    NULL,
    'user-demo-001',
    '{
        "id": "cit-004",
        "caseName": "State of Haryana v. Bhajan Lal",
        "primaryCitation": "(2020) 8 SCC 1",
        "court": "Supreme Court of India",
        "verificationStatus": "GREEN",
        "confidence": 85,
        "source": "indian_kanoon"
    }'::jsonb,
    'quarantined',
    'approved',
    NOW() - INTERVAL '1 day',
    'reviewer@example.com'
),
(
    NULL,
    NULL,
    'fake-citation-xyz',
    'Invalid Citation (2025) 99 SCC 999',
    'test hallucination check',
    'https://random-blog.com/fake',
    0.200,
    NULL,
    'user-demo-001',
    '{
        "id": "cit-005",
        "caseName": "Unknown Case",
        "primaryCitation": "(2025) 99 SCC 999",
        "court": "Court not specified",
        "verificationStatus": "RED",
        "confidence": 20,
        "source": "google"
    }'::jsonb,
    'quarantined',
    'rejected',
    NOW() - INTERVAL '2 hours',
    'reviewer@example.com'
);
