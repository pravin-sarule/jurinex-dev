-- Link firm "Dalal" to a specific admin user so User Management works for that account.
-- The app finds the firm by: firms.admin_user_id = <logged-in user id>
--
-- Replace 41 with the numeric user id of the account you log in as (Firm Admin).
-- To find your user id: check users.id for your email in the users table.
--
-- Example: link firm to user id 41
UPDATE firms
SET admin_user_id = 41,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'd7612184-9967-4758-8e3f-e09df2c4c78d';

-- Verify (optional):
-- SELECT id, firm_name, admin_user_id FROM firms WHERE id = 'd7612184-9967-4758-8e3f-e09df2c4c78d';
