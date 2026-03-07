-- Morse Keep: lessons, realtime room, defense runs, team records

CREATE TABLE IF NOT EXISTS morse_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user TEXT NOT NULL CHECK (from_user IN ('daniel', 'huaiyao')),
  room_name TEXT NOT NULL DEFAULT 'morse-room',
  kind TEXT NOT NULL DEFAULT 'room',
  symbols JSONB NOT NULL DEFAULT '[]'::jsonb,
  decoded_text TEXT NOT NULL,
  assist_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS morse_player_progress (
  player TEXT PRIMARY KEY CHECK (player IN ('daniel', 'huaiyao')),
  unlocked_lesson_index INTEGER NOT NULL DEFAULT 0,
  total_transmissions INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  letters_mastered JSONB NOT NULL DEFAULT '[]'::jsonb,
  mastery JSONB NOT NULL DEFAULT '{}'::jsonb,
  recent_mistakes JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS morse_team_progress (
  id TEXT PRIMARY KEY DEFAULT 'main',
  unlocked_campaign_level INTEGER NOT NULL DEFAULT 1,
  endless_unlocked BOOLEAN NOT NULL DEFAULT false,
  meta_currency INTEGER NOT NULL DEFAULT 0,
  unlocked_towers JSONB NOT NULL DEFAULT '["ballista","lantern"]'::jsonb,
  unlocked_powers JSONB NOT NULL DEFAULT '["volley"]'::jsonb,
  permanent_upgrades JSONB NOT NULL DEFAULT '{"towerSlots":2,"startingHealth":0,"revealAssistLevel":1,"powerCapacity":1}'::jsonb,
  records JSONB NOT NULL DEFAULT '{"bestCampaignLevel":0,"bestEndlessWave":0,"bestScore":0,"totalSignals":0,"totalRuns":0,"recentRuns":[]}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS morse_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('campaign', 'endless')),
  host_player TEXT NOT NULL CHECK (host_player IN ('daniel', 'huaiyao')),
  guest_player TEXT CHECK (guest_player IN ('daniel', 'huaiyao')),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed', 'abandoned')),
  level_number INTEGER NOT NULL DEFAULT 1,
  endless_wave INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  currency_earned INTEGER NOT NULL DEFAULT 0,
  checkpoint JSONB,
  final_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

INSERT INTO morse_team_progress (id)
VALUES ('main')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_morse_messages_room_created ON morse_messages(room_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_morse_runs_status_created ON morse_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_morse_runs_host ON morse_runs(host_player);
CREATE INDEX IF NOT EXISTS idx_morse_runs_guest ON morse_runs(guest_player);

ALTER TABLE morse_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE morse_player_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE morse_team_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE morse_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read morse messages" ON morse_messages;
DROP POLICY IF EXISTS "Allow insert morse messages" ON morse_messages;
DROP POLICY IF EXISTS "Allow update morse player progress" ON morse_player_progress;
DROP POLICY IF EXISTS "Allow read morse player progress" ON morse_player_progress;
DROP POLICY IF EXISTS "Allow write morse team progress" ON morse_team_progress;
DROP POLICY IF EXISTS "Allow read morse team progress" ON morse_team_progress;
DROP POLICY IF EXISTS "Allow read morse runs" ON morse_runs;
DROP POLICY IF EXISTS "Allow write morse runs" ON morse_runs;

CREATE POLICY "Allow read morse messages" ON morse_messages FOR SELECT USING (true);
CREATE POLICY "Allow insert morse messages" ON morse_messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update morse player progress" ON morse_player_progress FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow read morse player progress" ON morse_player_progress FOR SELECT USING (true);
CREATE POLICY "Allow write morse team progress" ON morse_team_progress FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow read morse team progress" ON morse_team_progress FOR SELECT USING (true);
CREATE POLICY "Allow read morse runs" ON morse_runs FOR SELECT USING (true);
CREATE POLICY "Allow write morse runs" ON morse_runs FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE morse_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE morse_runs;

CREATE OR REPLACE FUNCTION start_morse_run(
  p_host_player TEXT,
  p_mode TEXT,
  p_level_number INTEGER DEFAULT 1,
  p_expect_partner BOOLEAN DEFAULT false,
  p_checkpoint JSONB DEFAULT NULL
)
RETURNS morse_runs
LANGUAGE plpgsql
AS $$
DECLARE
  v_run morse_runs;
BEGIN
  INSERT INTO morse_runs (mode, host_player, status, level_number, checkpoint, updated_at)
  VALUES (p_mode, p_host_player, CASE WHEN p_expect_partner THEN 'waiting' ELSE 'active' END, p_level_number, p_checkpoint, NOW())
  RETURNING * INTO v_run;

  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION join_morse_run(p_run_id UUID, p_guest_player TEXT)
RETURNS morse_runs
LANGUAGE plpgsql
AS $$
DECLARE
  v_run morse_runs;
BEGIN
  UPDATE morse_runs
  SET guest_player = p_guest_player, status = 'active', updated_at = NOW()
  WHERE id = p_run_id
    AND guest_player IS NULL
    AND host_player != p_guest_player
  RETURNING * INTO v_run;

  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION complete_morse_run(
  p_run_id UUID,
  p_completed_by TEXT,
  p_score INTEGER,
  p_wave INTEGER,
  p_currency_earned INTEGER,
  p_summary JSONB DEFAULT '{}'::jsonb
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_run morse_runs;
  v_records JSONB;
  v_recent JSONB;
  v_new_run JSONB;
  v_best_campaign INTEGER;
  v_best_endless INTEGER;
  v_best_score INTEGER;
  v_total_signals INTEGER;
  v_total_runs INTEGER;
BEGIN
  UPDATE morse_runs
  SET
    status = 'completed',
    score = p_score,
    endless_wave = p_wave,
    currency_earned = p_currency_earned,
    final_summary = p_summary,
    completed_at = NOW(),
    updated_at = NOW(),
    checkpoint = NULL
  WHERE id = p_run_id
  RETURNING * INTO v_run;

  SELECT records INTO v_records FROM morse_team_progress WHERE id = 'main';
  v_new_run := jsonb_build_object(
    'id', v_run.id,
    'mode', v_run.mode,
    'levelNumber', v_run.level_number,
    'wave', p_wave,
    'score', p_score,
    'outcome', COALESCE(p_summary->>'outcome', 'defeat'),
    'completedAt', NOW()
  );

  SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT value
    FROM jsonb_array_elements(jsonb_build_array(v_new_run) || COALESCE(v_records->'recentRuns', '[]'::jsonb))
    LIMIT 8
  ) AS trimmed;

  v_best_campaign := GREATEST(
    COALESCE((v_records->>'bestCampaignLevel')::INTEGER, 0),
    CASE WHEN v_run.mode = 'campaign' AND COALESCE(p_summary->>'outcome', 'defeat') = 'victory' THEN v_run.level_number ELSE 0 END
  );
  v_best_endless := GREATEST(COALESCE((v_records->>'bestEndlessWave')::INTEGER, 0), CASE WHEN v_run.mode = 'endless' THEN p_wave ELSE 0 END);
  v_best_score := GREATEST(COALESCE((v_records->>'bestScore')::INTEGER, 0), p_score);
  v_total_signals := COALESCE((v_records->>'totalSignals')::INTEGER, 0) + COALESCE((p_summary->>'signalsUsed')::INTEGER, 0);
  v_total_runs := COALESCE((v_records->>'totalRuns')::INTEGER, 0) + 1;

  UPDATE morse_team_progress
  SET
    unlocked_campaign_level = GREATEST(
      unlocked_campaign_level,
      CASE WHEN v_run.mode = 'campaign' AND COALESCE(p_summary->>'outcome', 'defeat') = 'victory' THEN LEAST(8, v_run.level_number + 1) ELSE unlocked_campaign_level END
    ),
    endless_unlocked = endless_unlocked OR (v_run.mode = 'campaign' AND v_run.level_number >= 8 AND COALESCE(p_summary->>'outcome', 'defeat') = 'victory'),
    meta_currency = meta_currency + p_currency_earned,
    records = jsonb_build_object(
      'bestCampaignLevel', v_best_campaign,
      'bestEndlessWave', v_best_endless,
      'bestScore', v_best_score,
      'totalSignals', v_total_signals,
      'totalRuns', v_total_runs,
      'recentRuns', v_recent
    ),
    updated_at = NOW()
  WHERE id = 'main';

  RETURN json_build_object(
    'run', row_to_json(v_run),
    'team_progress', (SELECT row_to_json(mtp) FROM morse_team_progress mtp WHERE id = 'main')
  );
END;
$$;

ALTER TABLE achievements DROP CONSTRAINT IF EXISTS achievements_category_check;
ALTER TABLE achievements
  ADD CONSTRAINT achievements_category_check
  CHECK (category IN ('quiz', 'mystery', 'dates', 'gratitude', 'memories', 'media', 'prompts', 'morse', 'general'));

INSERT INTO achievements (code, title, description, emoji, category, points, requirement_count, is_secret)
VALUES
  ('morse_first_signal', 'First Signal', 'Send your first Morse transmission', '📡', 'morse', 10, 1, false),
  ('morse_signaler_25', 'Signal Keeper', 'Send 25 Morse transmissions', '📨', 'morse', 35, 25, false),
  ('morse_castle_clear', 'Wall Defender', 'Clear a Morse Keep campaign run', '🏹', 'morse', 40, 1, false),
  ('morse_flawless_watch', 'Flawless Watch', 'Win a Morse Keep run without losing castle health', '🛡️', 'morse', 60, 1, true),
  ('morse_endless_10', 'Impossible Bells', 'Reach wave 10 in endless Morse Keep', '🔔', 'morse', 75, 10, false)
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION get_team_achievements()
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
        'unlocked', EXISTS (
          SELECT 1 FROM player_achievements pd
          JOIN player_achievements ph ON ph.achievement_id = pd.achievement_id
          WHERE pd.player = 'daniel' AND ph.player = 'huaiyao' AND pd.achievement_id = a.id
        ),
        'unlocked_at', (
          SELECT GREATEST(MAX(pd.unlocked_at), MAX(ph.unlocked_at))
          FROM player_achievements pd
          JOIN player_achievements ph ON ph.achievement_id = pd.achievement_id
          WHERE pd.player = 'daniel' AND ph.player = 'huaiyao' AND pd.achievement_id = a.id
        )
      ) ORDER BY a.category, a.points)
      FROM achievements a
      WHERE a.is_secret = false
         OR EXISTS (
           SELECT 1 FROM player_achievements pd
           JOIN player_achievements ph ON ph.achievement_id = pd.achievement_id
           WHERE pd.player = 'daniel' AND ph.player = 'huaiyao' AND pd.achievement_id = a.id
         )
    ),
    'total_points', COALESCE((
      SELECT SUM(a.points)
      FROM achievements a
      WHERE EXISTS (
        SELECT 1 FROM player_achievements pd
        JOIN player_achievements ph ON ph.achievement_id = pd.achievement_id
        WHERE pd.player = 'daniel' AND ph.player = 'huaiyao' AND pd.achievement_id = a.id
      )
    ), 0),
    'unlocked_count', (
      SELECT COUNT(*)
      FROM achievements a
      WHERE EXISTS (
        SELECT 1 FROM player_achievements pd
        JOIN player_achievements ph ON ph.achievement_id = pd.achievement_id
        WHERE pd.player = 'daniel' AND ph.player = 'huaiyao' AND pd.achievement_id = a.id
      )
    ),
    'total_count', (SELECT COUNT(*) FROM achievements WHERE is_secret = false)
  ) INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION unlock_morse_message_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  message_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO message_count
  FROM morse_messages
  WHERE from_user = NEW.from_user;

  IF message_count >= 1 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT NEW.from_user, id FROM achievements WHERE code = 'morse_first_signal'
    ON CONFLICT DO NOTHING;
  END IF;

  IF message_count >= 25 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT NEW.from_user, id FROM achievements WHERE code = 'morse_signaler_25'
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_unlock_morse_message_achievements ON morse_messages;
CREATE TRIGGER trigger_unlock_morse_message_achievements
AFTER INSERT ON morse_messages
FOR EACH ROW
EXECUTE FUNCTION unlock_morse_message_achievements();

