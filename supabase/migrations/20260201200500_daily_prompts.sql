-- Prompt categories
CREATE TABLE prompt_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  emoji TEXT DEFAULT '💬',
  description TEXT,
  sort_order INTEGER DEFAULT 0
);

-- Seed prompt categories
INSERT INTO prompt_categories (name, emoji, description, sort_order) VALUES
  ('deep', '🌊', 'Deep and meaningful conversations', 0),
  ('fun', '🎉', 'Lighthearted and fun questions', 1),
  ('future', '🔮', 'Dreams and plans for the future', 2),
  ('memories', '💭', 'Reflecting on the past together', 3),
  ('gratitude', '🙏', 'Appreciating each other', 4),
  ('growth', '🌱', 'Personal growth and challenges', 5)
ON CONFLICT (name) DO NOTHING;

-- Prompts table
CREATE TABLE prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES prompt_categories(id),
  prompt_text TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed some prompts
INSERT INTO prompts (category_id, prompt_text) VALUES
  ((SELECT id FROM prompt_categories WHERE name = 'deep'), 'What''s something you''ve always wanted to tell me but haven''t?'),
  ((SELECT id FROM prompt_categories WHERE name = 'deep'), 'What do you think is our greatest strength as a couple?'),
  ((SELECT id FROM prompt_categories WHERE name = 'deep'), 'When did you first know you were in love with me?'),
  ((SELECT id FROM prompt_categories WHERE name = 'deep'), 'What''s a fear you have about our future?'),
  ((SELECT id FROM prompt_categories WHERE name = 'fun'), 'If we could have any superpower as a couple, what would it be?'),
  ((SELECT id FROM prompt_categories WHERE name = 'fun'), 'What''s the silliest thing we''ve ever done together?'),
  ((SELECT id FROM prompt_categories WHERE name = 'fun'), 'If we were characters in a movie, what genre would it be?'),
  ((SELECT id FROM prompt_categories WHERE name = 'fun'), 'What''s the funniest miscommunication we''ve had?'),
  ((SELECT id FROM prompt_categories WHERE name = 'future'), 'Where do you see us in 5 years?'),
  ((SELECT id FROM prompt_categories WHERE name = 'future'), 'What''s a dream you want us to accomplish together?'),
  ((SELECT id FROM prompt_categories WHERE name = 'future'), 'What tradition do you want us to start?'),
  ((SELECT id FROM prompt_categories WHERE name = 'future'), 'What adventure should we plan next?'),
  ((SELECT id FROM prompt_categories WHERE name = 'memories'), 'What''s your favorite memory of us from this year?'),
  ((SELECT id FROM prompt_categories WHERE name = 'memories'), 'What moment made you fall more in love with me?'),
  ((SELECT id FROM prompt_categories WHERE name = 'memories'), 'What''s a challenge we overcame that made us stronger?'),
  ((SELECT id FROM prompt_categories WHERE name = 'memories'), 'What small moment together do you treasure?'),
  ((SELECT id FROM prompt_categories WHERE name = 'gratitude'), 'What''s something I do that makes you feel loved?'),
  ((SELECT id FROM prompt_categories WHERE name = 'gratitude'), 'What quality of mine are you most grateful for?'),
  ((SELECT id FROM prompt_categories WHERE name = 'gratitude'), 'How have I made your life better?'),
  ((SELECT id FROM prompt_categories WHERE name = 'gratitude'), 'What''s a small thing I do that means a lot to you?'),
  ((SELECT id FROM prompt_categories WHERE name = 'growth'), 'What''s something you want to improve about yourself?'),
  ((SELECT id FROM prompt_categories WHERE name = 'growth'), 'How can I better support you in difficult times?'),
  ((SELECT id FROM prompt_categories WHERE name = 'growth'), 'What''s something new you''d like us to learn together?'),
  ((SELECT id FROM prompt_categories WHERE name = 'growth'), 'What habit would you like us to build as a couple?');

-- Daily prompts (tracks which prompt is shown each day)
CREATE TABLE daily_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id UUID REFERENCES prompts(id) NOT NULL,
  prompt_date DATE NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prompt responses
CREATE TABLE prompt_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_prompt_id UUID REFERENCES daily_prompts(id) ON DELETE CASCADE NOT NULL,
  player TEXT CHECK (player IN ('daniel', 'huaiyao')) NOT NULL,
  response_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(daily_prompt_id, player)
);

-- RPC to get today's prompt (creates one if doesn't exist)
CREATE OR REPLACE FUNCTION get_daily_prompt(p_player TEXT)
RETURNS TABLE (
  daily_prompt_id UUID,
  prompt_id UUID,
  prompt_text TEXT,
  category_name TEXT,
  category_emoji TEXT,
  prompt_date DATE,
  my_response TEXT,
  partner_response TEXT,
  my_response_time TIMESTAMPTZ,
  partner_response_time TIMESTAMPTZ
) AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_daily_prompt_id UUID;
  v_prompt_id UUID;
  v_partner TEXT;
