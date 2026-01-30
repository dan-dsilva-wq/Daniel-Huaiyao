-- ============================================
-- QUIZ GAME - COMPLETE SCHEMA
-- Run this single file to set up everything
-- ============================================

-- Tables
CREATE TABLE IF NOT EXISTS quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author TEXT NOT NULL CHECK (author IN ('daniel', 'huaiyao')),
  question_text TEXT NOT NULL,
  options JSONB,
  correct_answer_index INTEGER,
  correct_answer_indices JSONB DEFAULT NULL,
  is_multiple_choice BOOLEAN DEFAULT FALSE,
  is_two_way BOOLEAN DEFAULT FALSE,
  linked_question_id UUID REFERENCES quiz_questions(id) ON DELETE SET NULL,
  pending_setup BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quiz_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  player TEXT NOT NULL CHECK (player IN ('daniel', 'huaiyao')),
  selected_index INTEGER NOT NULL,
  selected_indices JSONB DEFAULT NULL,
  is_correct BOOLEAN NOT NULL,
  answered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(question_id, player)
);

-- Enable RLS
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_answers ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow all quiz_questions" ON quiz_questions;
DROP POLICY IF EXISTS "Allow all quiz_answers" ON quiz_answers;

-- Create policies (allow all for this private app)
CREATE POLICY "Allow all quiz_questions" ON quiz_questions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all quiz_answers" ON quiz_answers FOR ALL USING (true) WITH CHECK (true);

-- Grant permissions
GRANT ALL ON quiz_questions TO anon;
GRANT ALL ON quiz_questions TO authenticated;
GRANT ALL ON quiz_answers TO anon;
GRANT ALL ON quiz_answers TO authenticated;
