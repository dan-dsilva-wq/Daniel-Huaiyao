-- Quiz Fix: Drop and recreate all functions with correct signatures

-- Drop existing functions first
DROP FUNCTION IF EXISTS add_quiz_question(TEXT, TEXT, JSONB, INTEGER);
DROP FUNCTION IF EXISTS add_quiz_question(TEXT, TEXT, JSONB, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS add_quiz_question(TEXT, TEXT, JSONB, INTEGER, BOOLEAN, BOOLEAN, JSONB);

-- Recreate add_quiz_question with all parameters
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

-- Verify the function exists
SELECT proname, pronargs FROM pg_proc WHERE proname = 'add_quiz_question';