BEGIN
  v_partner := CASE WHEN p_player = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;

  -- Check if daily prompt exists for today
  SELECT dp.id, dp.prompt_id INTO v_daily_prompt_id, v_prompt_id
  FROM daily_prompts dp
  WHERE dp.prompt_date = v_today;

  -- If no daily prompt, create one
  IF NOT FOUND THEN
    -- Pick a random prompt that hasn't been used recently
    SELECT p.id INTO v_prompt_id
    FROM prompts p
    WHERE p.is_active = true
      AND p.id NOT IN (
        SELECT dp.prompt_id FROM daily_prompts dp
        WHERE dp.prompt_date > v_today - 30
      )
    ORDER BY RANDOM()
    LIMIT 1;

    -- If all prompts used recently, just pick random
    IF v_prompt_id IS NULL THEN
      SELECT p.id INTO v_prompt_id
      FROM prompts p
      WHERE p.is_active = true
      ORDER BY RANDOM()
      LIMIT 1;
    END IF;

    -- Create daily prompt
    INSERT INTO daily_prompts (prompt_id, prompt_date)
    VALUES (v_prompt_id, v_today)
    RETURNING id INTO v_daily_prompt_id;
  END IF;

  -- Return prompt with responses
  RETURN QUERY
  SELECT
    dp.id AS daily_prompt_id,
    p.id AS prompt_id,
    p.prompt_text,
    pc.name AS category_name,
    pc.emoji AS category_emoji,
    dp.prompt_date,
    (SELECT pr.response_text FROM prompt_responses pr WHERE pr.daily_prompt_id = dp.id AND pr.player = p_player) AS my_response,
    (SELECT pr.response_text FROM prompt_responses pr WHERE pr.daily_prompt_id = dp.id AND pr.player = v_partner) AS partner_response,
    (SELECT pr.created_at FROM prompt_responses pr WHERE pr.daily_prompt_id = dp.id AND pr.player = p_player) AS my_response_time,
    (SELECT pr.created_at FROM prompt_responses pr WHERE pr.daily_prompt_id = dp.id AND pr.player = v_partner) AS partner_response_time
  FROM daily_prompts dp
  JOIN prompts p ON p.id = dp.prompt_id
  JOIN prompt_categories pc ON pc.id = p.category_id
  WHERE dp.id = v_daily_prompt_id;
END;
$$ LANGUAGE plpgsql;

-- RPC to submit prompt response
CREATE OR REPLACE FUNCTION submit_prompt_response(
  p_daily_prompt_id UUID,
  p_player TEXT,
  p_response_text TEXT
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO prompt_responses (daily_prompt_id, player, response_text)
  VALUES (p_daily_prompt_id, p_player, p_response_text)
  ON CONFLICT (daily_prompt_id, player) DO UPDATE
  SET response_text = p_response_text, created_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- RPC to get prompt history
CREATE OR REPLACE FUNCTION get_prompt_history(p_player TEXT, p_limit INTEGER DEFAULT 30)
RETURNS TABLE (
  daily_prompt_id UUID,
  prompt_text TEXT,
  category_emoji TEXT,
  prompt_date DATE,
  my_response TEXT,
  partner_response TEXT,
  both_answered BOOLEAN
) AS $$
DECLARE
  v_partner TEXT;
BEGIN
  v_partner := CASE WHEN p_player = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;

  RETURN QUERY
  SELECT
    dp.id AS daily_prompt_id,
    p.prompt_text,
    pc.emoji AS category_emoji,
    dp.prompt_date,
    (SELECT pr.response_text FROM prompt_responses pr WHERE pr.daily_prompt_id = dp.id AND pr.player = p_player) AS my_response,
    (SELECT pr.response_text FROM prompt_responses pr WHERE pr.daily_prompt_id = dp.id AND pr.player = v_partner) AS partner_response,
    EXISTS(SELECT 1 FROM prompt_responses pr WHERE pr.daily_prompt_id = dp.id AND pr.player = p_player)
      AND EXISTS(SELECT 1 FROM prompt_responses pr WHERE pr.daily_prompt_id = dp.id AND pr.player = v_partner) AS both_answered
  FROM daily_prompts dp
  JOIN prompts p ON p.id = dp.prompt_id
  JOIN prompt_categories pc ON pc.id = p.category_id
  WHERE dp.prompt_date < CURRENT_DATE
  ORDER BY dp.prompt_date DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE prompt_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to prompt_categories" ON prompt_categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to prompts" ON prompts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to daily_prompts" ON daily_prompts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to prompt_responses" ON prompt_responses FOR ALL USING (true) WITH CHECK (true);
