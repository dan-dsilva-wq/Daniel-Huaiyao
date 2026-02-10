-- Dates page overhaul: new RPC functions for editing ideas, managing categories, and page title

-- 1. Add 'added_by' column to date_ideas for notification tracking
ALTER TABLE date_ideas ADD COLUMN IF NOT EXISTS added_by TEXT;

-- 2. Create date_settings table for page title and future config
CREATE TABLE IF NOT EXISTS date_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE date_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "date_settings_allow_all" ON date_settings FOR ALL USING (true) WITH CHECK (true);

-- Seed default page title
INSERT INTO date_settings (key, value) VALUES ('page_title', 'Date Ideas')
ON CONFLICT (key) DO NOTHING;

-- 3. Update get_date_categories to include category_id in ideas
CREATE OR REPLACE FUNCTION get_date_categories()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(
    json_build_object(
      'id', c.id,
      'name', c.name,
      'emoji', c.emoji,
      'sort_order', c.sort_order,
      'ideas', COALESCE((
        SELECT json_agg(
          json_build_object(
            'id', i.id,
            'category_id', i.category_id,
            'title', i.title,
            'description', i.description,
            'emoji', i.emoji,
            'is_completed', i.is_completed,
            'created_at', i.created_at,
            'updated_at', i.updated_at
          ) ORDER BY i.created_at
        )
        FROM date_ideas i WHERE i.category_id = c.id
      ), '[]'::json)
    ) ORDER BY c.sort_order
  ) INTO result
  FROM date_categories c;

  RETURN COALESCE(result, '[]'::json);
END;
$$ LANGUAGE plpgsql;

-- 4. Update add_date_idea to accept added_by
CREATE OR REPLACE FUNCTION add_date_idea(
  p_category_id UUID,
  p_title TEXT,
  p_description TEXT DEFAULT NULL,
  p_emoji TEXT DEFAULT NULL,
  p_added_by TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  new_idea JSON;
BEGIN
  INSERT INTO date_ideas (category_id, title, description, emoji, added_by)
  VALUES (p_category_id, p_title, p_description, p_emoji, p_added_by)
  RETURNING json_build_object(
    'id', id,
    'category_id', category_id,
    'title', title,
    'description', description,
    'emoji', emoji,
    'is_completed', is_completed,
    'created_at', created_at,
    'updated_at', updated_at
  ) INTO new_idea;

  RETURN new_idea;
END;
$$ LANGUAGE plpgsql;

-- 5. Update an existing date idea (title, description, category)
CREATE OR REPLACE FUNCTION update_date_idea(
  p_idea_id UUID,
  p_title TEXT,
  p_description TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  updated_idea JSON;
BEGIN
  UPDATE date_ideas
  SET
    title = COALESCE(p_title, title),
    description = p_description,
    category_id = COALESCE(p_category_id, category_id),
    updated_at = NOW()
  WHERE id = p_idea_id
  RETURNING json_build_object(
    'id', id,
    'category_id', category_id,
    'title', title,
    'description', description,
    'is_completed', is_completed
  ) INTO updated_idea;

  RETURN updated_idea;
END;
$$ LANGUAGE plpgsql;

-- 6. Add a new category
CREATE OR REPLACE FUNCTION add_date_category(
  p_name TEXT,
  p_emoji TEXT DEFAULT '📌'
)
RETURNS JSON AS $$
DECLARE
  max_order INTEGER;
  new_cat JSON;
BEGIN
  SELECT COALESCE(MAX(sort_order), 0) INTO max_order FROM date_categories;

  INSERT INTO date_categories (name, emoji, sort_order)
  VALUES (p_name, p_emoji, max_order + 1)
  RETURNING json_build_object(
    'id', id,
    'name', name,
    'emoji', emoji,
    'sort_order', sort_order
  ) INTO new_cat;

  RETURN new_cat;
END;
$$ LANGUAGE plpgsql;

-- 7. Rename a category (name and/or emoji)
CREATE OR REPLACE FUNCTION rename_date_category(
  p_category_id UUID,
  p_name TEXT DEFAULT NULL,
  p_emoji TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  updated_cat JSON;
BEGIN
  UPDATE date_categories
  SET
    name = COALESCE(p_name, name),
    emoji = COALESCE(p_emoji, emoji)
  WHERE id = p_category_id
  RETURNING json_build_object(
    'id', id,
    'name', name,
    'emoji', emoji,
    'sort_order', sort_order
  ) INTO updated_cat;

  RETURN updated_cat;
END;
$$ LANGUAGE plpgsql;

-- 8. Remove a category, moving its ideas to another category first
CREATE OR REPLACE FUNCTION remove_date_category(
  p_category_id UUID,
  p_move_to_category_id UUID
)
RETURNS JSON AS $$
DECLARE
  moved_count INTEGER;
BEGIN
  -- Move ideas to target category
  UPDATE date_ideas
  SET category_id = p_move_to_category_id, updated_at = NOW()
  WHERE category_id = p_category_id;

  GET DIAGNOSTICS moved_count = ROW_COUNT;

  -- Delete the category
  DELETE FROM date_categories WHERE id = p_category_id;

  RETURN json_build_object('moved_count', moved_count);
END;
$$ LANGUAGE plpgsql;

-- 9. Get page title
CREATE OR REPLACE FUNCTION get_dates_page_title()
RETURNS TEXT AS $$
BEGIN
  RETURN (SELECT value FROM date_settings WHERE key = 'page_title');
END;
$$ LANGUAGE plpgsql;

-- 10. Set page title
CREATE OR REPLACE FUNCTION set_dates_page_title(p_title TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO date_settings (key, value, updated_at)
  VALUES ('page_title', p_title, NOW())
  ON CONFLICT (key) DO UPDATE SET value = p_title, updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 11. Update get_new_item_counts to track date ideas by added_by
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
    user_answered_today := TRUE;
  END IF;

  IF NOT user_answered_today THEN
    prompts_indicator := 1;
  ELSE
    SELECT COUNT(*)::INTEGER INTO prompts_indicator
    FROM prompt_responses
    WHERE created_at > last_prompts AND player != p_user_name;
  END IF;

  SELECT json_build_object(
    'Quiz Time', (SELECT COUNT(*) FROM quiz_questions WHERE created_at > last_quiz AND author != p_user_name),
    'Date Ideas', (SELECT COUNT(*) FROM date_ideas WHERE created_at > last_dates AND added_by IS NOT NULL AND added_by != p_user_name),
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