CREATE OR REPLACE FUNCTION unlock_morse_run_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status != 'completed' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.final_summary->>'outcome', 'defeat') = 'victory' THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT NEW.host_player, id FROM achievements WHERE code = 'morse_castle_clear'
    ON CONFLICT DO NOTHING;

    IF NEW.guest_player IS NOT NULL THEN
      INSERT INTO player_achievements (player, achievement_id)
      SELECT NEW.guest_player, id FROM achievements WHERE code = 'morse_castle_clear'
      ON CONFLICT DO NOTHING;
    END IF;

    IF COALESCE((NEW.final_summary->>'castleHealth')::INTEGER, 0) = COALESCE((NEW.final_summary->>'maxCastleHealth')::INTEGER, -1) THEN
      INSERT INTO player_achievements (player, achievement_id)
      SELECT NEW.host_player, id FROM achievements WHERE code = 'morse_flawless_watch'
      ON CONFLICT DO NOTHING;

      IF NEW.guest_player IS NOT NULL THEN
        INSERT INTO player_achievements (player, achievement_id)
        SELECT NEW.guest_player, id FROM achievements WHERE code = 'morse_flawless_watch'
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  IF NEW.mode = 'endless' AND NEW.endless_wave >= 10 THEN
    INSERT INTO player_achievements (player, achievement_id)
    SELECT NEW.host_player, id FROM achievements WHERE code = 'morse_endless_10'
    ON CONFLICT DO NOTHING;

    IF NEW.guest_player IS NOT NULL THEN
      INSERT INTO player_achievements (player, achievement_id)
      SELECT NEW.guest_player, id FROM achievements WHERE code = 'morse_endless_10'
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_unlock_morse_run_achievements ON morse_runs;
CREATE TRIGGER trigger_unlock_morse_run_achievements
AFTER UPDATE ON morse_runs
FOR EACH ROW
EXECUTE FUNCTION unlock_morse_run_achievements();

