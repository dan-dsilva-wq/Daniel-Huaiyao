-- Quiz player stats for streak tracking
CREATE TABLE quiz_player_stats (
  player TEXT PRIMARY KEY CHECK (player IN ('daniel', 'huaiyao')),
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_answer_date DATE,
  total_questions_answered INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initialize both players
INSERT INTO quiz_player_stats (player) VALUES ('daniel'), ('huaiyao')
ON CONFLICT (player) DO NOTHING;

-- RPC to update streak when player answers a question
CREATE OR REPLACE FUNCTION update_quiz_streak(p_player TEXT)
RETURNS TABLE (
  current_streak INTEGER,
  longest_streak INTEGER,
  is_new_streak BOOLEAN
) AS $$
DECLARE
  v_stats quiz_player_stats%ROWTYPE;
  v_today DATE := CURRENT_DATE;
  v_is_new_streak BOOLEAN := false;
BEGIN
  -- Get current stats
  SELECT * INTO v_stats FROM quiz_player_stats WHERE player = p_player;

  IF NOT FOUND THEN
    -- Create new record
    INSERT INTO quiz_player_stats (player, current_streak, longest_streak, last_answer_date, total_questions_answered)
    VALUES (p_player, 1, 1, v_today, 1);
    RETURN QUERY SELECT 1, 1, true;
    RETURN;
  END IF;

  -- Update total count
  v_stats.total_questions_answered := COALESCE(v_stats.total_questions_answered, 0) + 1;

  IF v_stats.last_answer_date IS NULL THEN
    -- First answer ever
    v_stats.current_streak := 1;
    v_stats.longest_streak := 1;
    v_is_new_streak := true;
  ELSIF v_stats.last_answer_date = v_today THEN
    -- Already answered today, don't change streak
    NULL;
  ELSIF v_stats.last_answer_date = v_today - 1 THEN
    -- Consecutive day
    v_stats.current_streak := COALESCE(v_stats.current_streak, 0) + 1;
    IF v_stats.current_streak > COALESCE(v_stats.longest_streak, 0) THEN
      v_stats.longest_streak := v_stats.current_streak;
      v_is_new_streak := true;
    END IF;
  ELSE
    -- Streak broken, start new
    v_stats.current_streak := 1;
  END IF;

  -- Update record
  UPDATE quiz_player_stats
  SET current_streak = v_stats.current_streak,
      longest_streak = v_stats.longest_streak,
      last_answer_date = v_today,
      total_questions_answered = v_stats.total_questions_answered,
      updated_at = NOW()
  WHERE player = p_player;

  RETURN QUERY SELECT v_stats.current_streak, v_stats.longest_streak, v_is_new_streak;
END;
$$ LANGUAGE plpgsql;

-- RPC to get player stats
CREATE OR REPLACE FUNCTION get_quiz_player_stats()
RETURNS TABLE (
  player TEXT,
  current_streak INTEGER,
  longest_streak INTEGER,
  last_answer_date DATE,
  total_questions_answered INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT s.player, s.current_streak, s.longest_streak, s.last_answer_date, s.total_questions_answered
  FROM quiz_player_stats s
  ORDER BY s.player;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE quiz_player_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to quiz_player_stats"
  ON quiz_player_stats FOR ALL USING (true) WITH CHECK (true);
