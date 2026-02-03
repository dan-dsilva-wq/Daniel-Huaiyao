-- =============================================
-- ENGAGEMENT FEATURES MIGRATION
-- Memory Flashbacks, Typing Indicators, Activity Feed,
-- Shared Streak Counter, Now Watching
-- =============================================

-- =============================================
-- 1. MEMORY FLASHBACKS ("On This Day")
-- =============================================

-- Function to get memories from same day in previous years
CREATE OR REPLACE FUNCTION get_memory_flashbacks(p_today DATE DEFAULT CURRENT_DATE)
RETURNS TABLE(
  id UUID,
  title TEXT,
  description TEXT,
  memory_date DATE,
  years_ago INTEGER,
  photo_url TEXT,
  memory_type TEXT,
  location_name TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.title,
    m.description,
    m.memory_date,
    EXTRACT(YEAR FROM p_today)::INTEGER - EXTRACT(YEAR FROM m.memory_date)::INTEGER AS years_ago,
    (SELECT mp.photo_url FROM memory_photos mp WHERE mp.memory_id = m.id LIMIT 1) AS photo_url,
    m.memory_type::TEXT,
    m.location_name
  FROM memories m
  WHERE
    EXTRACT(MONTH FROM m.memory_date) = EXTRACT(MONTH FROM p_today)
    AND EXTRACT(DAY FROM m.memory_date) = EXTRACT(DAY FROM p_today)
    AND EXTRACT(YEAR FROM m.memory_date) < EXTRACT(YEAR FROM p_today)
  ORDER BY m.memory_date DESC;
END;
$$;

-- =============================================
-- 2. TYPING INDICATORS
-- =============================================

-- Table to track typing status
CREATE TABLE IF NOT EXISTS typing_status (
  player TEXT PRIMARY KEY CHECK (player IN ('daniel', 'huaiyao')),
  app_name TEXT,
  is_typing BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initialize both players
INSERT INTO typing_status (player, is_typing)
VALUES ('daniel', false), ('huaiyao', false)
ON CONFLICT (player) DO NOTHING;

-- Enable realtime for typing_status
ALTER PUBLICATION supabase_realtime ADD TABLE typing_status;

-- Function to update typing status
CREATE OR REPLACE FUNCTION set_typing_status(
  p_player TEXT,
  p_app_name TEXT,
  p_is_typing BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE typing_status
  SET
    app_name = p_app_name,
    is_typing = p_is_typing,
    updated_at = NOW()
  WHERE player = p_player;
END;
$$;

-- Function to get partner typing status
CREATE OR REPLACE FUNCTION get_typing_status(p_player TEXT)
RETURNS TABLE(
  partner_typing BOOLEAN,
  partner_app TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_partner TEXT;
BEGIN
  v_partner := CASE WHEN p_player = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;

  RETURN QUERY
  SELECT
    ts.is_typing,
    ts.app_name,
    ts.updated_at
  FROM typing_status ts
  WHERE ts.player = v_partner;
END;
$$;

-- =============================================
-- 3. ACTIVITY FEED
-- =============================================

-- Table to log all partner activities
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player TEXT NOT NULL CHECK (player IN ('daniel', 'huaiyao')),
  action_type TEXT NOT NULL,
  action_title TEXT,
  app_name TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_activity_log_player_created
ON activity_log(player, created_at DESC);

-- Enable RLS
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read activities" ON activity_log FOR SELECT USING (true);
CREATE POLICY "Anyone can insert activities" ON activity_log FOR INSERT WITH CHECK (true);

-- Function to log an activity
CREATE OR REPLACE FUNCTION log_activity(
  p_player TEXT,
  p_action_type TEXT,
  p_app_name TEXT,
  p_action_title TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO activity_log (player, action_type, action_title, app_name, metadata)
  VALUES (p_player, p_action_type, p_action_title, p_app_name, p_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Function to get partner's recent activities
CREATE OR REPLACE FUNCTION get_partner_activity(
  p_player TEXT,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE(
  id UUID,
  action_type TEXT,
  action_title TEXT,
  app_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_partner TEXT;
BEGIN
  v_partner := CASE WHEN p_player = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;

  RETURN QUERY
  SELECT
    al.id,
    al.action_type,
    al.action_title,
    al.app_name,
    al.created_at
  FROM activity_log al
  WHERE al.player = v_partner
  ORDER BY al.created_at DESC
  LIMIT p_limit;
END;
$$;

-- =============================================
-- 4. SHARED STREAK COUNTER
-- =============================================

-- Table to track daily check-ins
CREATE TABLE IF NOT EXISTS daily_check_ins (
  player TEXT NOT NULL CHECK (player IN ('daniel', 'huaiyao')),
  check_in_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (player, check_in_date)
);

-- Enable RLS
ALTER TABLE daily_check_ins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read check-ins" ON daily_check_ins FOR SELECT USING (true);
CREATE POLICY "Anyone can insert check-ins" ON daily_check_ins FOR INSERT WITH CHECK (true);

-- Function to record a check-in (call when user visits home page)
CREATE OR REPLACE FUNCTION record_check_in(p_player TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO daily_check_ins (player, check_in_date)
  VALUES (p_player, CURRENT_DATE)
  ON CONFLICT (player, check_in_date) DO NOTHING;
END;
$$;

-- Function to calculate shared streak (days both were active)
CREATE OR REPLACE FUNCTION get_shared_streak()
RETURNS TABLE(
  current_streak INTEGER,
  longest_streak INTEGER,
  last_both_active DATE,
  daniel_checked_in_today BOOLEAN,
  huaiyao_checked_in_today BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_streak INTEGER := 0;
  v_longest_streak INTEGER := 0;
  v_last_both DATE;
  v_check_date DATE;
  v_streak_count INTEGER := 0;
  v_daniel_today BOOLEAN;
  v_huaiyao_today BOOLEAN;
BEGIN
  -- Check if both checked in today
  SELECT EXISTS(SELECT 1 FROM daily_check_ins WHERE player = 'daniel' AND check_in_date = CURRENT_DATE)
  INTO v_daniel_today;

  SELECT EXISTS(SELECT 1 FROM daily_check_ins WHERE player = 'huaiyao' AND check_in_date = CURRENT_DATE)
  INTO v_huaiyao_today;

  -- Find dates where both were active
  FOR v_check_date IN
    SELECT DISTINCT d.check_in_date
    FROM daily_check_ins d
    WHERE EXISTS (
      SELECT 1 FROM daily_check_ins h
      WHERE h.check_in_date = d.check_in_date
      AND h.player = 'huaiyao'
    )
    AND d.player = 'daniel'
    ORDER BY d.check_in_date DESC
  LOOP
    IF v_last_both IS NULL THEN
      v_last_both := v_check_date;
    END IF;

    -- Check if this date continues the streak
    IF v_last_both IS NOT NULL AND (v_last_both - v_check_date) = v_streak_count THEN
      v_streak_count := v_streak_count + 1;
    ELSE
      -- Streak broken, check if this was the longest
      IF v_streak_count > v_longest_streak THEN
        v_longest_streak := v_streak_count;
      END IF;

      -- Start new streak count
      IF v_last_both = v_check_date OR v_last_both - v_check_date = 0 THEN
        v_streak_count := 1;
      ELSE
        EXIT;
      END IF;
    END IF;
  END LOOP;

  -- Final check for longest
  IF v_streak_count > v_longest_streak THEN
    v_longest_streak := v_streak_count;
  END IF;

  v_current_streak := v_streak_count;

  RETURN QUERY SELECT v_current_streak, v_longest_streak, v_last_both, v_daniel_today, v_huaiyao_today;
END;
$$;

-- =============================================
-- 5. MEDIA "NOW WATCHING" STATUS
-- =============================================

-- Add columns to media_items for watching status
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS currently_watching_by TEXT CHECK (currently_watching_by IS NULL OR currently_watching_by IN ('daniel', 'huaiyao'));
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS watching_started_at TIMESTAMPTZ;

-- Function to start watching a media item
CREATE OR REPLACE FUNCTION start_watching_media(
  p_media_id UUID,
  p_player TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- Clear any existing "watching" status for this player
  UPDATE media_items
  SET currently_watching_by = NULL, watching_started_at = NULL
  WHERE currently_watching_by = p_player;

  -- Set new watching status
  UPDATE media_items
  SET
    currently_watching_by = p_player,
    watching_started_at = NOW()
  WHERE id = p_media_id;
END;
$$;

-- Function to stop watching
CREATE OR REPLACE FUNCTION stop_watching_media(p_player TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE media_items
  SET currently_watching_by = NULL, watching_started_at = NULL
  WHERE currently_watching_by = p_player;
END;
$$;

-- Function to get what partner is watching
CREATE OR REPLACE FUNCTION get_partner_watching(p_player TEXT)
RETURNS TABLE(
  media_id UUID,
  title TEXT,
  media_type TEXT,
  started_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_partner TEXT;
BEGIN
  v_partner := CASE WHEN p_player = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;

  RETURN QUERY
  SELECT
    m.id,
    m.title,
    m.media_type::TEXT,
    m.watching_started_at
  FROM media_items m
  WHERE m.currently_watching_by = v_partner
    AND m.watching_started_at > NOW() - INTERVAL '3 hours'; -- Auto-expire after 3 hours
END;
$$;

-- =============================================
-- 6. PARTNER PRESENCE (for home page)
-- =============================================

-- Table for presence status (if not exists)
CREATE TABLE IF NOT EXISTS user_presence (
  player TEXT PRIMARY KEY CHECK (player IN ('daniel', 'huaiyao')),
  is_online BOOLEAN DEFAULT false,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  current_app TEXT
);

-- Initialize both players
INSERT INTO user_presence (player, is_online)
VALUES ('daniel', false), ('huaiyao', false)
ON CONFLICT (player) DO NOTHING;

-- Enable realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE user_presence;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Function to update presence
CREATE OR REPLACE FUNCTION update_presence(
  p_player TEXT,
  p_is_online BOOLEAN,
  p_current_app TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO user_presence (player, is_online, last_seen, current_app)
  VALUES (p_player, p_is_online, NOW(), p_current_app)
  ON CONFLICT (player) DO UPDATE SET
    is_online = p_is_online,
    last_seen = NOW(),
    current_app = COALESCE(p_current_app, user_presence.current_app);
END;
$$;

-- Function to get partner presence
CREATE OR REPLACE FUNCTION get_partner_presence(p_player TEXT)
RETURNS TABLE(
  is_online BOOLEAN,
  last_seen TIMESTAMPTZ,
  current_app TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_partner TEXT;
BEGIN
  v_partner := CASE WHEN p_player = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;

  RETURN QUERY
  SELECT
    up.is_online AND up.last_seen > NOW() - INTERVAL '2 minutes',
    up.last_seen,
    up.current_app
  FROM user_presence up
  WHERE up.player = v_partner;
END;
$$;

-- =============================================
-- 7. HOME PAGE DATA AGGREGATOR
-- =============================================

-- =============================================
-- 8. JOINT ACHIEVEMENTS
-- =============================================

-- Add joint achievements to the achievements table
INSERT INTO achievements (code, title, description, emoji, category, points, requirement_count, is_secret) VALUES
-- Streak achievements
('joint_streak_7', 'Week Together', 'Both visit the app for 7 consecutive days', '🔥', 'general', 50, 7, false),
('joint_streak_30', 'Monthly Commitment', 'Both visit the app for 30 consecutive days', '💪', 'general', 100, 30, false),
('joint_streak_100', 'Century Club', 'Both visit the app for 100 consecutive days', '🏅', 'general', 200, 100, true),

-- Team milestones
('joint_memories_25', 'Memory Lane', 'Create 25 memories together', '📸', 'memories', 50, 25, false),
('joint_quiz_100', 'Quiz Champions', 'Answer 100 quiz questions together', '🧠', 'quiz', 75, 100, false),
('joint_gratitude_50', 'Thankful Hearts', 'Send 50 gratitude notes to each other', '💕', 'gratitude', 60, 50, false),
('joint_mystery_5', 'Detective Duo', 'Solve 5 mysteries together', '🔍', 'mystery', 75, 5, false),
('joint_book_50', 'Story Weavers', 'Write 50 sentences in your story together', '📖', 'general', 50, 50, false),
('joint_places_10', 'World Travelers', 'Visit 10 places together', '🌍', 'general', 75, 10, false)
ON CONFLICT (code) DO NOTHING;

-- Function to check and unlock joint achievements
CREATE OR REPLACE FUNCTION check_joint_achievements()
RETURNS TABLE(
  achievement_code TEXT,
  achievement_title TEXT,
  achievement_emoji TEXT,
  newly_unlocked BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_streak_current INTEGER;
  v_memories_count INTEGER;
  v_quiz_count INTEGER;
  v_gratitude_count INTEGER;
  v_mystery_count INTEGER;
  v_book_count INTEGER;
  v_places_count INTEGER;
BEGIN
  -- Get current shared streak
  SELECT current_streak INTO v_streak_current FROM get_shared_streak();

  -- Get team counts
  SELECT COUNT(*) INTO v_memories_count FROM memories;
  SELECT COUNT(*) INTO v_quiz_count FROM quiz_answers;
  SELECT COUNT(*) INTO v_gratitude_count FROM gratitude_notes;
  SELECT COUNT(*) INTO v_mystery_count FROM mystery_sessions WHERE status = 'completed';
  SELECT COUNT(*) INTO v_book_count FROM book_sentences;
  SELECT COUNT(*) INTO v_places_count FROM map_places WHERE daniel_status = 'visited' AND huaiyao_status = 'visited';

  -- Check streak achievements for both players
  IF v_streak_current >= 7 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'daniel', id FROM achievements WHERE code = 'joint_streak_7'
    ON CONFLICT DO NOTHING;
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'huaiyao', id FROM achievements WHERE code = 'joint_streak_7'
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_streak_current >= 30 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'daniel', id FROM achievements WHERE code = 'joint_streak_30'
    ON CONFLICT DO NOTHING;
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'huaiyao', id FROM achievements WHERE code = 'joint_streak_30'
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_streak_current >= 100 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'daniel', id FROM achievements WHERE code = 'joint_streak_100'
    ON CONFLICT DO NOTHING;
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'huaiyao', id FROM achievements WHERE code = 'joint_streak_100'
    ON CONFLICT DO NOTHING;
  END IF;

  -- Check team milestone achievements
  IF v_memories_count >= 25 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'daniel', id FROM achievements WHERE code = 'joint_memories_25'
    ON CONFLICT DO NOTHING;
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'huaiyao', id FROM achievements WHERE code = 'joint_memories_25'
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_quiz_count >= 100 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'daniel', id FROM achievements WHERE code = 'joint_quiz_100'
    ON CONFLICT DO NOTHING;
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'huaiyao', id FROM achievements WHERE code = 'joint_quiz_100'
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_gratitude_count >= 50 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'daniel', id FROM achievements WHERE code = 'joint_gratitude_50'
    ON CONFLICT DO NOTHING;
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'huaiyao', id FROM achievements WHERE code = 'joint_gratitude_50'
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_mystery_count >= 5 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'daniel', id FROM achievements WHERE code = 'joint_mystery_5'
    ON CONFLICT DO NOTHING;
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'huaiyao', id FROM achievements WHERE code = 'joint_mystery_5'
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_book_count >= 50 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'daniel', id FROM achievements WHERE code = 'joint_book_50'
    ON CONFLICT DO NOTHING;
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'huaiyao', id FROM achievements WHERE code = 'joint_book_50'
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_places_count >= 10 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'daniel', id FROM achievements WHERE code = 'joint_places_10'
    ON CONFLICT DO NOTHING;
    INSERT INTO player_achievements (player, achievement_id)
    SELECT 'huaiyao', id FROM achievements WHERE code = 'joint_places_10'
    ON CONFLICT DO NOTHING;
  END IF;

  -- Return recently unlocked joint achievements (last 5 minutes)
  RETURN QUERY
  SELECT DISTINCT
    a.code,
    a.title,
    a.emoji,
    pa.unlocked_at > NOW() - INTERVAL '5 minutes' AS newly_unlocked
  FROM achievements a
  JOIN player_achievements pa ON a.id = pa.achievement_id
  WHERE a.code LIKE 'joint_%'
    AND pa.unlocked_at > NOW() - INTERVAL '5 minutes';
END;
$$;

-- =============================================
-- 7. HOME PAGE DATA AGGREGATOR
-- =============================================

-- Function to get all home page engagement data in one call
CREATE OR REPLACE FUNCTION get_home_engagement_data(p_player TEXT)
RETURNS TABLE(
  flashbacks JSONB,
  partner_activity JSONB,
  shared_streak JSONB,
  partner_presence JSONB,
  partner_watching JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_flashbacks JSONB;
  v_activity JSONB;
  v_streak JSONB;
  v_presence JSONB;
  v_watching JSONB;
BEGIN
  -- Get flashbacks
  SELECT COALESCE(jsonb_agg(row_to_json(f)), '[]'::jsonb)
  INTO v_flashbacks
  FROM get_memory_flashbacks() f;

  -- Get partner activity
  SELECT COALESCE(jsonb_agg(row_to_json(a)), '[]'::jsonb)
  INTO v_activity
  FROM get_partner_activity(p_player, 5) a;

  -- Get shared streak
  SELECT row_to_json(s)::jsonb
  INTO v_streak
  FROM get_shared_streak() s;

  -- Get partner presence
  SELECT row_to_json(p)::jsonb
  INTO v_presence
  FROM get_partner_presence(p_player) p;

  -- Get what partner is watching
  SELECT COALESCE(jsonb_agg(row_to_json(w)), '[]'::jsonb)
  INTO v_watching
  FROM get_partner_watching(p_player) w;

  RETURN QUERY SELECT v_flashbacks, v_activity, v_streak, v_presence, v_watching;
END;
$$;
