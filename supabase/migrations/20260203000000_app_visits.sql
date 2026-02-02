-- Shared app visit tracking
CREATE TABLE app_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name TEXT NOT NULL,
  visited_by TEXT CHECK (visited_by IN ('daniel', 'huaiyao')),
  visited_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick counting
CREATE INDEX idx_app_visits_app_name ON app_visits(app_name);
CREATE INDEX idx_app_visits_visited_at ON app_visits(visited_at);

-- Function to record a visit
CREATE OR REPLACE FUNCTION record_app_visit(p_app_name TEXT, p_visited_by TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO app_visits (app_name, visited_by)
  VALUES (p_app_name, p_visited_by);
END;
$$;

-- Function to get visit counts for last 30 days
CREATE OR REPLACE FUNCTION get_app_visit_counts()
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_object_agg(app_name, visit_count)
  INTO result
  FROM (
    SELECT app_name, COUNT(*) as visit_count
    FROM app_visits
    WHERE visited_at > NOW() - INTERVAL '30 days'
    GROUP BY app_name
  ) counts;

  RETURN COALESCE(result, '{}'::json);
END;
$$;
