-- Quiz Game Schema
-- Tables and RPC functions for "How Well Do You Know Each Other?" quiz

-- ============================================
-- TABLES
-- ============================================

-- Questions table: stores questions each person writes about themselves
CREATE TABLE IF NOT EXISTS quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author TEXT NOT NULL CHECK (author IN ('daniel', 'huaiyao')),  -- who wrote it (about themselves)
  question_text TEXT NOT NULL,
  options JSONB NOT NULL,  -- ["Option A", "Option B", "Option C", "Option D"]
  correct_answer_index INTEGER NOT NULL CHECK (correct_answer_index >= 0 AND correct_answer_index <= 3),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Answers table: stores each person's answers to partner's questions
CREATE TABLE IF NOT EXISTS quiz_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  player TEXT NOT NULL CHECK (player IN ('daniel', 'huaiyao')),  -- who answered
  selected_index INTEGER NOT NULL CHECK (selected_index >= 0 AND selected_index <= 3),
  is_correct BOOLEAN NOT NULL,
  answered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(question_id, player)  -- one answer per person per question
);

-- Enable RLS
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_answers ENABLE ROW LEVEL SECURITY;

-- RLS policies (allow all for anon - this is a private app)
CREATE POLICY "Allow all quiz_questions" ON quiz_questions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all quiz_answers" ON quiz_answers FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- RPC FUNCTIONS
-- ============================================

-- Get all quiz data for a player
-- Returns questions their partner wrote (for answering) with answer status
CREATE OR REPLACE FUNCTION get_quiz_data(p_player TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  partner TEXT;
BEGIN
  -- Determine partner
  partner := CASE WHEN p_player = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;

  SELECT jsonb_build_object(
    'questions_to_answer', (
      -- Questions partner wrote (for current player to answer)
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'author', q.author,
          'question_text', q.question_text,
          'options', q.options,
          'correct_answer_index', q.correct_answer_index,
          'created_at', q.created_at,
          'answer', (
            SELECT jsonb_build_object(
              'selected_index', a.selected_index,
              'is_correct', a.is_correct,
              'answered_at', a.answered_at
            )
            FROM quiz_answers a
            WHERE a.question_id = q.id AND a.player = p_player
          )
        ) ORDER BY q.created_at DESC
      ), '[]'::jsonb)
      FROM quiz_questions q
      WHERE q.author = partner
    ),
    'my_questions', (
      -- Questions current player wrote
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'author', q.author,
          'question_text', q.question_text,
          'options', q.options,
          'correct_answer_index', q.correct_answer_index,
          'created_at', q.created_at,
          'partner_answer', (
            SELECT jsonb_build_object(
              'selected_index', a.selected_index,
              'is_correct', a.is_correct,
              'answered_at', a.answered_at
            )
            FROM quiz_answers a
            WHERE a.question_id = q.id AND a.player = partner
          )
        ) ORDER BY q.created_at DESC
      ), '[]'::jsonb)
      FROM quiz_questions q
      WHERE q.author = p_player
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- Add a new quiz question
CREATE OR REPLACE FUNCTION add_quiz_question(
  p_author TEXT,
  p_question TEXT,
  p_options JSONB,
  p_correct_index INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO quiz_questions (author, question_text, options, correct_answer_index)
  VALUES (p_author, p_question, p_options, p_correct_index)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

-- Delete a quiz question (only author can delete their own)
CREATE OR REPLACE FUNCTION delete_quiz_question(
  p_question_id UUID,
  p_author TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM quiz_questions
  WHERE id = p_question_id AND author = p_author;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count > 0;
END;
$$;

-- Submit an answer to a question
CREATE OR REPLACE FUNCTION submit_quiz_answer(
  p_question_id UUID,
  p_player TEXT,
  p_selected_index INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  correct_idx INTEGER;
  is_correct_answer BOOLEAN;
  result_id UUID;
BEGIN
  -- Get the correct answer
  SELECT correct_answer_index INTO correct_idx
  FROM quiz_questions
  WHERE id = p_question_id;

  IF correct_idx IS NULL THEN
    RETURN jsonb_build_object('error', 'Question not found');
  END IF;

  -- Check if already answered
  IF EXISTS (
    SELECT 1 FROM quiz_answers
    WHERE question_id = p_question_id AND player = p_player
  ) THEN
    RETURN jsonb_build_object('error', 'Already answered');
  END IF;

  is_correct_answer := p_selected_index = correct_idx;

  INSERT INTO quiz_answers (question_id, player, selected_index, is_correct)
  VALUES (p_question_id, p_player, p_selected_index, is_correct_answer)
  RETURNING id INTO result_id;

  RETURN jsonb_build_object(
    'success', true,
    'is_correct', is_correct_answer,
    'correct_answer_index', correct_idx
  );
END;
$$;
