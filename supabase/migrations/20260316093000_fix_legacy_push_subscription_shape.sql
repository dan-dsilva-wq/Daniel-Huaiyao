-- Normalize legacy push subscription table names and schema so notification subscribe works.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'push_subscription'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'push_subscriptions'
  ) THEN
    EXECUTE 'ALTER TABLE public.push_subscription RENAME TO push_subscriptions';
  END IF;
END $$;

ALTER TABLE IF EXISTS push_subscriptions
  ADD COLUMN IF NOT EXISTS user_name TEXT,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS timezone TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'push_subscriptions'
      AND column_name = 'user_id'
  ) THEN
    BEGIN
      EXECUTE 'ALTER TABLE push_subscriptions ALTER COLUMN user_id DROP NOT NULL';
    EXCEPTION
      WHEN others THEN
        RAISE NOTICE 'Could not drop NOT NULL on push_subscriptions.user_id: %', SQLERRM;
    END;

    BEGIN
      EXECUTE $sql$
        UPDATE push_subscriptions
        SET user_name = COALESCE(
          user_name,
          CASE LOWER(user_id::text)
            WHEN 'daniel' THEN 'daniel'
            WHEN 'huaiyao' THEN 'huaiyao'
            ELSE NULL
          END
        )
        WHERE user_name IS NULL
      $sql$;
    EXCEPTION
      WHEN others THEN
        RAISE NOTICE 'Could not backfill push_subscriptions.user_name from user_id: %', SQLERRM;
    END;
  END IF;
END $$;

DO $$
DECLARE
  has_updated_at BOOLEAN;
  has_created_at BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'push_subscriptions'
      AND column_name = 'updated_at'
  ) INTO has_updated_at;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'push_subscriptions'
      AND column_name = 'created_at'
  ) INTO has_created_at;

  IF has_updated_at AND has_created_at THEN
    EXECUTE '
      UPDATE push_subscriptions
      SET last_used_at = COALESCE(last_used_at, updated_at, created_at, NOW())
      WHERE last_used_at IS NULL
    ';
  ELSIF has_created_at THEN
    EXECUTE '
      UPDATE push_subscriptions
      SET last_used_at = COALESCE(last_used_at, created_at, NOW())
      WHERE last_used_at IS NULL
    ';
  ELSE
    EXECUTE '
      UPDATE push_subscriptions
      SET last_used_at = COALESCE(last_used_at, NOW())
      WHERE last_used_at IS NULL
    ';
  END IF;
END $$;

UPDATE push_subscriptions
SET timezone = 'UTC'
WHERE timezone IS NULL OR BTRIM(timezone) = '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'push_subscriptions_user_name_check'
      AND conrelid = 'push_subscriptions'::regclass
  ) THEN
    ALTER TABLE push_subscriptions
      DROP CONSTRAINT push_subscriptions_user_name_check;
  END IF;
END $$;

ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_user_name_check
  CHECK (user_name IN ('daniel', 'huaiyao'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON push_subscriptions(endpoint);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_name
  ON push_subscriptions(user_name);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_name_last_used
  ON push_subscriptions(user_name, last_used_at DESC);

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

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE push_subscriptions TO anon, authenticated, service_role;
