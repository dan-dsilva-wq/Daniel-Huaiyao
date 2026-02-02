-- Quiz categories table
CREATE TABLE quiz_categories (
  name TEXT PRIMARY KEY,
  emoji TEXT DEFAULT '📝',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default categories
INSERT INTO quiz_categories (name, emoji, sort_order) VALUES
  ('general', '📝', 0),
  ('favorites', '⭐', 1),
  ('personality', '🧠', 2),
  ('memories', '💭', 3),
  ('dreams', '✨', 4),
  ('hypotheticals', '🤔', 5),
  ('this-or-that', '⚖️', 6),
  ('random', '🎲', 7)
ON CONFLICT (name) DO NOTHING;

-- Add category column to quiz_questions if it doesn't exist
ALTER TABLE quiz_questions
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general' REFERENCES quiz_categories(name);

-- RPC to get quiz categories
CREATE OR REPLACE FUNCTION get_quiz_categories()
RETURNS TABLE (name TEXT, emoji TEXT, sort_order INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT c.name, c.emoji, c.sort_order
  FROM quiz_categories c
  ORDER BY c.sort_order;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE quiz_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to quiz_categories"
  ON quiz_categories FOR ALL USING (true) WITH CHECK (true);
