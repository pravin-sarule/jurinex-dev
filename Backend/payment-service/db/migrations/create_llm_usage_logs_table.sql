-- Migration: Create llm_usage_logs table
-- This table stores LLM model usage information including tokens and costs

CREATE TABLE IF NOT EXISTS public.llm_usage_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL, -- Logical reference to authservice.users.id (NO FK constraint in microservice architecture)
    
    -- LLM Model Information
    model_name VARCHAR(255) NOT NULL, -- e.g., 'gemini-2.5-flash-001', 'gemini-3-pro-preview'
    
    -- Token Usage
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0, -- input_tokens + output_tokens
    
    -- Cost Information (in Indian Rupees)
    input_cost DECIMAL(15, 4) NOT NULL DEFAULT 0.0, -- Cost for input tokens
    output_cost DECIMAL(15, 4) NOT NULL DEFAULT 0.0, -- Cost for output tokens
    total_cost DECIMAL(15, 4) NOT NULL DEFAULT 0.0, -- Total cost (input_cost + output_cost)
    
    -- Additional Metadata
    request_id VARCHAR(255), -- Optional: for tracking specific requests
    endpoint VARCHAR(255), -- e.g., '/api/chat/ask', '/api/chat/stream'
    file_id UUID, -- Optional: associated file if applicable
    session_id VARCHAR(255), -- Optional: chat session ID
    
    -- Timestamps
    used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_user_id ON public.llm_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_model_name ON public.llm_usage_logs(model_name);
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_used_at ON public.llm_usage_logs(used_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_user_used_at ON public.llm_usage_logs(user_id, used_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_file_id ON public.llm_usage_logs(file_id);

-- Add comment for documentation
COMMENT ON TABLE public.llm_usage_logs IS 'Tracks LLM model usage including token consumption and costs in Indian Rupees';
COMMENT ON COLUMN public.llm_usage_logs.model_name IS 'Name of the LLM model used (e.g., gemini-2.5-flash-001)';
COMMENT ON COLUMN public.llm_usage_logs.input_tokens IS 'Number of input tokens consumed';
COMMENT ON COLUMN public.llm_usage_logs.output_tokens IS 'Number of output tokens generated';
COMMENT ON COLUMN public.llm_usage_logs.total_tokens IS 'Total tokens (input + output)';
COMMENT ON COLUMN public.llm_usage_logs.total_cost IS 'Total cost in Indian Rupees (INR)';






