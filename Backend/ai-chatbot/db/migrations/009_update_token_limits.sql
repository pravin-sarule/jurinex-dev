-- Increase max_tokens default and existing stored value from 150 → 2048.
-- 150 was too low for formatted step-by-step + markdown responses.

ALTER TABLE chatbot_config ALTER COLUMN max_tokens SET DEFAULT 2048;

UPDATE chatbot_config
   SET max_tokens = 2048
 WHERE config_key = 'default'
   AND max_tokens = 150;
