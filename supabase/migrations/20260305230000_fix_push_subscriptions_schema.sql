-- Fix push_subscriptions schema drift so web-push APIs work in production.
-- Existing production table is missing user_name and last_used_at columns and has restrictive RLS.

-- 1) Align columns expected by app/api/push-subscribe and app/api/notify
ALTER TABLE IF EXISTS push_subscriptions
  ADD COLUMN IF NOT EXISTS user_name TEXT,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ DEFAULT NOW();

-- 2) Constrain supported app users (if constraint not already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'push_subscriptions_user_name_check'
  ) THEN
    ALTER TABLE push_subscriptions
      ADD CONSTRAINT push_subscriptions_user_name_check
      CHECK (user_name IN ('daniel', 'huaiyao'));
  END IF;
END $$;

-- 3) Ensure endpoint uniqueness for ON CONFLICT(endpoint) upsert path
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON push_subscriptions(endpoint);

-- 4) Index for recipient lookups
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_name
  ON push_subscriptions(user_name);

-- 5) Backfill last_used_at when null
UPDATE push_subscriptions
SET last_used_at = COALESCE(last_used_at, updated_at, created_at, NOW())
WHERE last_used_at IS NULL;

-- 6) RLS policies: allow this private 2-user app to read/write subscriptions
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read push_subscriptions" ON push_subscriptions;
CREATE POLICY "Allow read push_subscriptions"
  ON push_subscriptions
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow insert push_subscriptions" ON push_subscriptions;
CREATE POLICY "Allow insert push_subscriptions"
  ON push_subscriptions
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update push_subscriptions" ON push_subscriptions;
CREATE POLICY "Allow update push_subscriptions"
  ON push_subscriptions
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete push_subscriptions" ON push_subscriptions;
CREATE POLICY "Allow delete push_subscriptions"
  ON push_subscriptions
  FOR DELETE
  USING (true);

-- 7) Explicit grants in case table privileges drifted
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE push_subscriptions TO anon, authenticated, service_role;
