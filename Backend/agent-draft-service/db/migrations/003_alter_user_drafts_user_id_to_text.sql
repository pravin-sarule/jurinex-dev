-- If user_drafts.user_id was created as UUID (or TEXT), change it to INTEGER (JWT user id is integer).
-- When column is UUID: existing rows get 0. When column is TEXT: use the expression below.
-- Run the one that matches your current column type.

-- If user_id is UUID (invalid input syntax for type uuid: "3"):
ALTER TABLE user_drafts
  ALTER COLUMN user_id TYPE INTEGER USING (0);

-- If user_id is already TEXT, use this instead (comment out the one above):
-- ALTER TABLE user_drafts
--   ALTER COLUMN user_id TYPE INTEGER USING (NULLIF(trim(user_id), '')::integer);
