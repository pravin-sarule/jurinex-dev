CREATE TABLE IF NOT EXISTS cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES user_files(id) ON DELETE SET NULL, -- Link to the folder created for the case
    case_title VARCHAR(255) NOT NULL,
    case_number VARCHAR(255),
    filing_date TIMESTAMP WITH TIME ZONE,
    case_type VARCHAR(100) NOT NULL,
    sub_type VARCHAR(100),
    court_name VARCHAR(255) NOT NULL,
    court_level VARCHAR(100),
    bench_division VARCHAR(100),
    jurisdiction VARCHAR(100),
    state VARCHAR(100),
    judges JSONB, -- Store as JSONB for flexibility
    court_room_no VARCHAR(50),
    petitioners JSONB, -- Store as JSONB
    respondents JSONB, -- Store as JSONB
    category_type VARCHAR(100),
    primary_category VARCHAR(100),
    sub_category VARCHAR(100),
    complexity VARCHAR(50),
    monetary_value DECIMAL(15, 2),
    priority_level VARCHAR(50),
    status VARCHAR(50) DEFAULT 'Active', -- e.g., Active, Inactive, Closed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add an index for faster lookup by user_id
CREATE INDEX IF NOT EXISTS idx_cases_user_id ON cases(user_id);

-- Add an index for faster lookup by folder_id
CREATE INDEX IF NOT EXISTS idx_cases_folder_id ON cases(folder_id);