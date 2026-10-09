-- Humans start at 100; reset existing rows that still use the old 1000 default.
ALTER TABLE users ALTER COLUMN elo SET DEFAULT 100;
UPDATE users SET elo = 100, updated_at = now() WHERE elo = 1000;
