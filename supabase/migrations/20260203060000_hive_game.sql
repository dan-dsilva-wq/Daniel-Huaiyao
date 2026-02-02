-- Hive game table
CREATE TABLE IF NOT EXISTS hive_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),

  -- Players
  white_player TEXT CHECK (white_player IN ('daniel', 'huaiyao')),
  black_player TEXT CHECK (black_player IN ('daniel', 'huaiyao')),
  current_turn TEXT NOT NULL DEFAULT 'white' CHECK (current_turn IN ('white', 'black')),
  turn_number INTEGER NOT NULL DEFAULT 1,

  -- Game state stored as JSONB
  board_state JSONB DEFAULT '[]'::jsonb,
  white_hand JSONB DEFAULT '[]'::jsonb,
  black_hand JSONB DEFAULT '[]'::jsonb,
  white_queen_placed BOOLEAN DEFAULT false,
  black_queen_placed BOOLEAN DEFAULT false,
  last_moved_piece JSONB DEFAULT null,

  -- Settings
  expansion_pieces JSONB DEFAULT '{"ladybug": false, "mosquito": false, "pillbug": false}'::jsonb,

  -- Results
  winner TEXT CHECK (winner IN ('white', 'black', 'draw')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_hive_games_short_code ON hive_games(short_code);
CREATE INDEX IF NOT EXISTS idx_hive_games_status ON hive_games(status);

-- Enable RLS
ALTER TABLE hive_games ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Allow read hive games" ON hive_games FOR SELECT USING (true);
CREATE POLICY "Allow insert hive games" ON hive_games FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update hive games" ON hive_games FOR UPDATE USING (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE hive_games;

-- Function to generate short code
CREATE OR REPLACE FUNCTION generate_hive_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := 'HIVE-';
  i INTEGER;
BEGIN
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;
