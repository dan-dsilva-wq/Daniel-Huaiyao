-- Fix get_ai_game_state to handle NULL ai_scene
-- The function was crashing when trying to access ai_scene.id when no scene exists yet

CREATE OR REPLACE FUNCTION get_ai_game_state(p_session_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  session_data mystery_sessions;
  episode_data mystery_episodes;
  ai_scene mystery_ai_scenes;
  ai_choices JSON;
  ai_puzzle mystery_ai_puzzles;
  ai_responses JSON;
  history_entries JSON;
BEGIN
  -- Get session
  SELECT * INTO session_data FROM mystery_sessions WHERE id = p_session_id;
  IF session_data IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get episode
  SELECT * INTO episode_data FROM mystery_episodes WHERE id = session_data.episode_id;

  -- Get current AI scene (may be NULL if not generated yet)
  SELECT * INTO ai_scene
  FROM mystery_ai_scenes
  WHERE session_id = p_session_id
    AND scene_order = session_data.current_ai_scene_order;

  -- Only get choices/puzzle if scene exists
  IF ai_scene IS NOT NULL THEN
    -- Get choices for current scene
    SELECT json_agg(json_build_object(
      'id', c.id,
      'choice_order', c.choice_order,
      'choice_text', c.choice_text,
      'is_custom_input', c.is_custom_input
    ) ORDER BY c.choice_order)
    INTO ai_choices
    FROM mystery_ai_choices c
    WHERE c.ai_scene_id = ai_scene.id;

    -- Get puzzle for current scene (if any)
    SELECT * INTO ai_puzzle
    FROM mystery_ai_puzzles
    WHERE ai_scene_id = ai_scene.id;
  ELSE
    ai_choices := '[]'::json;
    ai_puzzle := NULL;
  END IF;

  -- Get responses for current scene
  SELECT json_agg(json_build_object(
    'player', r.player,
    'response_text', r.response_text
  ))
  INTO ai_responses
  FROM mystery_ai_responses r
  WHERE r.session_id = p_session_id
    AND r.scene_order = session_data.current_ai_scene_order;

  -- Get recent history (last 10 entries for context display)
  SELECT json_agg(json_build_object(
    'role', h.role,
    'content', h.content,
    'scene_order', h.scene_order
  ) ORDER BY h.created_at DESC)
  INTO history_entries
  FROM (
    SELECT * FROM mystery_ai_history
    WHERE session_id = p_session_id
    ORDER BY created_at DESC
    LIMIT 10
  ) h;

  RETURN json_build_object(
    'session', json_build_object(
      'id', session_data.id,
      'status', session_data.status,
      'daniel_joined', session_data.daniel_joined,
      'huaiyao_joined', session_data.huaiyao_joined,
      'daniel_last_seen', session_data.daniel_last_seen,
      'huaiyao_last_seen', session_data.huaiyao_last_seen,
      'current_ai_scene_order', session_data.current_ai_scene_order
    ),
    'episode', json_build_object(
      'id', episode_data.id,
      'title', episode_data.title,
      'episode_number', episode_data.episode_number,
      'is_ai_driven', episode_data.is_ai_driven
    ),
    'scene', CASE WHEN ai_scene IS NULL THEN NULL ELSE json_build_object(
      'id', ai_scene.id,
      'scene_order', ai_scene.scene_order,
      'title', ai_scene.title,
      'narrative_text', ai_scene.narrative_text,
      'is_decision_point', ai_scene.is_decision_point,
      'is_ending', ai_scene.is_ending,
      'ending_type', ai_scene.ending_type
    ) END,
    'choices', COALESCE(ai_choices, '[]'::json),
    'puzzle', CASE WHEN ai_puzzle IS NULL THEN NULL ELSE json_build_object(
      'id', ai_puzzle.id,
      'puzzle_type', ai_puzzle.puzzle_type,
      'difficulty', ai_puzzle.difficulty,
      'title', ai_puzzle.title,
      'description', ai_puzzle.description,
      'puzzle_data', ai_puzzle.puzzle_data,
      'hints', ai_puzzle.hints,
      'max_hints', ai_puzzle.max_hints
    ) END,
    'responses', COALESCE(ai_responses, '[]'::json),
    'history', COALESCE(history_entries, '[]'::json),
    'needs_generation', ai_scene IS NULL
  );
END;
$$;
