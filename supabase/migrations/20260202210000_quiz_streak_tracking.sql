-- Quiz streak tracking
CREATE TABLE IF NOT EXISTS quiz_player_stats (
  player TEXT PRIMARY KEY CHECK (player IN ('daniel', 'huaiyao')),
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_answer_date DATE,
  total_questions_answered INTEGER DEFAULT 0,
  total_correct INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initialize both players
INSERT INTO quiz_player_stats (player, current_streak, longest_streak, total_questions_answered, total_correct)
VALUES
  ('daniel', 0, 0, 0, 0),
  ('huaiyao', 0, 0, 0, 0)
ON CONFLICT (player) DO NOTHING;

-- Function to update streak after answering a question
CREATE OR REPLACE FUNCTION update_quiz_streak(p_player TEXT, p_is_correct BOOLEAN)
RETURNS TABLE(current_streak INTEGER, longest_streak INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_last_date DATE;
  v_current_streak INTEGER;
  v_longest_streak INTEGER;
  v_today DATE := CURRENT_DATE;
BEGIN
  -- Get current stats
  SELECT qps.last_answer_date, qps.current_streak, qps.longest_streak
  INTO v_last_date, v_current_streak, v_longest_streak
  FROM quiz_player_stats qps
  WHERE qps.player = p_player;

  -- If correct answer, update streak
  IF p_is_correct THEN
    IF v_last_date IS NULL OR v_last_date < v_today - 1 THEN
      -- Starting fresh streak
      v_current_streak := 1;
    ELSIF v_last_date = v_today - 1 THEN
      -- Continuing streak from yesterday
      v_current_streak := v_current_streak + 1;
    ELSIF v_last_date = v_today THEN
      -- Already answered correctly today, keep streak
      NULL;
    END IF;

    -- Update longest streak if needed
    IF v_current_streak > v_longest_streak THEN
      v_longest_streak := v_current_streak;
    END IF;
  ELSE
    -- Wrong answer on a new day resets streak
    IF v_last_date IS NULL OR v_last_date < v_today THEN
      v_current_streak := 0;
    END IF;
  END IF;

  -- Update the stats
  UPDATE quiz_player_stats
  SET
    current_streak = v_current_streak,
    longest_streak = v_longest_streak,
    last_answer_date = v_today,
    total_questions_answered = total_questions_answered + 1,
    total_correct = total_correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    updated_at = NOW()
  WHERE quiz_player_stats.player = p_player;

  RETURN QUERY SELECT v_current_streak, v_longest_streak;
END;
$$;

-- Function to get player stats
CREATE OR REPLACE FUNCTION get_quiz_player_stats(p_player TEXT)
RETURNS TABLE(
  current_streak INTEGER,
  longest_streak INTEGER,
  last_answer_date DATE,
  total_questions_answered INTEGER,
  total_correct INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    qps.current_streak,
    qps.longest_streak,
    qps.last_answer_date,
    qps.total_questions_answered,
    qps.total_correct
  FROM quiz_player_stats qps
  WHERE qps.player = p_player;
END;
$$;
