-- Mystery Branch Visualization - Session History tracking

CREATE TABLE mystery_session_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES mystery_sessions(id) ON DELETE CASCADE,
  scene_id UUID NOT NULL REFERENCES mystery_scenes(id) ON DELETE CASCADE,
  choice_id UUID REFERENCES mystery_choices(id) ON DELETE SET NULL,
  scene_order INTEGER NOT NULL,
  visited_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, scene_order)
);

-- Indexes
CREATE INDEX idx_mystery_session_history_session ON mystery_session_history(session_id);
CREATE INDEX idx_mystery_session_history_scene ON mystery_session_history(scene_id);

-- RPC: Record a scene visit in history
CREATE OR REPLACE FUNCTION record_scene_visit(
  p_session_id UUID,
  p_scene_id UUID,
  p_choice_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  next_order INTEGER;
BEGIN
  -- Get next order number
  SELECT COALESCE(MAX(scene_order), 0) + 1 INTO next_order
  FROM mystery_session_history
  WHERE session_id = p_session_id;

  -- Insert history record
  INSERT INTO mystery_session_history (session_id, scene_id, choice_id, scene_order)
  VALUES (p_session_id, p_scene_id, p_choice_id, next_order)
  ON CONFLICT (session_id, scene_order) DO UPDATE
  SET scene_id = EXCLUDED.scene_id,
      choice_id = EXCLUDED.choice_id,
      visited_at = NOW();

  RETURN TRUE;
END;
$$;

-- RPC: Get session history with scene/choice details for branch visualization
CREATE OR REPLACE FUNCTION get_session_history(p_session_id UUID)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'session_id', p_session_id,
    'history', COALESCE((
      SELECT json_agg(json_build_object(
        'id', h.id,
        'scene_id', h.scene_id,
        'scene_title', s.title,
        'scene_type', s.scene_type,
        'choice_id', h.choice_id,
        'choice_text', c.choice_text,
        'scene_order', h.scene_order,
        'visited_at', h.visited_at
      ) ORDER BY h.scene_order)
      FROM mystery_session_history h
      JOIN mystery_scenes s ON s.id = h.scene_id
      LEFT JOIN mystery_choices c ON c.id = h.choice_id
      WHERE h.session_id = p_session_id
    ), '[]'::json),
    'total_scenes', (
      SELECT COUNT(*) FROM mystery_session_history WHERE session_id = p_session_id
    ),
    'unique_paths', (
      SELECT COUNT(DISTINCT scene_id) FROM mystery_session_history WHERE session_id = p_session_id
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- RPC: Get episode branch statistics
CREATE OR REPLACE FUNCTION get_episode_branch_stats(p_episode_id UUID)
RETURNS JSON
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN json_build_object(
    'episode_id', p_episode_id,
    'total_sessions', (
      SELECT COUNT(*) FROM mystery_sessions WHERE episode_id = p_episode_id
    ),
    'completed_sessions', (
      SELECT COUNT(*) FROM mystery_sessions
      WHERE episode_id = p_episode_id AND status = 'completed'
    ),
    'scene_visits', COALESCE((
      SELECT json_agg(json_build_object(
        'scene_id', s.id,
        'scene_title', s.title,
        'scene_type', s.scene_type,
        'visit_count', COALESCE(visit_counts.cnt, 0)
      ) ORDER BY COALESCE(visit_counts.cnt, 0) DESC)
      FROM mystery_scenes s
      LEFT JOIN (
        SELECT h.scene_id, COUNT(*) as cnt
        FROM mystery_session_history h
        JOIN mystery_sessions ses ON ses.id = h.session_id
        WHERE ses.episode_id = p_episode_id
        GROUP BY h.scene_id
      ) visit_counts ON visit_counts.scene_id = s.id
      WHERE s.episode_id = p_episode_id
    ), '[]'::json),
    'choice_stats', COALESCE((
      SELECT json_agg(json_build_object(
        'choice_id', c.id,
        'choice_text', c.choice_text,
        'from_scene', fs.title,
        'to_scene', ts.title,
        'times_chosen', COALESCE(choice_counts.cnt, 0)
      ) ORDER BY COALESCE(choice_counts.cnt, 0) DESC)
      FROM mystery_choices c
      JOIN mystery_scenes fs ON fs.id = c.scene_id
      LEFT JOIN mystery_scenes ts ON ts.id = c.next_scene_id
      LEFT JOIN (
        SELECT h.choice_id, COUNT(*) as cnt
        FROM mystery_session_history h
        JOIN mystery_sessions ses ON ses.id = h.session_id
        WHERE ses.episode_id = p_episode_id AND h.choice_id IS NOT NULL
        GROUP BY h.choice_id
      ) choice_counts ON choice_counts.choice_id = c.id
      WHERE fs.episode_id = p_episode_id
    ), '[]'::json),
    'ending_distribution', COALESCE((
      SELECT json_agg(json_build_object(
        'ending_id', e.id,
        'ending_title', e.title,
        'ending_type', e.ending_type,
        'times_reached', COALESCE(ending_counts.cnt, 0)
      ) ORDER BY COALESCE(ending_counts.cnt, 0) DESC)
      FROM mystery_endings e
      LEFT JOIN (
        SELECT ses.ending_id, COUNT(*) as cnt
        FROM mystery_sessions ses
        WHERE ses.episode_id = p_episode_id AND ses.ending_id IS NOT NULL
        GROUP BY ses.ending_id
      ) ending_counts ON ending_counts.ending_id = e.id
      WHERE e.episode_id = p_episode_id
    ), '[]'::json)
  );
END;
$$;

-- Enable RLS
ALTER TABLE mystery_session_history ENABLE ROW LEVEL SECURITY;

-- RLS policy
CREATE POLICY "Allow all access to mystery_session_history" ON mystery_session_history FOR ALL USING (true);
