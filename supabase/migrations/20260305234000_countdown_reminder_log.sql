-- Countdown reminder dedupe log.
-- Prevents duplicate sends for the same event/user/day-offset/occurrence.

CREATE TABLE IF NOT EXISTS countdown_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES important_dates(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL CHECK (user_name IN ('daniel', 'huaiyao')),
  reminder_days INTEGER NOT NULL CHECK (reminder_days IN (0, 1, 3, 7)),
  occurrence_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_name, reminder_days, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_countdown_reminder_log_user_created
  ON countdown_reminder_log(user_name, created_at DESC);

ALTER TABLE countdown_reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read countdown_reminder_log" ON countdown_reminder_log;
CREATE POLICY "Allow read countdown_reminder_log"
  ON countdown_reminder_log
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow insert countdown_reminder_log" ON countdown_reminder_log;
CREATE POLICY "Allow insert countdown_reminder_log"
  ON countdown_reminder_log
  FOR INSERT
  WITH CHECK (true);

GRANT SELECT, INSERT ON TABLE countdown_reminder_log TO anon, authenticated, service_role;
