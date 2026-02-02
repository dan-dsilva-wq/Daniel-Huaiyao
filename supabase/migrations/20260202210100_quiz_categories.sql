-- Quiz categories
CREATE TABLE IF NOT EXISTS quiz_categories (
  name TEXT PRIMARY KEY,
  emoji TEXT DEFAULT '📝',
  description TEXT,
  sort_order INTEGER DEFAULT 0
);

-- Add missing columns if table already exists
ALTER TABLE quiz_categories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE quiz_categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Add category column to quiz_questions
ALTER TABLE quiz_questions
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general';

-- Insert default categories
INSERT INTO quiz_categories (name, emoji, description, sort_order) VALUES
  ('general', '📝', 'General knowledge questions', 0),
  ('favorites', '⭐', 'Questions about favorites', 1),
  ('memories', '💭', 'Questions about shared memories', 2),
  ('personality', '🧠', 'Questions about personality traits', 3),
  ('dreams', '✨', 'Questions about dreams and goals', 4),
  ('hypotheticals', '🤔', 'Hypothetical scenarios', 5),
  ('fun', '🎲', 'Random fun questions', 6)
ON CONFLICT (name) DO NOTHING;

-- Function to get categories (drop first if signature changed)
DROP FUNCTION IF EXISTS get_quiz_categories();
CREATE OR REPLACE FUNCTION get_quiz_categories()
RETURNS TABLE(name TEXT, emoji TEXT, description TEXT, sort_order INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT qc.name, qc.emoji, qc.description, qc.sort_order
  FROM quiz_categories qc
  ORDER BY qc.sort_order;
END;
$$;
