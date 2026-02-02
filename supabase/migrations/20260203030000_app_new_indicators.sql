-- Track when each user last viewed each app
CREATE TABLE user_app_views (
  user_name TEXT NOT NULL CHECK (user_name IN ('daniel', 'huaiyao')),
  app_name TEXT NOT NULL,
  last_viewed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_name, app_name)
);

-- Enable RLS
ALTER TABLE user_app_views ENABLE ROW LEVEL SECURITY;

-- Allow all operations (private app)
CREATE POLICY "Allow all" ON user_app_views FOR ALL USING (true) WITH CHECK (true);

-- Function to get new item counts for all apps for a user
CREATE OR REPLACE FUNCTION get_new_item_counts(p_user_name TEXT)
RETURNS JSON AS $$
DECLARE
  result JSON;
  last_quiz TIMESTAMPTZ;
  last_dates TIMESTAMPTZ;
  last_memories TIMESTAMPTZ;
  last_gratitude TIMESTAMPTZ;
  last_prompts TIMESTAMPTZ;
  last_map TIMESTAMPTZ;
  last_media TIMESTAMPTZ;
  last_countdown TIMESTAMPTZ;
BEGIN
  -- Get last viewed times (default to epoch if never viewed)
  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_quiz
  FROM user_app_views WHERE user_name = p_user_name AND app_name = 'quiz';
  last_quiz := COALESCE(last_quiz, '1970-01-01'::TIMESTAMPTZ);

  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_dates
  FROM user_app_views WHERE user_name = p_user_name AND app_name = 'dates';
  last_dates := COALESCE(last_dates, '1970-01-01'::TIMESTAMPTZ);

  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_memories
  FROM user_app_views WHERE user_name = p_user_name AND app_name = 'memories';
  last_memories := COALESCE(last_memories, '1970-01-01'::TIMESTAMPTZ);

  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_gratitude
  FROM user_app_views WHERE user_name = p_user_name AND app_name = 'gratitude';
  last_gratitude := COALESCE(last_gratitude, '1970-01-01'::TIMESTAMPTZ);

  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_prompts
  FROM user_app_views WHERE user_name = p_user_name AND app_name = 'prompts';
  last_prompts := COALESCE(last_prompts, '1970-01-01'::TIMESTAMPTZ);

  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_map
  FROM user_app_views WHERE user_name = p_user_name AND app_name = 'map';
  last_map := COALESCE(last_map, '1970-01-01'::TIMESTAMPTZ);

  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_media
  FROM user_app_views WHERE user_name = p_user_name AND app_name = 'media';
  last_media := COALESCE(last_media, '1970-01-01'::TIMESTAMPTZ);

  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_countdown
  FROM user_app_views WHERE user_name = p_user_name AND app_name = 'countdown';
  last_countdown := COALESCE(last_countdown, '1970-01-01'::TIMESTAMPTZ);

  -- Build result with counts of new items (added by the OTHER user)
  SELECT json_build_object(
    'Quiz Time', (SELECT COUNT(*) FROM quiz_questions WHERE created_at > last_quiz AND added_by != p_user_name),
    'Date Ideas', (SELECT COUNT(*) FROM date_ideas WHERE created_at > last_dates AND added_by != p_user_name),
    'Memories', (SELECT COUNT(*) FROM memories WHERE created_at > last_memories AND created_by != p_user_name),
    'Gratitude Wall', (SELECT COUNT(*) FROM gratitude_notes WHERE created_at > last_gratitude AND from_player != p_user_name AND to_player = p_user_name),
    'Daily Prompts', (SELECT COUNT(*) FROM prompt_responses WHERE created_at > last_prompts AND player != p_user_name),
    'Our Map', (SELECT COUNT(*) FROM map_places WHERE created_at > last_map AND added_by != p_user_name),
    'Media Tracker', (SELECT COUNT(*) FROM media_items WHERE created_at > last_media AND added_by != p_user_name),
    'Countdown', (SELECT COUNT(*) FROM important_dates WHERE created_at > last_countdown AND created_by != p_user_name)
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to mark an app as viewed
CREATE OR REPLACE FUNCTION mark_app_viewed(p_user_name TEXT, p_app_name TEXT)
RETURNS void AS $$
BEGIN
  INSERT INTO user_app_views (user_name, app_name, last_viewed_at)
  VALUES (p_user_name, p_app_name, NOW())
  ON CONFLICT (user_name, app_name)
  DO UPDATE SET last_viewed_at = NOW();
END;
$$ LANGUAGE plpgsql;
