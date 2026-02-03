-- Create feedback_requests table to store Huaiyao's feedback
CREATE TABLE IF NOT EXISTS feedback_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user TEXT NOT NULL DEFAULT 'huaiyao',
  summary TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE feedback_requests ENABLE ROW LEVEL SECURITY;

-- Permissive policy for all operations
CREATE POLICY "Allow all operations on feedback_requests" ON feedback_requests
  FOR ALL USING (true) WITH CHECK (true);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_feedback_requests_created_at ON feedback_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_requests_is_read ON feedback_requests(is_read);
