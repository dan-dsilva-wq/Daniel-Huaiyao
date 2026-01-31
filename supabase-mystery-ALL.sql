-- ============================================
-- MYSTERY PUZZLES - COMPLETE SETUP
-- Run this single file to set up everything
-- Safe to run multiple times (won't duplicate)
-- ============================================

-- ============================================
-- PART 1: CREATE TABLES (IF NOT EXISTS)
-- ============================================

CREATE TABLE IF NOT EXISTS mystery_puzzles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id UUID REFERENCES mystery_scenes(id) ON DELETE CASCADE,
  puzzle_type TEXT NOT NULL CHECK (puzzle_type IN (
    'cryptography', 'number_theory', 'logic', 'geometry', 'sequence', 'research', 'minigame'
  )),
  difficulty INTEGER NOT NULL DEFAULT 3 CHECK (difficulty >= 1 AND difficulty <= 5),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  puzzle_data JSONB NOT NULL DEFAULT '{}',
  answer_type TEXT NOT NULL CHECK (answer_type IN ('exact', 'numeric', 'multiple_choice', 'set')),
  answer_config JSONB NOT NULL DEFAULT '{}',
  hints JSONB NOT NULL DEFAULT '[]',
  max_hints INTEGER NOT NULL DEFAULT 3,
  is_blocking BOOLEAN DEFAULT true,
  next_scene_on_solve UUID REFERENCES mystery_scenes(id) ON DELETE SET NULL,
  time_limit_seconds INTEGER DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mystery_puzzle_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES mystery_sessions(id) ON DELETE CASCADE,
  puzzle_id UUID REFERENCES mystery_puzzles(id) ON DELETE CASCADE,
  daniel_answer_hash TEXT DEFAULT NULL,
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

CREATE TABLE IF NOT EXISTS mystery_puzzle_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES mystery_sessions(id) ON DELETE CASCADE,
  puzzle_id UUID REFERENCES mystery_puzzles(id) ON DELETE CASCADE,
  player TEXT NOT NULL CHECK (player IN ('daniel', 'huaiyao')),
  submitted_answer TEXT NOT NULL,
  answer_hash TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  hints_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mystery_minigame_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES mystery_sessions(id) ON DELETE CASCADE,
  puzzle_id UUID REFERENCES mystery_puzzles(id) ON DELETE CASCADE,
  game_state JSONB NOT NULL DEFAULT '{}',
  daniel_state JSONB DEFAULT '{}',
  huaiyao_state JSONB DEFAULT '{}',
  last_action_by TEXT CHECK (last_action_by IN ('daniel', 'huaiyao')),
  last_action_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, puzzle_id)
);

-- ============================================
-- PART 2: ENABLE RLS (safe to run multiple times)
-- ============================================

ALTER TABLE mystery_puzzles ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_puzzle_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_puzzle_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_minigame_state ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies (safe way)
DROP POLICY IF EXISTS "Allow public read on mystery_puzzles" ON mystery_puzzles;
DROP POLICY IF EXISTS "Allow public read on mystery_puzzle_answers" ON mystery_puzzle_answers;
DROP POLICY IF EXISTS "Allow public insert on mystery_puzzle_answers" ON mystery_puzzle_answers;
DROP POLICY IF EXISTS "Allow public update on mystery_puzzle_answers" ON mystery_puzzle_answers;
DROP POLICY IF EXISTS "Allow public insert on mystery_puzzle_attempts" ON mystery_puzzle_attempts;
DROP POLICY IF EXISTS "Allow public read on mystery_puzzle_attempts" ON mystery_puzzle_attempts;
DROP POLICY IF EXISTS "Allow public read on mystery_minigame_state" ON mystery_minigame_state;
DROP POLICY IF EXISTS "Allow public insert on mystery_minigame_state" ON mystery_minigame_state;
DROP POLICY IF EXISTS "Allow public update on mystery_minigame_state" ON mystery_minigame_state;

