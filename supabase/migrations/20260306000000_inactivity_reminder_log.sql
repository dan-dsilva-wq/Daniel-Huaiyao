-- Inactivity reminder dedupe log for shared contribution flows.

CREATE TABLE IF NOT EXISTS inactivity_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name TEXT NOT NULL CHECK (app_name IN ('book', 'prompts')),
  user_name TEXT NOT NULL CHECK (user_name IN ('daniel', 'huaiyao')),
  reference_key TEXT NOT NULL,
  reminder_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_name, user_name, reference_key, reminder_date)
);

CREATE INDEX IF NOT EXISTS idx_inactivity_reminder_log_lookup
  ON inactivity_reminder_log(app_name, user_name, reminder_date DESC);

ALTER TABLE inactivity_reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read inactivity_reminder_log" ON inactivity_reminder_log;
CREATE POLICY "Allow read inactivity_reminder_log"
  ON inactivity_reminder_log
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow insert inactivity_reminder_log" ON inactivity_reminder_log;
CREATE POLICY "Allow insert inactivity_reminder_log"
  ON inactivity_reminder_log
  FOR INSERT
  WITH CHECK (true);

GRANT SELECT, INSERT ON TABLE inactivity_reminder_log TO anon, authenticated, service_role;
