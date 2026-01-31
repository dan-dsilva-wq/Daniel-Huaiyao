-- Mystery System Upgrade: Track player path through story
-- This allows us to know what scenes players visited

-- Add visited_scenes to track the path taken
ALTER TABLE mystery_sessions
ADD COLUMN IF NOT EXISTS visited_scenes UUID[] DEFAULT '{}';

-- Add scene_history to track the full journey with timestamps
ALTER TABLE mystery_sessions
ADD COLUMN IF NOT EXISTS scene_history JSONB DEFAULT '[]';

-- Update the cast_mystery_vote function to track visited scenes
CREATE OR REPLACE FUNCTION cast_mystery_vote(p_session_id UUID, p_player TEXT, p_choice_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  session_data mystery_sessions;
  current_scene_id UUID;
  other_vote mystery_votes;
  next_scene_id UUID;
  next_scene mystery_scenes;
  result JSON;
BEGIN
  -- Get current session and scene
  SELECT * INTO session_data FROM mystery_sessions WHERE id = p_session_id;
  current_scene_id := session_data.current_scene_id;

  -- Upsert vote
  INSERT INTO mystery_votes (session_id, scene_id, player, choice_id)
  VALUES (p_session_id, current_scene_id, p_player, p_choice_id)
  ON CONFLICT (session_id, scene_id, player)
  DO UPDATE SET choice_id = p_choice_id, created_at = NOW();

  -- Check for the other player's vote
  SELECT * INTO other_vote
  FROM mystery_votes
  WHERE session_id = p_session_id
    AND scene_id = current_scene_id
    AND player != p_player;

  -- If other player voted the same choice, advance the story
  IF other_vote IS NOT NULL AND other_vote.choice_id = p_choice_id THEN
    -- Get next scene from the choice
    SELECT c.next_scene_id INTO next_scene_id
    FROM mystery_choices c
    WHERE c.id = p_choice_id;

    IF next_scene_id IS NOT NULL THEN
      -- Get the next scene details
      SELECT * INTO next_scene FROM mystery_scenes WHERE id = next_scene_id;

      -- Update session to next scene and track the visit
      UPDATE mystery_sessions
      SET current_scene_id = next_scene_id,
          status = CASE WHEN next_scene.is_ending THEN 'completed' ELSE status END,
          completed_at = CASE WHEN next_scene.is_ending THEN NOW() ELSE NULL END,
          visited_scenes = array_append(visited_scenes, next_scene_id),
          scene_history = scene_history || jsonb_build_object(
            'scene_id', next_scene_id,
            'from_scene', current_scene_id,
            'choice_id', p_choice_id,
            'timestamp', NOW()
          )
      WHERE id = p_session_id;

      RETURN json_build_object(
        'agreed', true,
        'next_scene_id', next_scene_id,
        'is_ending', next_scene.is_ending
      );
    END IF;
  END IF;

  RETURN json_build_object(
    'agreed', false,
    'voted', true
  );
END;
$$;

-- Update start_mystery_session to initialize scene tracking
CREATE OR REPLACE FUNCTION start_mystery_session(p_episode_id UUID, p_player TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  first_scene_id UUID;
  new_session mystery_sessions;
BEGIN
  -- Get the first scene of the episode
  SELECT id INTO first_scene_id
  FROM mystery_scenes
  WHERE episode_id = p_episode_id
  ORDER BY scene_order ASC
  LIMIT 1;

  IF first_scene_id IS NULL THEN
    RAISE EXCEPTION 'Episode has no scenes';
  END IF;

  -- Create new session with initial scene in visited list
  INSERT INTO mystery_sessions (
    episode_id,
    current_scene_id,
    status,
    daniel_joined,
    huaiyao_joined,
    daniel_last_seen,
    huaiyao_last_seen,
    visited_scenes,
    scene_history
  )
  VALUES (
    p_episode_id,
    first_scene_id,
    'waiting',
    p_player = 'daniel',
    p_player = 'huaiyao',
    CASE WHEN p_player = 'daniel' THEN NOW() ELSE NULL END,
    CASE WHEN p_player = 'huaiyao' THEN NOW() ELSE NULL END,
    ARRAY[first_scene_id],
    jsonb_build_array(jsonb_build_object(
      'scene_id', first_scene_id,
      'from_scene', null,
      'choice_id', null,
      'timestamp', NOW()
    ))
  )
  RETURNING * INTO new_session;

  RETURN row_to_json(new_session);
END;
$$;

-- Helper function to check if a scene was visited
CREATE OR REPLACE FUNCTION was_scene_visited(p_session_id UUID, p_scene_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  visited UUID[];
BEGIN
  SELECT visited_scenes INTO visited FROM mystery_sessions WHERE id = p_session_id;
  RETURN p_scene_id = ANY(visited);
END;
$$;
