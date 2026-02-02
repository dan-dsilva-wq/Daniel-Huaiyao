-- Achievements & Stats Dashboard tables

-- Achievements definition table
CREATE TABLE achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🏆',
  category TEXT NOT NULL CHECK (category IN ('quiz', 'mystery', 'dates', 'gratitude', 'memories', 'media', 'prompts', 'general')),
  points INTEGER DEFAULT 10,
  is_secret BOOLEAN DEFAULT false,
  requirement_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Player achievements (unlocked)
CREATE TABLE player_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player TEXT NOT NULL CHECK (player IN ('daniel', 'huaiyao')),
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player, achievement_id)
);

-- Relationship stats (aggregate data)
CREATE TABLE relationship_stats (
  id TEXT PRIMARY KEY DEFAULT 'main',
  first_date DATE,
  quiz_questions_answered INTEGER DEFAULT 0,
  quiz_correct_answers INTEGER DEFAULT 0,
  mysteries_completed INTEGER DEFAULT 0,
  dates_completed INTEGER DEFAULT 0,
  gratitude_notes_sent INTEGER DEFAULT 0,
  memories_created INTEGER DEFAULT 0,
  prompts_answered INTEGER DEFAULT 0,
  media_completed INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default stats row
INSERT INTO relationship_stats (id) VALUES ('main') ON CONFLICT DO NOTHING;

-- Indexes
CREATE INDEX idx_player_achievements_player ON player_achievements(player);
CREATE INDEX idx_achievements_category ON achievements(category);
CREATE INDEX idx_achievements_secret ON achievements(is_secret) WHERE is_secret = false;

-- Insert default achievements
INSERT INTO achievements (code, title, description, emoji, category, points, requirement_count, is_secret) VALUES
-- Quiz achievements
('quiz_first', 'Quiz Rookie', 'Answer your first quiz question', '🎯', 'quiz', 10, 1, false),
('quiz_10', 'Quiz Enthusiast', 'Answer 10 quiz questions', '📚', 'quiz', 25, 10, false),
('quiz_50', 'Quiz Master', 'Answer 50 quiz questions', '🧠', 'quiz', 50, 50, false),
('quiz_streak_3', 'On a Roll', 'Get a 3-day quiz streak', '🔥', 'quiz', 30, 3, false),
('quiz_streak_7', 'Week Warrior', 'Get a 7-day quiz streak', '⚡', 'quiz', 50, 7, false),
('quiz_perfect', 'Perfect Score', 'Get 5 correct answers in a row', '💯', 'quiz', 40, 5, true),

-- Mystery achievements
('mystery_first', 'Detective Debut', 'Complete your first mystery episode', '🔍', 'mystery', 15, 1, false),
('mystery_5', 'Mystery Maven', 'Complete 5 mystery episodes', '🕵️', 'mystery', 40, 5, false),
('mystery_puzzles_10', 'Puzzle Pro', 'Solve 10 puzzles', '🧩', 'mystery', 30, 10, false),

-- Dates achievements
('dates_first', 'First Date', 'Complete your first date idea', '💑', 'dates', 20, 1, false),
('dates_10', 'Date Night Regular', 'Complete 10 date ideas', '🌙', 'dates', 50, 10, false),

-- Gratitude achievements
('gratitude_first', 'Thoughtful', 'Send your first gratitude note', '💝', 'gratitude', 10, 1, false),
('gratitude_10', 'Appreciator', 'Send 10 gratitude notes', '🥰', 'gratitude', 30, 10, false),
('gratitude_50', 'Love Expert', 'Send 50 gratitude notes', '💖', 'gratitude', 75, 50, false),

-- Memory achievements
('memory_first', 'Memory Maker', 'Create your first memory', '📸', 'memories', 15, 1, false),
('memory_10', 'Chronicler', 'Create 10 memories', '📔', 'memories', 40, 10, false),
('memory_milestone', 'Milestone Moment', 'Create a milestone memory', '🏆', 'memories', 25, 1, false),

-- Media achievements
('media_first', 'Media Buff', 'Complete your first media item', '🎬', 'media', 10, 1, false),
('media_10', 'Binge Watcher', 'Complete 10 media items', '📺', 'media', 35, 10, false),

-- Prompts achievements
('prompt_first', 'Conversation Starter', 'Answer your first daily prompt', '💬', 'prompts', 10, 1, false),
('prompt_7', 'Weekly Connect', 'Answer prompts for 7 days', '🗣️', 'prompts', 40, 7, false),
('prompt_30', 'Deep Connection', 'Answer prompts for 30 days', '❤️', 'prompts', 100, 30, false),

-- General achievements
('explorer', 'Explorer', 'Use all app features at least once', '🌟', 'general', 50, 1, false),
('anniversary_1', 'One Year Strong', 'Use the app for 1 year', '🎂', 'general', 100, 1, true),
('power_couple', 'Power Couple', 'Both unlock 10 achievements', '👑', 'general', 75, 10, true);

-- RPC: Get all achievements with player progress
CREATE OR REPLACE FUNCTION get_achievements(p_player TEXT)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'achievements', (
      SELECT json_agg(json_build_object(
        'id', a.id,
        'code', a.code,
        'title', a.title,
        'description', a.description,
        'emoji', a.emoji,
        'category', a.category,
        'points', a.points,
        'is_secret', a.is_secret,
        'unlocked', pa.unlocked_at IS NOT NULL,
        'unlocked_at', pa.unlocked_at
      ) ORDER BY CASE WHEN pa.unlocked_at IS NOT NULL THEN 0 ELSE 1 END, a.category, a.points)
      FROM achievements a
      LEFT JOIN player_achievements pa ON a.id = pa.achievement_id AND pa.player = p_player
      WHERE a.is_secret = false OR pa.unlocked_at IS NOT NULL
    ),
    'total_points', COALESCE((
      SELECT SUM(a.points)
      FROM achievements a
      JOIN player_achievements pa ON a.id = pa.achievement_id
      WHERE pa.player = p_player
    ), 0),
    'unlocked_count', (
      SELECT COUNT(*)
      FROM player_achievements
      WHERE player = p_player
    ),
    'total_count', (
      SELECT COUNT(*)
      FROM achievements
      WHERE is_secret = false
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- RPC: Get relationship stats
CREATE OR REPLACE FUNCTION get_relationship_stats()
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
  days_together INTEGER;
BEGIN
  -- Calculate days together
  SELECT COALESCE(
    (SELECT (CURRENT_DATE - first_date) FROM relationship_stats WHERE id = 'main'),
    0
  ) INTO days_together;

  SELECT json_build_object(
    'days_together', days_together,
    'stats', (SELECT row_to_json(rs) FROM relationship_stats rs WHERE id = 'main'),
    'player_stats', json_build_object(
      'daniel', json_build_object(
        'achievements_unlocked', (SELECT COUNT(*) FROM player_achievements WHERE player = 'daniel'),
        'total_points', COALESCE((
          SELECT SUM(a.points) FROM achievements a
          JOIN player_achievements pa ON a.id = pa.achievement_id
          WHERE pa.player = 'daniel'
        ), 0),
        'quiz_correct', COALESCE((SELECT correct_count FROM quiz_scores WHERE player = 'daniel'), 0),
        'gratitude_sent', (SELECT COUNT(*) FROM gratitude_notes WHERE from_player = 'daniel'),
        'memories_created', (SELECT COUNT(*) FROM memories WHERE created_by = 'daniel')
      ),
      'huaiyao', json_build_object(
        'achievements_unlocked', (SELECT COUNT(*) FROM player_achievements WHERE player = 'huaiyao'),
        'total_points', COALESCE((
          SELECT SUM(a.points) FROM achievements a
          JOIN player_achievements pa ON a.id = pa.achievement_id
          WHERE pa.player = 'huaiyao'
        ), 0),
        'quiz_correct', COALESCE((SELECT correct_count FROM quiz_scores WHERE player = 'huaiyao'), 0),
        'gratitude_sent', (SELECT COUNT(*) FROM gratitude_notes WHERE from_player = 'huaiyao'),
        'memories_created', (SELECT COUNT(*) FROM memories WHERE created_by = 'huaiyao')
      )
    ),
    'recent_achievements', (
      SELECT json_agg(json_build_object(
        'player', pa.player,
        'title', a.title,
        'emoji', a.emoji,
        'unlocked_at', pa.unlocked_at
      ) ORDER BY pa.unlocked_at DESC)
      FROM player_achievements pa
      JOIN achievements a ON a.id = pa.achievement_id
      LIMIT 10
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- RPC: Check and unlock achievements for a player
CREATE OR REPLACE FUNCTION check_achievements(p_player TEXT)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  newly_unlocked JSON;
  quiz_count INTEGER;
  gratitude_count INTEGER;
  memory_count INTEGER;
  mystery_count INTEGER;
BEGIN
  -- Get current counts
  SELECT COALESCE(correct_count + incorrect_count, 0) INTO quiz_count
  FROM quiz_scores WHERE player = p_player;

  SELECT COUNT(*) INTO gratitude_count
  FROM gratitude_notes WHERE from_player = p_player;

  SELECT COUNT(*) INTO memory_count
  FROM memories WHERE created_by = p_player;

  -- Note: mystery_count would need to come from mystery tables when available
  mystery_count := 0;

  -- Quiz achievements
  IF quiz_count >= 1 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT p_player, id FROM achievements WHERE code = 'quiz_first'
    ON CONFLICT DO NOTHING;
  END IF;

  IF quiz_count >= 10 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT p_player, id FROM achievements WHERE code = 'quiz_10'
    ON CONFLICT DO NOTHING;
  END IF;

  IF quiz_count >= 50 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT p_player, id FROM achievements WHERE code = 'quiz_50'
    ON CONFLICT DO NOTHING;
  END IF;

  -- Gratitude achievements
  IF gratitude_count >= 1 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT p_player, id FROM achievements WHERE code = 'gratitude_first'
    ON CONFLICT DO NOTHING;
  END IF;

  IF gratitude_count >= 10 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT p_player, id FROM achievements WHERE code = 'gratitude_10'
    ON CONFLICT DO NOTHING;
  END IF;

  IF gratitude_count >= 50 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT p_player, id FROM achievements WHERE code = 'gratitude_50'
    ON CONFLICT DO NOTHING;
  END IF;

  -- Memory achievements
  IF memory_count >= 1 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT p_player, id FROM achievements WHERE code = 'memory_first'
    ON CONFLICT DO NOTHING;
  END IF;

  IF memory_count >= 10 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT p_player, id FROM achievements WHERE code = 'memory_10'
    ON CONFLICT DO NOTHING;
  END IF;

  -- Return any recently unlocked (last 5 minutes)
  SELECT json_agg(json_build_object(
    'title', a.title,
    'emoji', a.emoji,
    'description', a.description,
    'points', a.points
  ))
  INTO newly_unlocked
  FROM player_achievements pa
  JOIN achievements a ON a.id = pa.achievement_id
  WHERE pa.player = p_player
    AND pa.unlocked_at > NOW() - INTERVAL '5 minutes';

  RETURN COALESCE(newly_unlocked, '[]'::json);
END;
$$;

-- RPC: Set first date
CREATE OR REPLACE FUNCTION set_first_date(p_date DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE relationship_stats SET first_date = p_date, updated_at = NOW() WHERE id = 'main';
  RETURN true;
END;
$$;

-- Enable RLS
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_stats ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Allow all access to achievements" ON achievements FOR ALL USING (true);
CREATE POLICY "Allow all access to player_achievements" ON player_achievements FOR ALL USING (true);
CREATE POLICY "Allow all access to relationship_stats" ON relationship_stats FOR ALL USING (true);
