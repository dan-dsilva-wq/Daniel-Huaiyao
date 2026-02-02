-- Story Book tables for collaborative writing

-- Book settings table
CREATE TABLE IF NOT EXISTS book_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT DEFAULT 'Our Story',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sentences/entries table
CREATE TABLE IF NOT EXISTS book_sentences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  writer TEXT NOT NULL CHECK (writer IN ('daniel', 'huaiyao')),
  page_number INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_book_sentences_created_at ON book_sentences(created_at);
CREATE INDEX IF NOT EXISTS idx_book_sentences_writer ON book_sentences(writer);

-- Enable RLS
ALTER TABLE book_sentences ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_settings ENABLE ROW LEVEL SECURITY;

-- Policies for sentences
CREATE POLICY "Allow read sentences" ON book_sentences FOR SELECT USING (true);
CREATE POLICY "Allow insert sentences" ON book_sentences FOR INSERT WITH CHECK (true);

-- Policies for settings
CREATE POLICY "Allow read settings" ON book_settings FOR SELECT USING (true);
CREATE POLICY "Allow update settings" ON book_settings FOR UPDATE USING (true);

-- Insert default book settings
INSERT INTO book_settings (title) VALUES ('Our Story')
ON CONFLICT DO NOTHING;

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE book_sentences;
