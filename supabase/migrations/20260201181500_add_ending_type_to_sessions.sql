-- Add ending_type column to mystery_sessions to track completion result
ALTER TABLE mystery_sessions
ADD COLUMN IF NOT EXISTS ending_type TEXT CHECK (ending_type IN ('good', 'neutral', 'bad'));

-- Update cast_mystery_vote to store the ending_type when game completes
CREATE OR REPLACE FUNCTION cast_mystery_vote(
  p_session_id UUID,
  p_scene_id UUID,
  p_player TEXT,
  p_choice_id UUID
)
RETURNS TABLE (
  both_voted BOOLEAN,
  votes_match BOOLEAN,
  daniel_choice_id UUID,
  huaiyao_choice_id UUID,
  next_scene_id UUID,
  is_ending BOOLEAN
) AS $$
DECLARE
  v_daniel_vote UUID;
  v_huaiyao_vote UUID;
  v_next_scene_id UUID;
  v_is_ending BOOLEAN;
  v_ending_type TEXT;
BEGIN
  -- Insert or update the vote
  INSERT INTO mystery_votes (session_id, scene_id, player, choice_id)
  VALUES (p_session_id, p_scene_id, p_player, p_choice_id)
  ON CONFLICT (session_id, scene_id, player)
  DO UPDATE SET choice_id = p_choice_id, created_at = NOW();

  -- Get both votes
  SELECT choice_id INTO v_daniel_vote
  FROM mystery_votes
  WHERE session_id = p_session_id AND scene_id = p_scene_id AND player = 'daniel';

  SELECT choice_id INTO v_huaiyao_vote
  FROM mystery_votes
  WHERE session_id = p_session_id AND scene_id = p_scene_id AND player = 'huaiyao';

  -- Check if both voted and votes match
  IF v_daniel_vote IS NOT NULL AND v_huaiyao_vote IS NOT NULL AND v_daniel_vote = v_huaiyao_vote THEN
    -- Get the next scene from the choice
    SELECT mc.next_scene_id, ms.is_ending, ms.ending_type
    INTO v_next_scene_id, v_is_ending, v_ending_type
    FROM mystery_choices mc
    LEFT JOIN mystery_scenes ms ON mc.next_scene_id = ms.id
    WHERE mc.id = v_daniel_vote;

    -- Update session to next scene
    UPDATE mystery_sessions
    SET current_scene_id = v_next_scene_id,
        status = CASE WHEN v_is_ending THEN 'completed' ELSE status END,
        completed_at = CASE WHEN v_is_ending THEN NOW() ELSE NULL END,
        ending_type = CASE WHEN v_is_ending THEN v_ending_type ELSE ending_type END
    WHERE id = p_session_id;

    RETURN QUERY SELECT
      true AS both_voted,
      true AS votes_match,
      v_daniel_vote AS daniel_choice_id,
      v_huaiyao_vote AS huaiyao_choice_id,
      v_next_scene_id AS next_scene_id,
      COALESCE(v_is_ending, false) AS is_ending;
  ELSE
    RETURN QUERY SELECT
      (v_daniel_vote IS NOT NULL AND v_huaiyao_vote IS NOT NULL) AS both_voted,
      false AS votes_match,
      v_daniel_vote AS daniel_choice_id,
      v_huaiyao_vote AS huaiyao_choice_id,
      NULL::UUID AS next_scene_id,
      false AS is_ending;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also update the AI mode completion function to track ending_type
CREATE OR REPLACE FUNCTION advance_ai_scene(
  p_session_id UUID,
  p_new_scene_order INT,
  p_is_ending BOOLEAN DEFAULT FALSE,
  p_ending_type TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE mystery_sessions
  SET status = CASE WHEN p_is_ending THEN 'completed' ELSE 'active' END,
      completed_at = CASE WHEN p_is_ending THEN NOW() ELSE NULL END,
      ending_type = CASE WHEN p_is_ending THEN p_ending_type ELSE ending_type END
  WHERE id = p_session_id;

  -- Mark previous responses as processed
  UPDATE mystery_ai_responses
  SET processed_at = NOW()
  WHERE session_id = p_session_id
    AND scene_order = p_new_scene_order - 1
    AND processed_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
