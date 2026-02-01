-- Fix start_mystery_session to handle AI-driven episodes
-- AI episodes don't have pre-defined scenes, so we allow NULL for current_scene_id

CREATE OR REPLACE FUNCTION start_mystery_session(p_episode_id UUID, p_player TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  first_scene_id UUID;
  new_session mystery_sessions;
  v_is_ai_driven BOOLEAN;
BEGIN
  -- Check if this is an AI-driven episode
  SELECT COALESCE(is_ai_driven, false) INTO v_is_ai_driven
  FROM mystery_episodes
  WHERE id = p_episode_id;

  -- Get the first scene of the episode (only for non-AI episodes)
  IF NOT v_is_ai_driven THEN
    SELECT id INTO first_scene_id
    FROM mystery_scenes
    WHERE episode_id = p_episode_id
    ORDER BY scene_order ASC
    LIMIT 1;

    IF first_scene_id IS NULL THEN
      RAISE EXCEPTION 'Episode has no scenes';
    END IF;
  END IF;

  -- Create new session (current_scene_id can be NULL for AI episodes)
  INSERT INTO mystery_sessions (
    episode_id,
    current_scene_id,
    status,
    daniel_joined,
    huaiyao_joined,
    daniel_last_seen,
    huaiyao_last_seen
  )
  VALUES (
    p_episode_id,
    first_scene_id,  -- NULL for AI episodes
    'waiting',
    p_player = 'daniel',
    p_player = 'huaiyao',
    CASE WHEN p_player = 'daniel' THEN NOW() ELSE NULL END,
    CASE WHEN p_player = 'huaiyao' THEN NOW() ELSE NULL END
  )
  RETURNING * INTO new_session;

  RETURN row_to_json(new_session);
END;
$$;