CREATE POLICY "Allow public read on mystery_puzzles" ON mystery_puzzles FOR SELECT USING (true);
CREATE POLICY "Allow public read on mystery_puzzle_answers" ON mystery_puzzle_answers FOR SELECT USING (true);
CREATE POLICY "Allow public insert on mystery_puzzle_answers" ON mystery_puzzle_answers FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on mystery_puzzle_answers" ON mystery_puzzle_answers FOR UPDATE USING (true);
CREATE POLICY "Allow public insert on mystery_puzzle_attempts" ON mystery_puzzle_attempts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read on mystery_puzzle_attempts" ON mystery_puzzle_attempts FOR SELECT USING (true);
CREATE POLICY "Allow public read on mystery_minigame_state" ON mystery_minigame_state FOR SELECT USING (true);
CREATE POLICY "Allow public insert on mystery_minigame_state" ON mystery_minigame_state FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on mystery_minigame_state" ON mystery_minigame_state FOR UPDATE USING (true);

-- Realtime (ignore errors if already added)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE mystery_puzzle_answers;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE mystery_minigame_state;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- PART 3: CREATE/REPLACE FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION hash_puzzle_answer(answer TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN encode(sha256(LOWER(TRIM(regexp_replace(answer, '\s+', ' ', 'g')))::bytea), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION submit_puzzle_answer(
  p_session_id UUID, p_puzzle_id UUID, p_player TEXT, p_answer TEXT
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  puzzle_record mystery_puzzles;
  answer_record mystery_puzzle_answers;
  answer_hash TEXT;
  correct_hash TEXT;
  is_correct BOOLEAN := false;
  partner_hash TEXT;
  both_submitted BOOLEAN;
  both_agreed BOOLEAN;
  numeric_answer NUMERIC;
  correct_value NUMERIC;
  tolerance NUMERIC;
BEGIN
  SELECT * INTO puzzle_record FROM mystery_puzzles WHERE id = p_puzzle_id;
  IF puzzle_record IS NULL THEN
    RETURN json_build_object('status', 'error', 'message', 'Puzzle not found');
  END IF;

  answer_hash := hash_puzzle_answer(p_answer);

  CASE puzzle_record.answer_type
    WHEN 'exact' THEN
      correct_hash := puzzle_record.answer_config->>'answer_hash';
      is_correct := (answer_hash = correct_hash);
    WHEN 'numeric' THEN
      BEGIN
        numeric_answer := p_answer::NUMERIC;
        correct_value := (puzzle_record.answer_config->>'correct_value')::NUMERIC;
        tolerance := COALESCE((puzzle_record.answer_config->>'tolerance')::NUMERIC, 0);
        is_correct := ABS(numeric_answer - correct_value) <= tolerance;
      EXCEPTION WHEN OTHERS THEN
        is_correct := false;
      END;
    ELSE
      correct_hash := puzzle_record.answer_config->>'answer_hash';
      is_correct := (answer_hash = correct_hash);
  END CASE;

  INSERT INTO mystery_puzzle_attempts (session_id, puzzle_id, player, submitted_answer, answer_hash, is_correct, hints_used)
  SELECT p_session_id, p_puzzle_id, p_player, p_answer, answer_hash, is_correct,
         COALESCE((SELECT hints_revealed FROM mystery_puzzle_answers WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id), 0);

  INSERT INTO mystery_puzzle_answers (session_id, puzzle_id)
  VALUES (p_session_id, p_puzzle_id)
  ON CONFLICT (session_id, puzzle_id) DO NOTHING;

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

  both_submitted := (answer_record.daniel_answer_hash IS NOT NULL AND answer_record.huaiyao_answer_hash IS NOT NULL);
  both_agreed := both_submitted AND (answer_record.daniel_answer_hash = answer_record.huaiyao_answer_hash);

  IF both_agreed AND is_correct THEN
    UPDATE mystery_puzzle_answers SET status = 'solved', solved_at = NOW()
    WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

    IF puzzle_record.is_blocking AND puzzle_record.next_scene_on_solve IS NOT NULL THEN
      UPDATE mystery_sessions SET current_scene_id = puzzle_record.next_scene_on_solve
      WHERE id = p_session_id;
    END IF;

    RETURN json_build_object('status', 'solved', 'is_correct', true, 'agreed', true, 'message', 'Puzzle solved!');
  ELSIF both_agreed AND NOT is_correct THEN
    UPDATE mystery_puzzle_answers SET status = 'agreed'
    WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;
    RETURN json_build_object('status', 'wrong', 'is_correct', false, 'agreed', true, 'message', 'Both agreed, but incorrect. Try again!');
  ELSIF both_submitted AND NOT both_agreed THEN
    UPDATE mystery_puzzle_answers SET status = 'disagreed'
    WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;
    RETURN json_build_object('status', 'disagreed', 'is_correct', is_correct, 'agreed', false, 'message', 'Different answers! Discuss and agree.');
  ELSE
    UPDATE mystery_puzzle_answers SET status = 'pending'
    WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;
    RETURN json_build_object('status', 'waiting', 'is_correct', is_correct, 'agreed', false, 'message', 'Waiting for partner...');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION request_puzzle_hint(p_session_id UUID, p_puzzle_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  puzzle_record mystery_puzzles;
  answer_record mystery_puzzle_answers;
  current_hints INTEGER;
  hint_text TEXT;
BEGIN
  SELECT * INTO puzzle_record FROM mystery_puzzles WHERE id = p_puzzle_id;
  IF puzzle_record IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Puzzle not found');
  END IF;

  INSERT INTO mystery_puzzle_answers (session_id, puzzle_id)
  VALUES (p_session_id, p_puzzle_id)
  ON CONFLICT (session_id, puzzle_id) DO NOTHING;

  SELECT * INTO answer_record FROM mystery_puzzle_answers
  WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

  current_hints := answer_record.hints_revealed;

  IF current_hints >= puzzle_record.max_hints OR current_hints >= jsonb_array_length(puzzle_record.hints) THEN
    RETURN json_build_object('success', false, 'message', 'No more hints', 'hints_revealed', current_hints, 'max_hints', puzzle_record.max_hints);
  END IF;

  UPDATE mystery_puzzle_answers SET hints_revealed = current_hints + 1
  WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

  hint_text := puzzle_record.hints->>current_hints;
  RETURN json_build_object('success', true, 'hint', hint_text, 'hint_number', current_hints + 1, 'hints_revealed', current_hints + 1, 'max_hints', puzzle_record.max_hints);
END;
$$;

CREATE OR REPLACE FUNCTION get_puzzle_hints(p_session_id UUID, p_puzzle_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
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

  SELECT * INTO answer_record FROM mystery_puzzle_answers
  WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

  revealed_count := COALESCE(answer_record.hints_revealed, 0);

  FOR i IN 0..(revealed_count - 1) LOOP
    revealed_hints := revealed_hints || jsonb_build_array(puzzle_record.hints->i);
  END LOOP;

  RETURN json_build_object('hints', revealed_hints, 'hints_revealed', revealed_count, 'max_hints', puzzle_record.max_hints);
END;
$$;

CREATE OR REPLACE FUNCTION reset_puzzle_answers(p_session_id UUID, p_puzzle_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE mystery_puzzle_answers
  SET daniel_answer_hash = NULL, huaiyao_answer_hash = NULL,
      daniel_submitted_at = NULL, huaiyao_submitted_at = NULL, status = 'pending'
  WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION update_minigame_state(
  p_session_id UUID, p_puzzle_id UUID, p_player TEXT,
  p_shared_state JSONB DEFAULT NULL, p_private_state JSONB DEFAULT NULL
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  state_record mystery_minigame_state;
BEGIN
  INSERT INTO mystery_minigame_state (session_id, puzzle_id, game_state)
  VALUES (p_session_id, p_puzzle_id, COALESCE(p_shared_state, '{}'::JSONB))
  ON CONFLICT (session_id, puzzle_id) DO UPDATE SET
    game_state = CASE WHEN p_shared_state IS NOT NULL THEN mystery_minigame_state.game_state || p_shared_state ELSE mystery_minigame_state.game_state END,
    daniel_state = CASE WHEN p_player = 'daniel' AND p_private_state IS NOT NULL THEN p_private_state ELSE mystery_minigame_state.daniel_state END,
    huaiyao_state = CASE WHEN p_player = 'huaiyao' AND p_private_state IS NOT NULL THEN p_private_state ELSE mystery_minigame_state.huaiyao_state END,
    last_action_by = p_player, last_action_at = NOW()
  RETURNING * INTO state_record;

  RETURN json_build_object('game_state', state_record.game_state,
    'my_state', CASE WHEN p_player = 'daniel' THEN state_record.daniel_state ELSE state_record.huaiyao_state END,
    'last_action_by', state_record.last_action_by);
END;
$$;

CREATE OR REPLACE FUNCTION get_minigame_state(p_session_id UUID, p_puzzle_id UUID, p_player TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  state_record mystery_minigame_state;
BEGIN
  SELECT * INTO state_record FROM mystery_minigame_state
  WHERE session_id = p_session_id AND puzzle_id = p_puzzle_id;

  IF state_record IS NULL THEN
    RETURN json_build_object('game_state', '{}'::JSONB, 'my_state', '{}'::JSONB, 'partner_ready', false);
  END IF;

  RETURN json_build_object('game_state', state_record.game_state,
    'my_state', CASE WHEN p_player = 'daniel' THEN state_record.daniel_state ELSE state_record.huaiyao_state END,
    'partner_ready', CASE WHEN p_player = 'daniel' THEN state_record.huaiyao_state != '{}'::JSONB ELSE state_record.daniel_state != '{}'::JSONB END);
END;
$$;

-- Update get_mystery_game_state to include puzzle
CREATE OR REPLACE FUNCTION get_mystery_game_state(p_session_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  session_data mystery_sessions;
  scene_data JSON;
  choices_data JSON;
  votes_data JSON;
  episode_data JSON;
  puzzle_data JSON;
BEGIN
  SELECT * INTO session_data FROM mystery_sessions WHERE id = p_session_id;
  IF session_data IS NULL THEN RETURN NULL; END IF;

  SELECT json_build_object('id', e.id, 'title', e.title, 'episode_number', e.episode_number)
  INTO episode_data FROM mystery_episodes e WHERE e.id = session_data.episode_id;

  SELECT json_build_object('id', s.id, 'title', s.title, 'narrative_text', s.narrative_text,
    'is_decision_point', s.is_decision_point, 'is_ending', s.is_ending, 'ending_type', s.ending_type, 'scene_order', s.scene_order)
  INTO scene_data FROM mystery_scenes s WHERE s.id = session_data.current_scene_id;

  SELECT COALESCE(json_agg(json_build_object('id', c.id, 'choice_text', c.choice_text,
    'choice_order', c.choice_order, 'next_scene_id', c.next_scene_id) ORDER BY c.choice_order), '[]'::json)
  INTO choices_data FROM mystery_choices c WHERE c.scene_id = session_data.current_scene_id;

  SELECT COALESCE(json_agg(json_build_object('player', v.player, 'choice_id', v.choice_id)), '[]'::json)
  INTO votes_data FROM mystery_votes v WHERE v.session_id = p_session_id AND v.scene_id = session_data.current_scene_id;

  SELECT json_build_object('id', p.id, 'puzzle_type', p.puzzle_type, 'difficulty', p.difficulty,
    'title', p.title, 'description', p.description, 'puzzle_data', p.puzzle_data,
    'answer_type', p.answer_type, 'max_hints', p.max_hints, 'is_blocking', p.is_blocking, 'time_limit_seconds', p.time_limit_seconds)
  INTO puzzle_data FROM mystery_puzzles p WHERE p.scene_id = session_data.current_scene_id;

  RETURN json_build_object(
    'session', json_build_object('id', session_data.id, 'status', session_data.status,
      'daniel_joined', session_data.daniel_joined, 'huaiyao_joined', session_data.huaiyao_joined,
      'daniel_last_seen', session_data.daniel_last_seen, 'huaiyao_last_seen', session_data.huaiyao_last_seen,
      'current_scene_id', session_data.current_scene_id, 'created_at', session_data.created_at, 'completed_at', session_data.completed_at),
    'episode', episode_data, 'scene', scene_data, 'choices', choices_data, 'votes', votes_data, 'puzzle', puzzle_data);
END;
$$;

-- ============================================
-- PART 4: TEST EPISODE (Episode 99)
-- ============================================

INSERT INTO mystery_episodes (id, episode_number, title, description, is_available)
VALUES ('e9000000-0000-0000-0000-000000000001', 99, 'Puzzle Test Lab',
  'A quick test episode to verify puzzles work. Simple puzzles with known answers.', true)
ON CONFLICT (episode_number) DO NOTHING;

-- Test scenes
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('c1000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 1, 'Welcome',
  'Welcome to the Puzzle Test Lab!

To test alone: Open TWO browser tabs - one as Daniel, one as Huaiyao. Both must submit the SAME answer.

Test Answers: 42, hello, cat, 10

Click below to start.', true, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('c1000000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-000000000001', 2, 'Number Test',
  'Puzzle 1: What is 6 × 7? (Answer: 42)', false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('c1000000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-000000000001', 3, 'Text Test',
  'Puzzle 2: Decode IFMMP (shift each letter back by 1). Answer: hello', false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('c1000000-0000-0000-0000-000000000004', 'e9000000-0000-0000-0000-000000000001', 4, 'Logic Test',
  'Puzzle 3: Fish is in tank, dog is in yard. What''s on the mat? Answer: cat', false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('c1000000-0000-0000-0000-000000000005', 'e9000000-0000-0000-0000-000000000001', 5, 'Sequence Test',
  'Puzzle 4: 2, 4, 6, 8, ? Answer: 10', false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending, ending_type)
VALUES ('c1000000-0000-0000-0000-000000000006', 'e9000000-0000-0000-0000-000000000001', 6, 'Success!',
  'All puzzles working! The system is ready.', false, true, 'good')
ON CONFLICT (id) DO NOTHING;

-- Test choices
INSERT INTO mystery_choices (id, scene_id, choice_order, choice_text, next_scene_id)
VALUES ('cc100000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 1, 'Start Test', 'c1000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- Test puzzles
INSERT INTO mystery_puzzles (id, scene_id, puzzle_type, difficulty, title, description, puzzle_data, answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve)
VALUES ('dd000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'number_theory', 1,
  'Number Test', 'What is 6 × 7?', '{"equations": ["6 × 7 = ?"]}', 'numeric', '{"correct_value": 42, "tolerance": 0}',
  '["The answer is 42"]', 1, true, 'c1000000-0000-0000-0000-000000000003')
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_puzzles (id, scene_id, puzzle_type, difficulty, title, description, puzzle_data, answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve)
VALUES ('dd000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000003', 'cryptography', 1,
  'Text Test', 'Decode: IFMMP (shift -1)', '{"ciphertext": "IFMMP"}', 'exact',
  '{"answer_hash": "' || encode(sha256('hello'::bytea), 'hex') || '"}',
  '["Answer: hello"]', 1, true, 'c1000000-0000-0000-0000-000000000004')
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_puzzles (id, scene_id, puzzle_type, difficulty, title, description, puzzle_data, answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve)
VALUES ('dd000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000004', 'logic', 1,
  'Logic Test', 'What is on the mat?', '{"question": "Fish=tank, Dog=yard, ?=mat"}', 'exact',
  '{"answer_hash": "' || encode(sha256('cat'::bytea), 'hex') || '"}',
  '["Answer: cat"]', 1, true, 'c1000000-0000-0000-0000-000000000005')
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_puzzles (id, scene_id, puzzle_type, difficulty, title, description, puzzle_data, answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve)
VALUES ('dd000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000005', 'sequence', 1,
  'Sequence Test', '2, 4, 6, 8, ?', '{"sequence": [2,4,6,8]}', 'numeric', '{"correct_value": 10, "tolerance": 0}',
  '["Answer: 10"]', 1, true, 'c1000000-0000-0000-0000-000000000006')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- PART 5: EPISODE 2 - ESCAPE ROOM
-- ============================================

INSERT INTO mystery_episodes (id, episode_number, title, description, is_available)
VALUES ('e2000000-0000-0000-0000-000000000001', 2, 'The Escape Room',
  'Trapped in Professor Enigma''s puzzle room! Solve codes and find 4 keys to escape.', true)
ON CONFLICT (episode_number) DO NOTHING;

-- Escape room scenes
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('b1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 1, 'Locked In',
  'The door slams shut. You''re in Professor Enigma''s study. A timer shows 60:00.

You see:
- A locked desk (4-digit combo)
- Strange bookshelves
- A painting with formulas
- A grandfather clock

Where do you start?', true, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('b1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 2, 'The Desk',
  'The desk has a riddle:

"Take the year Einstein showed E=mc², then subtract 100."

What''s the 4-digit code?', false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('b1000000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000001', 3, 'Key #1 Found',
  'The desk opens! You find Key #1 and a UV flashlight. A note says: "The bookshelf holds secrets."', true, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('b1000000-0000-0000-0000-000000000004', 'e2000000-0000-0000-0000-000000000001', 4, 'Bookshelf',
  'Books with colored spines form patterns:

Row 1: Red, Blue, Red, Blue, Red, ?
Row 2: 2, 6, 18, 54, ?
Row 3: A, C, F, J, O, ?

Enter answers as: ColorNumberLetter (e.g., Blue162U)', false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('b1000000-0000-0000-0000-000000000005', 'e2000000-0000-0000-0000-000000000001', 5, 'Key #2 Found',
  'Key #2 is yours! Under UV light, the painting reveals hidden equations...', true, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('b1000000-0000-0000-0000-000000000006', 'e2000000-0000-0000-0000-000000000001', 6, 'The Safe',
  'The painting shows: ♠ + 3 × 7 = 52

Solve for ♠, then find ♣ = ♠ - 26

The safe code is ♠ then ♣ (two numbers with a comma)', false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('b1000000-0000-0000-0000-000000000007', 'e2000000-0000-0000-0000-000000000001', 7, 'Key #3 Found',
  'Key #3! Only one more. The clock in the corner seems important...', true, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('b1000000-0000-0000-0000-000000000008', 'e2000000-0000-0000-0000-000000000001', 8, 'The Clock',
  'The clock riddle: "Set time to the smallest prime, twice."

Hours = smallest prime, Minutes = smallest prime.

Enter as HH:MM', false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('b1000000-0000-0000-0000-000000000009', 'e2000000-0000-0000-0000-000000000001', 9, 'All 4 Keys!',
  'Key #4! Now to the door. Four keyholes labeled: π, e, φ, |i|

Order by value (smallest to largest): |i|=1, φ≈1.618, e≈2.718, π≈3.14

Enter the key order as 4 digits (e.g., if |i| is key 4, φ is key 3...)', true, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES ('b1000000-0000-0000-0000-000000000010', 'e2000000-0000-0000-0000-000000000001', 10, 'The Door', '', false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending, ending_type)
VALUES ('b1000000-0000-0000-0000-000000000011', 'e2000000-0000-0000-0000-000000000001', 11, 'ESCAPED!',
  'The door swings open to confetti and cheers! Professor Enigma congratulates you with golden puzzle pins. Master Escape Artists!', false, true, 'good')
ON CONFLICT (id) DO NOTHING;

-- Escape room choices
INSERT INTO mystery_choices (id, scene_id, choice_order, choice_text, next_scene_id) VALUES
('cc200000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 1, 'Examine the desk', 'b1000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;
INSERT INTO mystery_choices (id, scene_id, choice_order, choice_text, next_scene_id) VALUES
('cc200000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000003', 1, 'Check the bookshelf', 'b1000000-0000-0000-0000-000000000004')
ON CONFLICT (id) DO NOTHING;
INSERT INTO mystery_choices (id, scene_id, choice_order, choice_text, next_scene_id) VALUES
('cc200000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000005', 1, 'Examine the painting', 'b1000000-0000-0000-0000-000000000006')
ON CONFLICT (id) DO NOTHING;
INSERT INTO mystery_choices (id, scene_id, choice_order, choice_text, next_scene_id) VALUES
('cc200000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000007', 1, 'Check the clock', 'b1000000-0000-0000-0000-000000000008')
ON CONFLICT (id) DO NOTHING;
INSERT INTO mystery_choices (id, scene_id, choice_order, choice_text, next_scene_id) VALUES
('cc200000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000009', 1, 'Go to the door', 'b1000000-0000-0000-0000-000000000010')
ON CONFLICT (id) DO NOTHING;

-- Escape room puzzles
INSERT INTO mystery_puzzles (id, scene_id, puzzle_type, difficulty, title, description, puzzle_data, answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve)
VALUES ('p2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 'research', 2,
  'Einstein''s Year', 'E=mc² was published in what year? Subtract 100.',
  '{"clue": "Einstein''s special relativity paper"}', 'numeric', '{"correct_value": 1805, "tolerance": 0}',
  '["Einstein''s miracle year was 1905", "1905 - 100 = 1805"]', 2, true, 'b1000000-0000-0000-0000-000000000003')
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_puzzles (id, scene_id, puzzle_type, difficulty, title, description, puzzle_data, answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve)
VALUES ('p2000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000004', 'sequence', 3,
  'Three Sequences', 'Color: alternates. Number: ×3 each time. Letter: gaps +2,+3,+4,+5,+6',
  '{"sequences": "See description"}', 'exact', '{"answer_hash": "' || encode(sha256('blue162u'::bytea), 'hex') || '"}',
  '["Color alternates: Blue", "2×3=6, 6×3=18, 54×3=162", "O(15)+6=U(21). Answer: Blue162U"]', 3, true, 'b1000000-0000-0000-0000-000000000005')
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_puzzles (id, scene_id, puzzle_type, difficulty, title, description, puzzle_data, answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve)
VALUES ('p2000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000006', 'number_theory', 3,
  'The Safe Code', '♠ + 3×7 = 52Jean solve for ♠, then ♣ = ♠ - 26. Enter as: ♠,♣',
  '{"equation": "♠ + 21 = 52"}', 'exact', '{"answer_hash": "' || encode(sha256('31,5'::bytea), 'hex') || '"}',
  '["♠ + 21 = 52, so ♠ = 31", "♣ = 31 - 26 = 5", "Answer: 31,5"]', 3, true, 'b1000000-0000-0000-0000-000000000007')
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_puzzles (id, scene_id, puzzle_type, difficulty, title, description, puzzle_data, answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve)
VALUES ('p2000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000008', 'number_theory', 2,
  'Clock Time', 'Smallest prime, twice. Format: HH:MM',
  '{"clue": "smallest prime number"}', 'exact', '{"answer_hash": "' || encode(sha256('02:02'::bytea), 'hex') || '"}',
  '["Smallest prime is 2", "Hours=2, Minutes=2", "Answer: 02:02"]', 3, true, 'b1000000-0000-0000-0000-000000000009')
ON CONFLICT (id) DO NOTHING;

INSERT INTO mystery_puzzles (id, scene_id, puzzle_type, difficulty, title, description, puzzle_data, answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve)
VALUES ('p2000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000010', 'number_theory', 3,
  'Key Order', 'π=key1, e=key2, φ=key3, |i|=key4. Order smallest→largest value.',
  '{"values": "|i|=1, φ≈1.618, e≈2.718, π≈3.14"}', 'exact', '{"answer_hash": "' || encode(sha256('4321'::bytea), 'hex') || '"}',
  '["Smallest to largest: |i|, φ, e, π", "That''s keys: 4, 3, 2, 1", "Answer: 4321"]', 3, true, 'b1000000-0000-0000-0000-000000000011')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- DONE!
-- Test Episode 99: Answers are 42, hello, cat, 10
-- Episode 2: 1805, Blue162U, 31,5, 02:02, 4321
-- ============================================

SELECT 'SUCCESS! Puzzles installed. Test with Episode 99.' as status;
