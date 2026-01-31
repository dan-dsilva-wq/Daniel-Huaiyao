-- FIX: cast_mystery_vote function has ambiguous column reference
-- The local variable 'current_scene_id' conflicts with the column name
-- Renaming to 'v_scene_id' to fix the ambiguity

CREATE OR REPLACE FUNCTION cast_mystery_vote(p_session_id UUID, p_player TEXT, p_choice_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  session_data mystery_sessions;
  v_scene_id UUID;  -- Renamed from current_scene_id to avoid ambiguity
  other_vote mystery_votes;
  next_scene_id UUID;
  next_scene mystery_scenes;
  result JSON;
BEGIN
  -- Get current session and scene
  SELECT * INTO session_data FROM mystery_sessions WHERE id = p_session_id;
  v_scene_id := session_data.current_scene_id;

  -- Upsert vote
  INSERT INTO mystery_votes (session_id, scene_id, player, choice_id)
  VALUES (p_session_id, v_scene_id, p_player, p_choice_id)
  ON CONFLICT (session_id, scene_id, player)
  DO UPDATE SET choice_id = p_choice_id, created_at = NOW();

  -- Check for the other player's vote
  SELECT * INTO other_vote
  FROM mystery_votes
  WHERE session_id = p_session_id
    AND scene_id = v_scene_id
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

      -- Update session to next scene
      UPDATE mystery_sessions
      SET current_scene_id = next_scene_id,
          status = CASE WHEN next_scene.is_ending THEN 'completed' ELSE status END,
          completed_at = CASE WHEN next_scene.is_ending THEN NOW() ELSE NULL END
      WHERE id = p_session_id;

      -- Clear votes for the old scene
      DELETE FROM mystery_votes WHERE session_id = p_session_id AND scene_id = v_scene_id;

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
