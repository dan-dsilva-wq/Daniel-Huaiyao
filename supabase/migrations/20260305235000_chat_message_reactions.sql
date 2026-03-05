-- Chat message reactions (one reaction per user per message).

CREATE TABLE IF NOT EXISTS chat_message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL CHECK (user_name IN ('daniel', 'huaiyao')),
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_name)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_message
  ON chat_message_reactions(message_id);

ALTER TABLE chat_message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access chat_message_reactions" ON chat_message_reactions;
CREATE POLICY "Allow read access chat_message_reactions"
  ON chat_message_reactions
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow insert access chat_message_reactions" ON chat_message_reactions;
CREATE POLICY "Allow insert access chat_message_reactions"
  ON chat_message_reactions
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update access chat_message_reactions" ON chat_message_reactions;
CREATE POLICY "Allow update access chat_message_reactions"
  ON chat_message_reactions
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete access chat_message_reactions" ON chat_message_reactions;
CREATE POLICY "Allow delete access chat_message_reactions"
  ON chat_message_reactions
  FOR DELETE
  USING (true);

CREATE OR REPLACE FUNCTION set_chat_message_reactions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_message_reactions_updated_at ON chat_message_reactions;
CREATE TRIGGER trg_chat_message_reactions_updated_at
  BEFORE UPDATE ON chat_message_reactions
  FOR EACH ROW
  EXECUTE FUNCTION set_chat_message_reactions_updated_at();

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE chat_message_reactions;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
