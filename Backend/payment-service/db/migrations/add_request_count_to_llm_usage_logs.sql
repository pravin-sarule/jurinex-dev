-- Migration: Add request_count column to llm_usage_logs table
-- This tracks the number of individual requests aggregated in each row
-- This fixes the issue where COUNT(*) was counting aggregated rows instead of actual requests

-- Step 1: Add request_count column if it doesn't exist (nullable first for safety)
ALTER TABLE public.llm_usage_logs 
ADD COLUMN IF NOT EXISTS request_count INTEGER;

-- Step 2: Set default value of 1 for all existing rows (each existing row represents at least 1 request)
-- This ensures backward compatibility
UPDATE public.llm_usage_logs 
SET request_count = 1 
WHERE request_count IS NULL;

-- Step 3: Now make it NOT NULL with default value of 1
ALTER TABLE public.llm_usage_logs 
ALTER COLUMN request_count SET DEFAULT 1;

-- Step 4: Make it NOT NULL (this will work since we set all NULLs to 1 above)
ALTER TABLE public.llm_usage_logs 
ALTER COLUMN request_count SET NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.llm_usage_logs.request_count IS 'Number of individual LLM requests aggregated in this row (for daily aggregation). Increments by 1 each time a new request is logged for the same user+model+date.';

-- Verify the column was added
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'llm_usage_logs' 
        AND column_name = 'request_count'
    ) THEN
        RAISE NOTICE '✅ request_count column successfully added to llm_usage_logs table';
    ELSE
        RAISE EXCEPTION '❌ Failed to add request_count column';
    END IF;
END $$;
