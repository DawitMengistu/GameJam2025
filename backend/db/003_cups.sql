-- Cup tournament persistence (source of truth for lobby / bracket / champion).
-- Live match play (secrets, guesses, timers, chat) stays in-memory via socket rooms.

CREATE TABLE IF NOT EXISTS cups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'lobby'
    CHECK (status IN ('lobby', 'running', 'finished')),
  admin_user_id UUID NOT NULL REFERENCES users(id),
  champion_user_id UUID REFERENCES users(id),
  max_players INTEGER NOT NULL DEFAULT 64
    CHECK (max_players >= 4 AND max_players <= 128),
  bracket JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cup_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cup_id UUID NOT NULL REFERENCES cups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  session_id TEXT,
  slot INTEGER,
  display_name TEXT NOT NULL,
  elo_snapshot INTEGER,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cup_id, user_id)
);

CREATE TABLE IF NOT EXISTS cup_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cup_id UUID NOT NULL REFERENCES cups(id) ON DELETE CASCADE,
  match_key TEXT NOT NULL,
  round TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'playing', 'done')),
  player_a_id UUID REFERENCES users(id),
  player_b_id UUID REFERENCES users(id),
  winner_id UUID REFERENCES users(id),
  room_code TEXT,
  board_snapshot JSONB,
  finished_at TIMESTAMPTZ,
  UNIQUE (cup_id, match_key)
);

CREATE INDEX IF NOT EXISTS idx_cups_code ON cups(code);
CREATE INDEX IF NOT EXISTS idx_cups_status ON cups(status);
CREATE INDEX IF NOT EXISTS idx_cups_admin ON cups(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_cup_players_cup ON cup_players(cup_id);
CREATE INDEX IF NOT EXISTS idx_cup_players_user ON cup_players(user_id);
CREATE INDEX IF NOT EXISTS idx_cup_matches_cup ON cup_matches(cup_id);
CREATE INDEX IF NOT EXISTS idx_cup_matches_status ON cup_matches(cup_id, status);

-- Open membership lookup (busy checks / session restore)
CREATE INDEX IF NOT EXISTS idx_cup_players_open
  ON cup_players(user_id)
  INCLUDE (cup_id);
