CREATE TABLE user_usage (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    plan_id INTEGER NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    documents_used INTEGER NOT NULL DEFAULT 0,
    ai_analysis_used INTEGER NOT NULL DEFAULT 0,
    storage_used_gb DECIMAL(10, 2) NOT NULL DEFAULT 0.0,
    carry_over_tokens INTEGER NOT NULL DEFAULT 0,
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign key constraint to link with subscription_plans table in payment service
    -- This assumes a mechanism to access or replicate plan IDs across services.
    -- For a true microservice architecture, this might be a UUID and managed via events.
    -- For simplicity, we'll assume plan_id refers to the id in subscription_plans.
    -- FOREIGN KEY (plan_id) REFERENCES subscription_plans(id), 
    
    -- Add unique constraint for user_id and plan_id to ensure one usage record per user per plan
    UNIQUE (user_id, plan_id)
);

-- Add indexes for frequently queried columns
CREATE INDEX idx_user_usage_user_id ON user_usage (user_id);
CREATE INDEX idx_user_usage_plan_id ON user_usage (plan_id);
CREATE INDEX idx_user_usage_period_end ON user_usage (period_end);

-- Add a function to update the updated_at column automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add a trigger to update the updated_at column on each update
CREATE TRIGGER update_user_usage_updated_at
BEFORE UPDATE ON user_usage
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();