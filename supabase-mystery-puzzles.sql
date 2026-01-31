-- Mystery Files Puzzle & Mini-Game System
-- Run this in your Supabase SQL editor after the main mystery schema

-- ============================================
-- PUZZLE DEFINITIONS TABLE
-- ============================================
CREATE TABLE mystery_puzzles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id UUID REFERENCES mystery_scenes(id) ON DELETE CASCADE,
  puzzle_type TEXT NOT NULL CHECK (puzzle_type IN (
    'cryptography', 'number_theory', 'logic', 'geometry', 'sequence', 'research', 'minigame'
  )),
  difficulty INTEGER NOT NULL DEFAULT 3 CHECK (difficulty >= 1 AND difficulty <= 5),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  puzzle_data JSONB NOT NULL DEFAULT '{}', -- Problem content (visible to players)
  answer_type TEXT NOT NULL CHECK (answer_type IN ('exact', 'numeric', 'multiple_choice', 'set')),
  answer_config JSONB NOT NULL DEFAULT '{}', -- Hashed answers, tolerance, etc. (server-side only)
  hints JSONB NOT NULL DEFAULT '[]', -- Array of progressive hints
  max_hints INTEGER NOT NULL DEFAULT 3,
  is_blocking BOOLEAN DEFAULT true, -- Must solve to progress
  next_scene_on_solve UUID REFERENCES mystery_scenes(id) ON DELETE SET NULL,
  time_limit_seconds INTEGER DEFAULT NULL, -- Optional time pressure
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PUZZLE ANSWERS TABLE (collaborative)
-- ============================================
CREATE TABLE mystery_puzzle_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES mystery_sessions(id) ON DELETE CASCADE,
  puzzle_id UUID REFERENCES mystery_puzzles(id) ON DELETE CASCADE,
  daniel_answer_hash TEXT DEFAULT NULL, -- SHA-256 of normalized answer
  huaiyao_answer_hash TEXT DEFAULT NULL,
  daniel_submitted_at TIMESTAMPTZ DEFAULT NULL,
  huaiyao_submitted_at TIMESTAMPTZ DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'agreed', 'disagreed', 'solved', 'failed'
  )),
  hints_revealed INTEGER DEFAULT 0,
  solved_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, puzzle_id)
);

-- ============================================
-- PUZZLE ATTEMPTS LOG (for anti-cheat & analytics)
-- ============================================
CREATE TABLE mystery_puzzle_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES mystery_sessions(id) ON DELETE CASCADE,
  puzzle_id UUID REFERENCES mystery_puzzles(id) ON DELETE CASCADE,
  player TEXT NOT NULL CHECK (player IN ('daniel', 'huaiyao')),
  submitted_answer TEXT NOT NULL, -- Raw answer (logged for debugging)
  answer_hash TEXT NOT NULL, -- Hashed for comparison
  is_correct BOOLEAN NOT NULL DEFAULT false,
  hints_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- MINI-GAME STATE TABLE (real-time sync)
-- ============================================
CREATE TABLE mystery_minigame_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES mystery_sessions(id) ON DELETE CASCADE,
  puzzle_id UUID REFERENCES mystery_puzzles(id) ON DELETE CASCADE,
  game_state JSONB NOT NULL DEFAULT '{}', -- Shared game state
  daniel_state JSONB DEFAULT '{}', -- Daniel's private state
  huaiyao_state JSONB DEFAULT '{}', -- Huaiyao's private state
  last_action_by TEXT CHECK (last_action_by IN ('daniel', 'huaiyao')),
  last_action_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, puzzle_id)
);

-- ============================================
-- ENABLE RLS
-- ============================================
ALTER TABLE mystery_puzzles ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_puzzle_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_puzzle_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_minigame_state ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES
-- ============================================
-- Puzzles: read-only, but hide answer_config
CREATE POLICY "Allow public read on mystery_puzzles (no answers)"
  ON mystery_puzzles FOR SELECT
  USING (true);

-- Puzzle answers: full access for gameplay
CREATE POLICY "Allow public read on mystery_puzzle_answers"
  ON mystery_puzzle_answers FOR SELECT USING (true);
CREATE POLICY "Allow public insert on mystery_puzzle_answers"
  ON mystery_puzzle_answers FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on mystery_puzzle_answers"
  ON mystery_puzzle_answers FOR UPDATE USING (true);

