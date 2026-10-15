-- Football-kit style profile numbers (1–99). Telegram fields stay separate.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS kit_number SMALLINT;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_kit_number_check;

ALTER TABLE users
  ADD CONSTRAINT users_kit_number_check
  CHECK (kit_number IS NULL OR (kit_number >= 1 AND kit_number <= 99));

-- Seed existing users with a stable kit from their id hash
UPDATE users
SET kit_number = (ABS(HASHTEXT(id::text)) % 99) + 1
WHERE kit_number IS NULL;
