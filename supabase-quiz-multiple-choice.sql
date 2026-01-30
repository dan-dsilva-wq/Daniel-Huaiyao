-- Multiple Choice Questions Update
-- Run this after the two-way schema

-- Add multiple choice support
ALTER TABLE quiz_questions
ADD COLUMN IF NOT EXISTS is_multiple_choice BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS correct_answer_indices JSONB DEFAULT NULL;

-- Update get_quiz_data to include multiple choice info
CREATE OR REPLACE FUNCTION get_quiz_data(p_player TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  partner TEXT;
BEGIN
  partner := CASE WHEN p_player = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;

  SELECT jsonb_build_object(
    'questions_to_answer', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'author', q.author,
          'question_text', q.question_text,
          'options', q.options,
          'correct_answer_index', q.correct_answer_index,
          'correct_answer_indices', q.correct_answer_indices,
          'is_multiple_choice', q.is_multiple_choice,
          'created_at', q.created_at,
          'is_two_way', q.is_two_way,
          'linked_question_id', q.linked_question_id,
          'answer', (
            SELECT jsonb_build_object(
              'selected_index', a.selected_index,
              'selected_indices', a.selected_indices,
              'is_correct', a.is_correct,
              'answered_at', a.answered_at
            )
            FROM quiz_answers a
            WHERE a.question_id = q.id AND a.player = p_player
          )
        ) ORDER BY q.created_at DESC
      ), '[]'::jsonb)
      FROM quiz_questions q
      WHERE q.author = partner AND q.pending_setup = FALSE
    ),
    'my_questions', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'author', q.author,
          'question_text', q.question_text,
          'options', q.options,
          'correct_answer_index', q.correct_answer_index,
          'correct_answer_indices', q.correct_answer_indices,
          'is_multiple_choice', q.is_multiple_choice,
          'created_at', q.created_at,
          'is_two_way', q.is_two_way,
          'linked_question_id', q.linked_question_id,
          'pending_setup', q.pending_setup,
          'partner_answer', (
            SELECT jsonb_build_object(
              'selected_index', a.selected_index,
              'selected_indices', a.selected_indices,
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

-- Add selected_indices column to quiz_answers for multiple choice
ALTER TABLE quiz_answers
ADD COLUMN IF NOT EXISTS selected_indices JSONB DEFAULT NULL;

-- Update add_quiz_question to support multiple choice
CREATE OR REPLACE FUNCTION add_quiz_question(
  p_author TEXT,
  p_question TEXT,
  p_options JSONB,
  p_correct_index INTEGER,
  p_is_two_way BOOLEAN DEFAULT FALSE,
  p_is_multiple_choice BOOLEAN DEFAULT FALSE,
  p_correct_indices JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_id UUID;
  partner TEXT;
  partner_question_id UUID;
BEGIN
  -- Insert the author's question
  INSERT INTO quiz_questions (
    author, question_text, options, correct_answer_index,
    is_two_way, pending_setup, is_multiple_choice, correct_answer_indices
  )
  VALUES (
    p_author, p_question, p_options, p_correct_index,
    p_is_two_way, FALSE, p_is_multiple_choice, p_correct_indices
  )
  RETURNING id INTO new_id;

  -- If two-way, create a pending question for the partner
  IF p_is_two_way THEN
    partner := CASE WHEN p_author = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;

    INSERT INTO quiz_questions (
      author, question_text, options, correct_answer_index,
      is_two_way, linked_question_id, pending_setup, is_multiple_choice, correct_answer_indices
    )
    VALUES (
      partner, p_question, NULL, NULL,
      TRUE, new_id, TRUE, p_is_multiple_choice, NULL
    )
    RETURNING id INTO partner_question_id;

    -- Link back
    UPDATE quiz_questions SET linked_question_id = partner_question_id WHERE id = new_id;
  END IF;

  RETURN new_id;
END;
$$;

-- Update setup_two_way_question to support multiple choice
CREATE OR REPLACE FUNCTION setup_two_way_question(
  p_question_id UUID,
  p_author TEXT,
  p_options JSONB,
  p_correct_index INTEGER,
  p_correct_indices JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE quiz_questions
  SET options = p_options,
      correct_answer_index = p_correct_index,
      correct_answer_indices = p_correct_indices,
      pending_setup = FALSE
  WHERE id = p_question_id
    AND author = p_author
    AND pending_setup = TRUE;

  RETURN FOUND;
END;
$$;

-- Update submit_quiz_answer to support multiple choice
CREATE OR REPLACE FUNCTION submit_quiz_answer(
  p_question_id UUID,
  p_player TEXT,
  p_selected_index INTEGER,
  p_selected_indices JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  correct_idx INTEGER;
  correct_idxs JSONB;
  is_multi BOOLEAN;
  is_correct_answer BOOLEAN;
  result_id UUID;
BEGIN
  -- Get the correct answer(s)
  SELECT correct_answer_index, correct_answer_indices, is_multiple_choice
  INTO correct_idx, correct_idxs, is_multi
  FROM quiz_questions
  WHERE id = p_question_id;

  IF correct_idx IS NULL AND correct_idxs IS NULL THEN
    RETURN jsonb_build_object('error', 'Question not found');
  END IF;

  -- Check if already answered
  IF EXISTS (
    SELECT 1 FROM quiz_answers
    WHERE question_id = p_question_id AND player = p_player
  ) THEN
    RETURN jsonb_build_object('error', 'Already answered');
  END IF;

  -- Check if correct
  IF is_multi AND p_selected_indices IS NOT NULL THEN
    -- For multiple choice, check if selected indices match correct indices
    is_correct_answer := (
      SELECT COUNT(*) = jsonb_array_length(correct_idxs)
             AND COUNT(*) = jsonb_array_length(p_selected_indices)
      FROM (
        SELECT jsonb_array_elements(correct_idxs) AS idx
        INTERSECT
        SELECT jsonb_array_elements(p_selected_indices) AS idx
      ) matched
    );
  ELSE
    is_correct_answer := p_selected_index = correct_idx;
  END IF;

  INSERT INTO quiz_answers (question_id, player, selected_index, selected_indices, is_correct)
  VALUES (p_question_id, p_player, p_selected_index, p_selected_indices, is_correct_answer)
  RETURNING id INTO result_id;

  RETURN jsonb_build_object(
    'success', true,
    'is_correct', is_correct_answer,
    'correct_answer_index', correct_idx,
    'correct_answer_indices', correct_idxs
  );
END;
$$;