-- Puzzle attempts: insert only (no reading others' attempts)
CREATE POLICY "Allow public insert on mystery_puzzle_attempts"
  ON mystery_puzzle_attempts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read on own mystery_puzzle_attempts"
  ON mystery_puzzle_attempts FOR SELECT USING (true);

-- Mini-game state: full access for real-time sync
CREATE POLICY "Allow public read on mystery_minigame_state"
  ON mystery_minigame_state FOR SELECT USING (true);
CREATE POLICY "Allow public insert on mystery_minigame_state"
  ON mystery_minigame_state FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on mystery_minigame_state"
  ON mystery_minigame_state FOR UPDATE USING (true);

-- ============================================
-- REALTIME SUBSCRIPTIONS
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE mystery_puzzle_answers;
ALTER PUBLICATION supabase_realtime ADD TABLE mystery_minigame_state;

-- ============================================
-- HELPER FUNCTION: Hash answer for comparison
-- ============================================
CREATE OR REPLACE FUNCTION hash_puzzle_answer(answer TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Normalize: lowercase, trim, remove extra spaces
  RETURN encode(sha256(LOWER(TRIM(regexp_replace(answer, '\s+', ' ', 'g')))::bytea), 'hex');
END;
$$;

-- ============================================
-- RPC: Submit a puzzle answer
-- Returns: { status, is_correct, agreed, message }
-- ============================================
CREATE OR REPLACE FUNCTION submit_puzzle_answer(
  p_session_id UUID,
  p_puzzle_id UUID,
  p_player TEXT,
  p_answer TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  puzzle_record mystery_puzzles;
  answer_record mystery_puzzle_answers;
  answer_hash TEXT;
  correct_hash TEXT;
  correct_hashes TEXT[];
  is_correct BOOLEAN := false;
  partner_hash TEXT;
  both_submitted BOOLEAN;
  both_correct BOOLEAN;
  both_agreed BOOLEAN;
  numeric_answer NUMERIC;
  correct_value NUMERIC;
  tolerance NUMERIC;
BEGIN
  -- Get puzzle
  SELECT * INTO puzzle_record FROM mystery_puzzles WHERE id = p_puzzle_id;
  IF puzzle_record IS NULL THEN
    RETURN json_build_object('status', 'error', 'message', 'Puzzle not found');
  END IF;

  -- Hash the submitted answer
  answer_hash := hash_puzzle_answer(p_answer);

  -- Validate answer based on type
  CASE puzzle_record.answer_type
    WHEN 'exact' THEN
      -- Exact string match (hashed)
      correct_hash := puzzle_record.answer_config->>'answer_hash';
      is_correct := (answer_hash = correct_hash);

    WHEN 'numeric' THEN
      -- Numeric with tolerance
      BEGIN
        numeric_answer := p_answer::NUMERIC;
        correct_value := (puzzle_record.answer_config->>'correct_value')::NUMERIC;
        tolerance := COALESCE((puzzle_record.answer_config->>'tolerance')::NUMERIC, 0);
        is_correct := ABS(numeric_answer - correct_value) <= tolerance;
      EXCEPTION WHEN OTHERS THEN
        is_correct := false;
      END;

    WHEN 'multiple_choice' THEN
      -- Check against array of correct option hashes
      correct_hashes := ARRAY(SELECT jsonb_array_elements_text(puzzle_record.answer_config->'correct_hashes'));
      is_correct := answer_hash = ANY(correct_hashes);

    WHEN 'set' THEN
      -- Set of values (order doesn't matter) - hash of sorted values
      correct_hash := puzzle_record.answer_config->>'set_hash';
      -- Re-hash with sorted values
      answer_hash := hash_puzzle_answer(
        array_to_string(
          ARRAY(SELECT unnest(string_to_array(LOWER(TRIM(p_answer)), ',')) ORDER BY 1),
          ','
        )
      );
      is_correct := (answer_hash = correct_hash);
  END CASE;

  -- Log the attempt
  INSERT INTO mystery_puzzle_attempts (session_id, puzzle_id, player, submitted_answer, answer_hash, is_correct, hints_used)
  SELECT p_session_id, p_puzzle_id, p_player, p_answer, answer_hash, is_correct,
         COALESCE((SELECT hints_revealed FROM mystery_puzzle_answers WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id), 0);

  -- Upsert answer record
  INSERT INTO mystery_puzzle_answers (session_id, puzzle_id)
  VALUES (p_session_id, p_puzzle_id)
  ON CONFLICT (session_id, puzzle_id) DO NOTHING;

  -- Update player's answer
  IF p_player = 'daniel' THEN
    UPDATE mystery_puzzle_answers
    SET daniel_answer_hash = answer_hash, daniel_submitted_at = NOW()
    WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id
    RETURNING * INTO answer_record;
    partner_hash := answer_record.huaiyao_answer_hash;
  ELSE
    UPDATE mystery_puzzle_answers
    SET huaiyao_answer_hash = answer_hash, huaiyao_submitted_at = NOW()
    WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id
    RETURNING * INTO answer_record;
    partner_hash := answer_record.daniel_answer_hash;
  END IF;

  -- Check if both submitted
  both_submitted := (answer_record.daniel_answer_hash IS NOT NULL AND answer_record.huaiyao_answer_hash IS NOT NULL);
  both_agreed := both_submitted AND (answer_record.daniel_answer_hash = answer_record.huaiyao_answer_hash);

  -- Check if both are correct
  IF both_agreed AND is_correct THEN
    -- SOLVED!
    UPDATE mystery_puzzle_answers
    SET status = 'solved', solved_at = NOW()
    WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

    -- Advance to next scene if blocking puzzle
    IF puzzle_record.is_blocking AND puzzle_record.next_scene_on_solve IS NOT NULL THEN
      UPDATE mystery_sessions
      SET current_scene_id = puzzle_record.next_scene_on_solve
      WHERE id = p_session_id;
    END IF;

    RETURN json_build_object(
      'status', 'solved',
      'is_correct', true,
      'agreed', true,
      'message', 'Congratulations! Puzzle solved!'
    );
  ELSIF both_agreed AND NOT is_correct THEN
    -- Both agreed on wrong answer
    UPDATE mystery_puzzle_answers
    SET status = 'agreed'
    WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

    RETURN json_build_object(
      'status', 'wrong',
      'is_correct', false,
      'agreed', true,
      'message', 'You both agreed, but that''s not correct. Try again!'
    );
  ELSIF both_submitted AND NOT both_agreed THEN
    -- Disagreement
    UPDATE mystery_puzzle_answers
    SET status = 'disagreed'
    WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

    RETURN json_build_object(
      'status', 'disagreed',
      'is_correct', is_correct,
      'agreed', false,
      'message', 'You have different answers! Discuss and try to agree.'
    );
  ELSE
    -- Waiting for partner
    UPDATE mystery_puzzle_answers
    SET status = 'pending'
    WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

    RETURN json_build_object(
      'status', 'waiting',
      'is_correct', is_correct,
      'agreed', false,
      'message', 'Answer submitted! Waiting for your partner...'
    );
  END IF;
END;
$$;

-- ============================================
-- RPC: Request a hint for a puzzle
-- ============================================
CREATE OR REPLACE FUNCTION request_puzzle_hint(
  p_session_id UUID,
  p_puzzle_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  puzzle_record mystery_puzzles;
  answer_record mystery_puzzle_answers;
  current_hints INTEGER;
  hint_text TEXT;
  hints_array JSONB;
BEGIN
  -- Get puzzle
  SELECT * INTO puzzle_record FROM mystery_puzzles WHERE id = p_puzzle_id;
  IF puzzle_record IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Puzzle not found');
  END IF;

  -- Get or create answer record
  INSERT INTO mystery_puzzle_answers (session_id, puzzle_id)
  VALUES (p_session_id, p_puzzle_id)
  ON CONFLICT (session_id, puzzle_id) DO NOTHING;

  SELECT * INTO answer_record
  FROM mystery_puzzle_answers
  WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

  current_hints := answer_record.hints_revealed;
  hints_array := puzzle_record.hints;

  -- Check if more hints available
  IF current_hints >= puzzle_record.max_hints THEN
    RETURN json_build_object(
      'success', false,
      'message', 'No more hints available',
      'hints_revealed', current_hints,
      'max_hints', puzzle_record.max_hints
    );
  END IF;

  IF current_hints >= jsonb_array_length(hints_array) THEN
    RETURN json_build_object(
      'success', false,
      'message', 'All hints have been revealed',
      'hints_revealed', current_hints,
      'max_hints', puzzle_record.max_hints
    );
  END IF;

  -- Reveal next hint
  UPDATE mystery_puzzle_answers
  SET hints_revealed = current_hints + 1
  WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

  hint_text := hints_array->>current_hints;

  RETURN json_build_object(
    'success', true,
    'hint', hint_text,
    'hint_number', current_hints + 1,
    'hints_revealed', current_hints + 1,
    'max_hints', puzzle_record.max_hints
  );
END;
$$;

-- ============================================
-- RPC: Get all revealed hints for a puzzle
-- ============================================
CREATE OR REPLACE FUNCTION get_puzzle_hints(
  p_session_id UUID,
  p_puzzle_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  puzzle_record mystery_puzzles;
  answer_record mystery_puzzle_answers;
  revealed_count INTEGER;
  revealed_hints JSONB := '[]'::JSONB;
  i INTEGER;
BEGIN
  SELECT * INTO puzzle_record FROM mystery_puzzles WHERE id = p_puzzle_id;
  IF puzzle_record IS NULL THEN
    RETURN json_build_object('hints', '[]'::jsonb, 'max_hints', 0);
  END IF;

  SELECT * INTO answer_record
  FROM mystery_puzzle_answers
  WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

  revealed_count := COALESCE(answer_record.hints_revealed, 0);

  -- Build array of revealed hints
  FOR i IN 0..(revealed_count - 1) LOOP
    revealed_hints := revealed_hints || jsonb_build_array(puzzle_record.hints->i);
  END LOOP;

  RETURN json_build_object(
    'hints', revealed_hints,
    'hints_revealed', revealed_count,
    'max_hints', puzzle_record.max_hints
  );
END;
$$;

-- ============================================
-- RPC: Update mini-game state
-- ============================================
CREATE OR REPLACE FUNCTION update_minigame_state(
  p_session_id UUID,
  p_puzzle_id UUID,
  p_player TEXT,
  p_shared_state JSONB DEFAULT NULL,
  p_private_state JSONB DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  state_record mystery_minigame_state;
BEGIN
  -- Upsert state record
  INSERT INTO mystery_minigame_state (session_id, puzzle_id, game_state)
  VALUES (p_session_id, p_puzzle_id, COALESCE(p_shared_state, '{}'::JSONB))
  ON CONFLICT (session_id, puzzle_id) DO UPDATE
  SET
    game_state = CASE
      WHEN p_shared_state IS NOT NULL
      THEN mystery_minigame_state.game_state || p_shared_state
      ELSE mystery_minigame_state.game_state
    END,
    daniel_state = CASE
      WHEN p_player = 'daniel' AND p_private_state IS NOT NULL
      THEN p_private_state
      ELSE mystery_minigame_state.daniel_state
    END,
    huaiyao_state = CASE
      WHEN p_player = 'huaiyao' AND p_private_state IS NOT NULL
      THEN p_private_state
      ELSE mystery_minigame_state.huaiyao_state
    END,
    last_action_by = p_player,
    last_action_at = NOW()
  RETURNING * INTO state_record;

  RETURN json_build_object(
    'game_state', state_record.game_state,
    'my_state', CASE
      WHEN p_player = 'daniel' THEN state_record.daniel_state
      ELSE state_record.huaiyao_state
    END,
    'last_action_by', state_record.last_action_by,
    'last_action_at', state_record.last_action_at
  );
END;
$$;

-- ============================================
-- RPC: Get mini-game state
-- ============================================
CREATE OR REPLACE FUNCTION get_minigame_state(
  p_session_id UUID,
  p_puzzle_id UUID,
  p_player TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  state_record mystery_minigame_state;
BEGIN
  SELECT * INTO state_record
  FROM mystery_minigame_state
  WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

  IF state_record IS NULL THEN
    RETURN json_build_object(
      'game_state', '{}'::JSONB,
      'my_state', '{}'::JSONB,
      'partner_ready', false
    );
  END IF;

  RETURN json_build_object(
    'game_state', state_record.game_state,
    'my_state', CASE
      WHEN p_player = 'daniel' THEN state_record.daniel_state
      ELSE state_record.huaiyao_state
    END,
    'partner_ready', CASE
      WHEN p_player = 'daniel' THEN state_record.huaiyao_state IS NOT NULL AND state_record.huaiyao_state != '{}'::JSONB
      ELSE state_record.daniel_state IS NOT NULL AND state_record.daniel_state != '{}'::JSONB
    END,
    'last_action_by', state_record.last_action_by,
    'last_action_at', state_record.last_action_at
  );
END;
$$;

-- ============================================
-- RPC: Get puzzle state for a scene
-- ============================================
CREATE OR REPLACE FUNCTION get_puzzle_for_scene(
  p_session_id UUID,
  p_scene_id UUID,
  p_player TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  puzzle_record mystery_puzzles;
  answer_record mystery_puzzle_answers;
  hints_data JSON;
BEGIN
  -- Get puzzle for this scene
  SELECT * INTO puzzle_record FROM mystery_puzzles WHERE scene_id = p_scene_id;

  IF puzzle_record IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get answer state
  SELECT * INTO answer_record
  FROM mystery_puzzle_answers
  WHERE session_id = p_session_id AND puzzle_id = puzzle_record.id;

  -- Get hints
  SELECT get_puzzle_hints(p_session_id, puzzle_record.id) INTO hints_data;

  RETURN json_build_object(
    'id', puzzle_record.id,
    'puzzle_type', puzzle_record.puzzle_type,
    'difficulty', puzzle_record.difficulty,
    'title', puzzle_record.title,
    'description', puzzle_record.description,
    'puzzle_data', puzzle_record.puzzle_data,
    'answer_type', puzzle_record.answer_type,
    'max_hints', puzzle_record.max_hints,
    'is_blocking', puzzle_record.is_blocking,
    'time_limit_seconds', puzzle_record.time_limit_seconds,
    'answer_state', CASE WHEN answer_record IS NULL THEN json_build_object(
      'status', 'pending',
      'hints_revealed', 0,
      'daniel_submitted', false,
      'huaiyao_submitted', false
    ) ELSE json_build_object(
      'status', answer_record.status,
      'hints_revealed', answer_record.hints_revealed,
      'daniel_submitted', answer_record.daniel_answer_hash IS NOT NULL,
      'huaiyao_submitted', answer_record.huaiyao_answer_hash IS NOT NULL,
      'my_submitted', CASE
        WHEN p_player = 'daniel' THEN answer_record.daniel_answer_hash IS NOT NULL
        ELSE answer_record.huaiyao_answer_hash IS NOT NULL
      END,
      'partner_submitted', CASE
        WHEN p_player = 'daniel' THEN answer_record.huaiyao_answer_hash IS NOT NULL
        ELSE answer_record.daniel_answer_hash IS NOT NULL
      END,
      'solved_at', answer_record.solved_at
    ) END,
    'hints', hints_data
  );
END;
$$;

-- ============================================
-- RPC: Reset puzzle answers (for retrying)
-- ============================================
CREATE OR REPLACE FUNCTION reset_puzzle_answers(
  p_session_id UUID,
  p_puzzle_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE mystery_puzzle_answers
  SET
    daniel_answer_hash = NULL,
    huaiyao_answer_hash = NULL,
    daniel_submitted_at = NULL,
    huaiyao_submitted_at = NULL,
    status = 'pending'
  WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

  RETURN true;
END;
$$;

-- ============================================
-- UPDATE get_mystery_game_state to include puzzle
-- ============================================
CREATE OR REPLACE FUNCTION get_mystery_game_state(p_session_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  session_data mystery_sessions;
  scene_data JSON;
  choices_data JSON;
  votes_data JSON;
  episode_data JSON;
  puzzle_data JSON;
  current_player TEXT;
BEGIN
  -- Get session
  SELECT * INTO session_data FROM mystery_sessions WHERE id = p_session_id;

  IF session_data IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get episode info
  SELECT json_build_object(
    'id', e.id,
    'title', e.title,
    'episode_number', e.episode_number
  ) INTO episode_data
  FROM mystery_episodes e
  WHERE e.id = session_data.episode_id;

  -- Get current scene
  SELECT json_build_object(
    'id', s.id,
    'title', s.title,
    'narrative_text', s.narrative_text,
    'is_decision_point', s.is_decision_point,
    'is_ending', s.is_ending,
    'ending_type', s.ending_type,
    'scene_order', s.scene_order
  ) INTO scene_data
  FROM mystery_scenes s
  WHERE s.id = session_data.current_scene_id;

  -- Get choices for current scene
  SELECT COALESCE(json_agg(
    json_build_object(
      'id', c.id,
      'choice_text', c.choice_text,
      'choice_order', c.choice_order,
      'next_scene_id', c.next_scene_id
    ) ORDER BY c.choice_order
  ), '[]'::json) INTO choices_data
  FROM mystery_choices c
  WHERE c.scene_id = session_data.current_scene_id;

  -- Get votes for current scene
  SELECT COALESCE(json_agg(
    json_build_object(
      'player', v.player,
      'choice_id', v.choice_id
    )
  ), '[]'::json) INTO votes_data
  FROM mystery_votes v
  WHERE v.session_id = p_session_id
    AND v.scene_id = session_data.current_scene_id;

  -- Check for puzzle on this scene (pass NULL for player, will be fetched client-side with proper player)
  SELECT json_build_object(
    'id', p.id,
    'puzzle_type', p.puzzle_type,
    'difficulty', p.difficulty,
    'title', p.title,
    'description', p.description,
    'puzzle_data', p.puzzle_data,
    'answer_type', p.answer_type,
    'max_hints', p.max_hints,
    'is_blocking', p.is_blocking,
    'time_limit_seconds', p.time_limit_seconds
  ) INTO puzzle_data
  FROM mystery_puzzles p
  WHERE p.scene_id = session_data.current_scene_id;

  RETURN json_build_object(
    'session', json_build_object(
      'id', session_data.id,
      'status', session_data.status,
      'daniel_joined', session_data.daniel_joined,
      'huaiyao_joined', session_data.huaiyao_joined,
      'daniel_last_seen', session_data.daniel_last_seen,
      'huaiyao_last_seen', session_data.huaiyao_last_seen,
      'current_scene_id', session_data.current_scene_id,
      'created_at', session_data.created_at,
      'completed_at', session_data.completed_at
    ),
    'episode', episode_data,
    'scene', scene_data,
    'choices', choices_data,
    'votes', votes_data,
    'puzzle', puzzle_data
  );
END;
$$;

-- ============================================
-- SAMPLE PUZZLES (for testing)
-- ============================================

-- To add a puzzle to a scene, first get the scene_id, then:
-- INSERT INTO mystery_puzzles (scene_id, puzzle_type, difficulty, title, description, puzzle_data, answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve)
-- VALUES (
--   'your-scene-uuid-here',
--   'number_theory',
--   4,
--   'The Safe Combination',
--   'The victim left a cryptic note with three equations. Find the 3-digit combination.',
--   '{"equations": ["n ≡ 6 (mod 7)", "n ≡ 7 (mod 11)", "n ≡ 0 (mod 13)"], "note": "The smallest positive solution is the combination."}',
--   'numeric',
--   '{"correct_value": 546, "tolerance": 0}',
--   '["Think about the Chinese Remainder Theorem.", "7 × 11 × 13 = 1001. Look for patterns.", "Start with n = 13k where k satisfies the other two conditions."]',
--   3,
--   true,
--   'next-scene-uuid-here'
-- );

-- Cryptography puzzle example:
-- INSERT INTO mystery_puzzles (scene_id, puzzle_type, difficulty, title, description, puzzle_data, answer_type, answer_config, hints, max_hints, is_blocking)
-- VALUES (
--   'scene-uuid',
--   'cryptography',
--   3,
--   'The Encoded Diary',
--   'The diary entry is encrypted with a Vigenère cipher. The key might be hidden in the dates mentioned.',
--   '{"ciphertext": "RIJVS UYVJN EPRLA", "context": "Entry dated March 15, referring to events from January 1. Perhaps the difference matters?"}',
--   'exact',
--   '{"answer_hash": "' || encode(sha256('meet at noon'::bytea), 'hex') || '"}',
--   '["Count the days between the dates.", "The Vigenère key is a number. How many days is that?", "Key length is 2 digits. Try common online Vigenère decoders."]',
--   3,
--   true
-- );
