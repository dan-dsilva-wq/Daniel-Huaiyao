-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user TEXT NOT NULL CHECK (from_user IN ('daniel', 'huaiyao')),
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick retrieval
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON chat_messages(is_read) WHERE is_read = false;

-- Enable RLS but allow all operations (private app, just 2 users)
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read messages
CREATE POLICY "Allow read access" ON chat_messages
  FOR SELECT USING (true);

-- Allow anyone to insert messages
CREATE POLICY "Allow insert access" ON chat_messages
  FOR INSERT WITH CHECK (true);

-- Allow anyone to update messages (for marking as read)
CREATE POLICY "Allow update access" ON chat_messages
  FOR UPDATE USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
