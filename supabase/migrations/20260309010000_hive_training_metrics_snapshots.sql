CREATE TABLE IF NOT EXISTS hive_training_metrics_snapshots (
  name TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  content_size INTEGER NOT NULL DEFAULT 0 CHECK (content_size >= 0),
  source_path TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO hive_training_metrics_snapshots (name)
VALUES ('default')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE hive_training_metrics_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read hive training metric snapshots" ON hive_training_metrics_snapshots;
DROP POLICY IF EXISTS "Allow write hive training metric snapshots" ON hive_training_metrics_snapshots;

CREATE POLICY "Allow read hive training metric snapshots"
ON hive_training_metrics_snapshots FOR SELECT
USING (true);

CREATE POLICY "Allow write hive training metric snapshots"
ON hive_training_metrics_snapshots FOR ALL
USING (true)
WITH CHECK (true);
