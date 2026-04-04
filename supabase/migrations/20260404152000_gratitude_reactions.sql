CREATE TABLE gratitude_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES gratitude_notes(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL CHECK (user_name IN ('daniel', 'huaiyao')),
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (note_id, user_name, emoji)
);

CREATE INDEX idx_gratitude_reactions_note_id ON gratitude_reactions(note_id);

ALTER TABLE gratitude_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to gratitude_reactions"
  ON gratitude_reactions
  FOR ALL
  USING (true)
  WITH CHECK (true);
