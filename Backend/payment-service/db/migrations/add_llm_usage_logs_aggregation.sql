-- Migration: Add aggregation support to llm_usage_logs table
-- This adds a date column and unique constraint for daily aggregation by user + model

-- Add a date column for easier aggregation
ALTER TABLE public.llm_usage_logs 
ADD COLUMN IF NOT EXISTS used_date DATE GENERATED ALWAYS AS (DATE(used_at)) STORED;

-- Create a unique index for aggregation (user + model + date)
-- This allows us to use INSERT ... ON CONFLICT to aggregate tokens
CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_usage_logs_user_model_date 
ON public.llm_usage_logs(user_id, model_name, used_date);

-- Add index on used_date for better query performance
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_used_date 
ON public.llm_usage_logs(used_date);






