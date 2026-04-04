CREATE TABLE surprise_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name TEXT NOT NULL CHECK (user_name IN ('daniel', 'huaiyao')),
  cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  active_idea_key TEXT,
  active_idea_title TEXT,
  active_idea_description TEXT,
  active_idea_vibe TEXT,
  active_idea_effort TEXT,
  recent_idea_keys TEXT[] DEFAULT '{}'::TEXT[],
  last_generated_at TIMESTAMPTZ,
  next_available_at TIMESTAMPTZ,
  last_notified_ready_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_name, cadence)
);

CREATE INDEX idx_surprise_tracks_user ON surprise_tracks(user_name);
CREATE INDEX idx_surprise_tracks_available ON surprise_tracks(next_available_at);

ALTER TABLE surprise_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to surprise_tracks"
  ON surprise_tracks
  FOR ALL
  USING (true)
  WITH CHECK (true);
