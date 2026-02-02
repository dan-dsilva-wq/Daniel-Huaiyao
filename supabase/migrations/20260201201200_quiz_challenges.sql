-- Quiz Timed Challenge Mode tables

CREATE TABLE quiz_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  question_count INTEGER DEFAULT 5,
  time_limit_seconds INTEGER DEFAULT 30,
  daniel_score NUMERIC DEFAULT 0,
  huaiyao_score NUMERIC DEFAULT 0,
  current_question_index INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  winner TEXT CHECK (winner IS NULL OR winner IN ('daniel', 'huaiyao', 'tie')),
  created_by TEXT NOT NULL CHECK (created_by IN ('daniel', 'huaiyao'))
);

CREATE TABLE quiz_challenge_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES quiz_challenges(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  question_order INTEGER NOT NULL,
  UNIQUE(challenge_id, question_order)
);

CREATE TABLE quiz_challenge_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES quiz_challenges(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  player TEXT NOT NULL CHECK (player IN ('daniel', 'huaiyao')),
  is_correct BOOLEAN NOT NULL,
  answer_time_ms INTEGER NOT NULL,
  answered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(challenge_id, question_id, player)
);

-- Indexes
CREATE INDEX idx_quiz_challenges_status ON quiz_challenges(status);
CREATE INDEX idx_quiz_challenge_questions_challenge ON quiz_challenge_questions(challenge_id);
CREATE INDEX idx_quiz_challenge_answers_challenge ON quiz_challenge_answers(challenge_id);

-- RPC: Create a new challenge with random questions
CREATE OR REPLACE FUNCTION create_quiz_challenge(
  p_created_by TEXT,
  p_question_count INTEGER DEFAULT 5,
  p_time_limit INTEGER DEFAULT 30
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  new_challenge_id UUID;
  selected_questions UUID[];
  i INTEGER;
  result JSON;
BEGIN
  -- Create challenge
  INSERT INTO quiz_challenges (created_by, question_count, time_limit_seconds)
  VALUES (p_created_by, p_question_count, p_time_limit)
  RETURNING id INTO new_challenge_id;

  -- Select random questions
  SELECT ARRAY(
    SELECT id FROM quiz_questions
    ORDER BY RANDOM()
    LIMIT p_question_count
  ) INTO selected_questions;

  -- Insert challenge questions
  FOR i IN 1..array_length(selected_questions, 1)
  LOOP
    INSERT INTO quiz_challenge_questions (challenge_id, question_id, question_order)
    VALUES (new_challenge_id, selected_questions[i], i);
  END LOOP;

  -- Return challenge with questions
  SELECT json_build_object(
    'id', c.id,
    'status', c.status,
    'question_count', c.question_count,
    'time_limit_seconds', c.time_limit_seconds,
    'current_question_index', c.current_question_index,
    'created_by', c.created_by,
    'questions', (
      SELECT json_agg(json_build_object(
        'id', q.id,
        'question_text', q.question_text,
        'correct_answer', q.correct_answer,
        'question_order', cq.question_order
      ) ORDER BY cq.question_order)
      FROM quiz_challenge_questions cq
      JOIN quiz_questions q ON q.id = cq.question_id
      WHERE cq.challenge_id = c.id
    )
  ) INTO result
  FROM quiz_challenges c
  WHERE c.id = new_challenge_id;

  RETURN result;
END;
$$;

-- RPC: Get active challenge
CREATE OR REPLACE FUNCTION get_active_challenge()
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'id', c.id,
    'status', c.status,
    'question_count', c.question_count,
    'time_limit_seconds', c.time_limit_seconds,
    'current_question_index', c.current_question_index,
    'daniel_score', c.daniel_score,
    'huaiyao_score', c.huaiyao_score,
    'created_by', c.created_by,
    'started_at', c.started_at,
    'questions', (
      SELECT json_agg(json_build_object(
        'id', q.id,
        'question_text', q.question_text,
        'correct_answer', q.correct_answer,
        'question_order', cq.question_order
      ) ORDER BY cq.question_order)
      FROM quiz_challenge_questions cq
      JOIN quiz_questions q ON q.id = cq.question_id
      WHERE cq.challenge_id = c.id
    ),
    'answers', (
      SELECT json_agg(json_build_object(
        'question_id', ca.question_id,
        'player', ca.player,
        'is_correct', ca.is_correct,
        'answer_time_ms', ca.answer_time_ms
      ))
      FROM quiz_challenge_answers ca
      WHERE ca.challenge_id = c.id
    )
  ) INTO result
  FROM quiz_challenges c
  WHERE c.status = 'active'
  ORDER BY c.started_at DESC
  LIMIT 1;

  RETURN result;
