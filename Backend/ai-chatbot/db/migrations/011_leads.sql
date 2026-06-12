-- 011_leads.sql
-- Stores contact info collected by the landing page chatbot (no slot required)

CREATE TABLE IF NOT EXISTS leads (
    id         SERIAL        PRIMARY KEY,
    name       VARCHAR(100)  NOT NULL,
    email      VARCHAR(150)  NOT NULL UNIQUE,
    phone      VARCHAR(20)   NOT NULL,
    source     VARCHAR(50)   NOT NULL DEFAULT 'chatbot',
    created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Auto-update updated_at on upsert
CREATE OR REPLACE FUNCTION update_leads_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_ts ON leads;
CREATE TRIGGER trg_leads_ts
    BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_leads_ts();
