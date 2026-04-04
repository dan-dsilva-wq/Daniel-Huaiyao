CREATE TABLE IF NOT EXISTS book_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  created_by TEXT CHECK (created_by IN ('daniel', 'huaiyao')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE book_stories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read book stories" ON book_stories;
CREATE POLICY "Allow read book stories" ON book_stories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert book stories" ON book_stories;
CREATE POLICY "Allow insert book stories" ON book_stories FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update book stories" ON book_stories;
CREATE POLICY "Allow update book stories" ON book_stories FOR UPDATE USING (true);

INSERT INTO book_stories (title)
SELECT 'Our Story'
WHERE NOT EXISTS (SELECT 1 FROM book_stories);

ALTER TABLE book_sentences
  ADD COLUMN IF NOT EXISTS story_id UUID REFERENCES book_stories(id) ON DELETE CASCADE;

UPDATE book_sentences
SET story_id = (SELECT id FROM book_stories ORDER BY created_at ASC LIMIT 1)
WHERE story_id IS NULL;

ALTER TABLE book_sentences
  ALTER COLUMN story_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_book_sentences_story_id ON book_sentences(story_id);
CREATE INDEX IF NOT EXISTS idx_book_stories_updated_at ON book_stories(updated_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE book_stories;
