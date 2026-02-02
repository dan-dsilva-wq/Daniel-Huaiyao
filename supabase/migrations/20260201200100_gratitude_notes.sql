-- Gratitude notes table for gratitude wall
CREATE TABLE gratitude_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_player TEXT NOT NULL CHECK (from_player IN ('daniel', 'huaiyao')),
  to_player TEXT NOT NULL CHECK (to_player IN ('daniel', 'huaiyao')),
  note_text TEXT NOT NULL,
  category TEXT DEFAULT 'love' CHECK (category IN ('love', 'gratitude', 'appreciation', 'encouragement', 'memory')),
  emoji TEXT DEFAULT '💝',
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (from_player != to_player)
);

-- RPC to get gratitude notes for a player
CREATE OR REPLACE FUNCTION get_gratitude_notes(p_player TEXT)
RETURNS TABLE (
  received JSON,
  sent JSON,
  unread_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COALESCE(json_agg(row_to_json(r.*) ORDER BY r.created_at DESC), '[]'::json)
     FROM gratitude_notes r WHERE r.to_player = p_player) AS received,
    (SELECT COALESCE(json_agg(row_to_json(s.*) ORDER BY s.created_at DESC), '[]'::json)
     FROM gratitude_notes s WHERE s.from_player = p_player) AS sent,
    (SELECT COUNT(*) FROM gratitude_notes WHERE to_player = p_player AND is_read = false) AS unread_count;
END;
$$ LANGUAGE plpgsql;

-- RPC to add a gratitude note
CREATE OR REPLACE FUNCTION add_gratitude_note(
  p_from_player TEXT,
  p_to_player TEXT,
  p_note_text TEXT,
  p_category TEXT DEFAULT 'love',
  p_emoji TEXT DEFAULT '💝'
)
RETURNS UUID AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO gratitude_notes (from_player, to_player, note_text, category, emoji)
  VALUES (p_from_player, p_to_player, p_note_text, p_category, p_emoji)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- RPC to mark all notes as read for a player
CREATE OR REPLACE FUNCTION mark_notes_read(p_player TEXT)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE gratitude_notes
  SET is_read = true
  WHERE to_player = p_player AND is_read = false;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE gratitude_notes ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now
CREATE POLICY "Allow all access to gratitude_notes"
  ON gratitude_notes
  FOR ALL
  USING (true)
  WITH CHECK (true);
