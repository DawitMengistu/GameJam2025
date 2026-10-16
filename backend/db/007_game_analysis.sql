-- Post-game move analysis (NN referee report)
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS analysis JSONB;
