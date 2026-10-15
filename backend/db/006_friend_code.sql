-- Public 8-digit friend ID for adding friends (not searchable by name)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS friend_code TEXT;

DO $$
DECLARE
  r RECORD;
  candidate TEXT;
BEGIN
  FOR r IN SELECT id FROM users WHERE friend_code IS NULL LOOP
    LOOP
      candidate := LPAD((floor(random() * 100000000))::int::text, 8, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE friend_code = candidate);
    END LOOP;
    UPDATE users SET friend_code = candidate WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE users
  ALTER COLUMN friend_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_friend_code_uidx ON users (friend_code);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_friend_code_format;

ALTER TABLE users
  ADD CONSTRAINT users_friend_code_format
  CHECK (friend_code ~ '^[0-9]{8}$');
