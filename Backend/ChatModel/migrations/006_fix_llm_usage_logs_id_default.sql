-- Ensure llm_usage_logs.id has a working auto-increment default.
-- Fixes runtime errors:
--   null value in column "id" of relation "llm_usage_logs" violates not-null constraint

DO $$
DECLARE
  max_id BIGINT;
BEGIN
  -- Create sequence if it does not exist.
  IF to_regclass('public.llm_usage_logs_id_seq') IS NULL THEN
    CREATE SEQUENCE public.llm_usage_logs_id_seq;
  END IF;

  -- Set sequence current value to at least MAX(id).
  SELECT COALESCE(MAX(id), 0) INTO max_id FROM public.llm_usage_logs;
  IF max_id > 0 THEN
    PERFORM setval('public.llm_usage_logs_id_seq', max_id, true);
  ELSE
    -- Next nextval() should return 1 when table is empty.
    PERFORM setval('public.llm_usage_logs_id_seq', 1, false);
  END IF;

  -- Attach default and ownership.
  ALTER TABLE public.llm_usage_logs
    ALTER COLUMN id SET DEFAULT nextval('public.llm_usage_logs_id_seq');

  ALTER SEQUENCE public.llm_usage_logs_id_seq
    OWNED BY public.llm_usage_logs.id;
END $$;
