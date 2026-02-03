-- Update get_new_item_counts to show indicator if user hasn't answered today's prompt
-- Also keeps the existing logic for new content from partner

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
  last_book TIMESTAMPTZ;
  today_prompt_id UUID;
  user_answered_today BOOLEAN;
  prompts_indicator INTEGER;
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

  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_book
  FROM user_app_views WHERE user_name = p_user_name AND app_name = 'book';
  last_book := COALESCE(last_book, '1970-01-01'::TIMESTAMPTZ);

  -- Check if user has answered today's prompt
  SELECT id INTO today_prompt_id
  FROM daily_prompts
  WHERE prompt_date = CURRENT_DATE
  LIMIT 1;

  IF today_prompt_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM prompt_responses
      WHERE daily_prompt_id = today_prompt_id
      AND player = p_user_name
    ) INTO user_answered_today;
  ELSE
    user_answered_today := TRUE; -- No prompt today, so nothing to answer
  END IF;

  -- For Daily Prompts: show indicator if user hasn't answered today OR if partner has new responses
  IF NOT user_answered_today THEN
    prompts_indicator := 1;
  ELSE
    SELECT COUNT(*)::INTEGER INTO prompts_indicator
    FROM prompt_responses
    WHERE created_at > last_prompts AND player != p_user_name;
  END IF;

  -- Build result with counts of new items (added by the OTHER user)
  SELECT json_build_object(
    'Quiz Time', (SELECT COUNT(*) FROM quiz_questions WHERE created_at > last_quiz AND author != p_user_name),
    'Date Ideas', 0,
    'Memories', (SELECT COUNT(*) FROM memories WHERE created_at > last_memories AND created_by != p_user_name),
    'Gratitude Wall', (SELECT COUNT(*) FROM gratitude_notes WHERE created_at > last_gratitude AND from_player != p_user_name AND to_player = p_user_name),
    'Daily Prompts', prompts_indicator,
    'Our Map', (SELECT COUNT(*) FROM map_places WHERE created_at > last_map AND added_by != p_user_name),
    'Media Tracker', (SELECT COUNT(*) FROM media_items WHERE created_at > last_media AND added_by != p_user_name),
    'Countdown', (SELECT COUNT(*) FROM important_dates WHERE created_at > last_countdown AND created_by != p_user_name),
    'Story Book', (SELECT COUNT(*) FROM book_sentences WHERE created_at > last_book AND writer != p_user_name)
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql;
