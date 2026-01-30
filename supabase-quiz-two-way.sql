-- Two-Way Questions Update
-- Run this after the initial quiz schema

-- Add two-way support columns to quiz_questions
ALTER TABLE quiz_questions
ADD COLUMN IF NOT EXISTS is_two_way BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS linked_question_id UUID REFERENCES quiz_questions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS pending_setup BOOLEAN DEFAULT FALSE;

-- Make options nullable for pending setup questions
ALTER TABLE quiz_questions
ALTER COLUMN options DROP NOT NULL,
ALTER COLUMN correct_answer_index DROP NOT NULL;

-- Update the get_quiz_data function to include two-way info
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
      -- Questions partner wrote (for current player to answer)
      -- Only show if not pending_setup (has options filled in)
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'author', q.author,
          'question_text', q.question_text,
          'options', q.options,
          'correct_answer_index', q.correct_answer_index,
          'created_at', q.created_at,
          'is_two_way', q.is_two_way,
          'linked_question_id', q.linked_question_id,
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
      WHERE q.author = partner AND q.pending_setup = FALSE
    ),
    'my_questions', (
      -- Questions current player wrote (including pending setup for two-way)
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'author', q.author,
          'question_text', q.question_text,
          'options', q.options,
          'correct_answer_index', q.correct_answer_index,
          'created_at', q.created_at,
          'is_two_way', q.is_two_way,
          'linked_question_id', q.linked_question_id,
          'pending_setup', q.pending_setup,
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

-- Update add_quiz_question to support two-way
CREATE OR REPLACE FUNCTION add_quiz_question(
  p_author TEXT,
  p_question TEXT,
  p_options JSONB,
  p_correct_index INTEGER,
  p_is_two_way BOOLEAN DEFAULT FALSE
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
  INSERT INTO quiz_questions (author, question_text, options, correct_answer_index, is_two_way, pending_setup)
  VALUES (p_author, p_question, p_options, p_correct_index, p_is_two_way, FALSE)
  RETURNING id INTO new_id;

  -- If two-way, create a pending question for the partner
  IF p_is_two_way THEN
    partner := CASE WHEN p_author = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;

    INSERT INTO quiz_questions (author, question_text, options, correct_answer_index, is_two_way, linked_question_id, pending_setup)
    VALUES (partner, p_question, NULL, NULL, TRUE, new_id, TRUE)
    RETURNING id INTO partner_question_id;

    -- Link back
    UPDATE quiz_questions SET linked_question_id = partner_question_id WHERE id = new_id;
  END IF;

  RETURN new_id;
END;
$$;

-- Function to set up a pending two-way question
CREATE OR REPLACE FUNCTION setup_two_way_question(
  p_question_id UUID,
  p_author TEXT,
  p_options JSONB,
  p_correct_index INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE quiz_questions
  SET options = p_options,
      correct_answer_index = p_correct_index,
      pending_setup = FALSE
  WHERE id = p_question_id
    AND author = p_author
    AND pending_setup = TRUE;

  RETURN FOUND;
END;
$$;

-- Update delete to handle linked questions
CREATE OR REPLACE FUNCTION delete_quiz_question(
  p_question_id UUID,
  p_author TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  linked_id UUID;
  deleted_count INTEGER;
BEGIN
  -- Get linked question if exists
  SELECT linked_question_id INTO linked_id
  FROM quiz_questions
  WHERE id = p_question_id AND author = p_author;

  -- Delete the question
  DELETE FROM quiz_questions
  WHERE id = p_question_id AND author = p_author;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  -- Also delete linked question if this was the original creator
  IF linked_id IS NOT NULL AND deleted_count > 0 THEN
    DELETE FROM quiz_questions WHERE id = linked_id;
  END IF;

  RETURN deleted_count > 0;
END;
$$;