END;
$$;

-- RPC: Submit challenge answer
CREATE OR REPLACE FUNCTION submit_challenge_answer(
  p_challenge_id UUID,
  p_question_id UUID,
  p_player TEXT,
  p_is_correct BOOLEAN,
  p_answer_time_ms INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  points_earned NUMERIC;
  time_limit INTEGER;
  all_answered BOOLEAN;
  question_count INTEGER;
  result JSON;
BEGIN
  -- Get challenge info
  SELECT time_limit_seconds, question_count
  INTO time_limit, question_count
  FROM quiz_challenges
  WHERE id = p_challenge_id;

  -- Calculate points (faster answers = more points, but only if correct)
  IF p_is_correct THEN
    -- Max points based on speed (1000 points for instant, decreasing)
    points_earned := GREATEST(0, 1000 - (p_answer_time_ms / (time_limit * 10)));
  ELSE
    points_earned := 0;
  END IF;

  -- Insert answer
  INSERT INTO quiz_challenge_answers (challenge_id, question_id, player, is_correct, answer_time_ms)
  VALUES (p_challenge_id, p_question_id, p_player, p_is_correct, p_answer_time_ms)
  ON CONFLICT (challenge_id, question_id, player) DO NOTHING;

  -- Update score
  IF p_player = 'daniel' THEN
    UPDATE quiz_challenges
    SET daniel_score = daniel_score + points_earned
    WHERE id = p_challenge_id;
  ELSE
    UPDATE quiz_challenges
    SET huaiyao_score = huaiyao_score + points_earned
    WHERE id = p_challenge_id;
  END IF;

  -- Check if all questions answered by both players
  SELECT COUNT(DISTINCT question_id) = question_count * 2
  INTO all_answered
  FROM quiz_challenge_answers
  WHERE challenge_id = p_challenge_id;

  -- Complete challenge if all answered
  IF all_answered THEN
    UPDATE quiz_challenges
    SET status = 'completed',
        completed_at = NOW(),
        winner = CASE
          WHEN daniel_score > huaiyao_score THEN 'daniel'
          WHEN huaiyao_score > daniel_score THEN 'huaiyao'
          ELSE 'tie'
        END
    WHERE id = p_challenge_id;
  END IF;

  -- Return updated challenge state
  SELECT json_build_object(
    'points_earned', points_earned,
    'is_correct', p_is_correct,
    'challenge', (SELECT get_active_challenge())
  ) INTO result;

  RETURN result;
END;
$$;

-- RPC: Advance to next question
CREATE OR REPLACE FUNCTION advance_challenge_question(p_challenge_id UUID)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  UPDATE quiz_challenges
  SET current_question_index = current_question_index + 1
  WHERE id = p_challenge_id;

  RETURN get_active_challenge();
END;
$$;

-- RPC: Abandon challenge
CREATE OR REPLACE FUNCTION abandon_challenge(p_challenge_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE quiz_challenges
  SET status = 'abandoned'
  WHERE id = p_challenge_id;
  RETURN FOUND;
END;
$$;

-- RPC: Get challenge history
CREATE OR REPLACE FUNCTION get_challenge_history(p_limit INTEGER DEFAULT 10)
RETURNS JSON
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id', c.id,
      'status', c.status,
      'daniel_score', c.daniel_score,
      'huaiyao_score', c.huaiyao_score,
      'winner', c.winner,
      'question_count', c.question_count,
      'completed_at', c.completed_at
    ) ORDER BY COALESCE(c.completed_at, c.started_at) DESC)
    FROM quiz_challenges c
    WHERE c.status IN ('completed', 'abandoned')
    LIMIT p_limit
  ), '[]'::json);
END;
$$;

-- Enable RLS
ALTER TABLE quiz_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_challenge_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_challenge_answers ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Allow all access to quiz_challenges" ON quiz_challenges FOR ALL USING (true);
CREATE POLICY "Allow all access to quiz_challenge_questions" ON quiz_challenge_questions FOR ALL USING (true);
CREATE POLICY "Allow all access to quiz_challenge_answers" ON quiz_challenge_answers FOR ALL USING (true);