CREATE OR REPLACE FUNCTION get_new_item_counts(p_user_name TEXT)
RETURNS JSON
LANGUAGE plpgsql
AS $$
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
  last_stratego TIMESTAMPTZ;
  last_morse TIMESTAMPTZ;
  today_prompt_id UUID;
  user_answered_today BOOLEAN;
  prompts_indicator INTEGER;
  stratego_indicator INTEGER;
  morse_indicator INTEGER;
BEGIN
  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_quiz FROM user_app_views WHERE user_name = p_user_name AND app_name = 'quiz';
  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_dates FROM user_app_views WHERE user_name = p_user_name AND app_name = 'dates';
  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_memories FROM user_app_views WHERE user_name = p_user_name AND app_name = 'memories';
  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_gratitude FROM user_app_views WHERE user_name = p_user_name AND app_name = 'gratitude';
  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_prompts FROM user_app_views WHERE user_name = p_user_name AND app_name = 'prompts';
  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_map FROM user_app_views WHERE user_name = p_user_name AND app_name = 'map';
  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_media FROM user_app_views WHERE user_name = p_user_name AND app_name = 'media';
  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_countdown FROM user_app_views WHERE user_name = p_user_name AND app_name = 'countdown';
  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_book FROM user_app_views WHERE user_name = p_user_name AND app_name = 'book';
  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_stratego FROM user_app_views WHERE user_name = p_user_name AND app_name = 'stratego';
  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_morse FROM user_app_views WHERE user_name = p_user_name AND app_name = 'morse';

  SELECT id INTO today_prompt_id FROM daily_prompts WHERE prompt_date = CURRENT_DATE LIMIT 1;
  IF today_prompt_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM prompt_responses WHERE daily_prompt_id = today_prompt_id AND player = p_user_name) INTO user_answered_today;
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

  SELECT COUNT(*)::INTEGER INTO stratego_indicator
  FROM stratego_games
  WHERE status = 'playing'
    AND updated_at > last_stratego
    AND ((player_red = p_user_name AND current_turn = 'red') OR (player_blue = p_user_name AND current_turn = 'blue'));

  SELECT
    COALESCE((SELECT COUNT(*) FROM morse_messages WHERE created_at > last_morse AND from_user != p_user_name), 0)
    + COALESCE((SELECT COUNT(*) FROM morse_runs WHERE created_at > last_morse AND host_player != p_user_name AND status = 'waiting'), 0)
  INTO morse_indicator;

  SELECT json_build_object(
    'Quiz Time', (SELECT COUNT(*) FROM quiz_questions WHERE created_at > last_quiz AND author != p_user_name),
    'Date Ideas', (SELECT COUNT(*) FROM date_ideas WHERE created_at > last_dates AND added_by IS NOT NULL AND added_by != p_user_name),
    'Memories', (SELECT COUNT(*) FROM memories WHERE created_at > last_memories AND created_by != p_user_name),
    'Gratitude Wall', (SELECT COUNT(*) FROM gratitude_notes WHERE created_at > last_gratitude AND from_player != p_user_name AND to_player = p_user_name),
    'Daily Prompts', prompts_indicator,
    'Our Map', (SELECT COUNT(*) FROM map_places WHERE created_at > last_map AND added_by != p_user_name),
    'Media Tracker', (SELECT COUNT(*) FROM media_items WHERE created_at > last_media AND added_by != p_user_name),
    'Countdown', (SELECT COUNT(*) FROM important_dates WHERE created_at > last_countdown AND created_by != p_user_name),
    'Story Book', (SELECT COUNT(*) FROM book_sentences WHERE created_at > last_book AND writer != p_user_name),
    'Stratego', stratego_indicator,
    'Morse Keep', morse_indicator
  ) INTO result;

  RETURN result;
END;
$$;
