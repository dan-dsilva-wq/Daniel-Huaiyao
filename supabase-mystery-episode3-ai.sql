-- Episode 3: AI-Driven Mystery
-- This episode uses GPT to generate story content dynamically
-- Run AFTER supabase-mystery-ALL.sql

-- ============================================
-- STEP 1: ADD AI SUPPORT TO SCHEMA
-- ============================================

-- Add AI flag to episodes
ALTER TABLE mystery_episodes ADD COLUMN IF NOT EXISTS is_ai_driven BOOLEAN DEFAULT FALSE;

-- Table for AI-generated scenes (stored so both players see same content)
CREATE TABLE IF NOT EXISTS mystery_ai_scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES mystery_sessions(id) ON DELETE CASCADE,
  scene_order INTEGER NOT NULL,
  title TEXT,
  narrative_text TEXT NOT NULL,
  is_decision_point BOOLEAN DEFAULT TRUE,
  is_ending BOOLEAN DEFAULT FALSE,
  ending_type TEXT CHECK (ending_type IN ('good', 'neutral', 'bad')),
  -- AI generation metadata
  ai_prompt TEXT, -- The prompt used to generate this
  ai_model TEXT, -- Model used (e.g., gpt-4)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, scene_order)
);

-- Table for AI-generated choices
CREATE TABLE IF NOT EXISTS mystery_ai_choices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_scene_id UUID REFERENCES mystery_ai_scenes(id) ON DELETE CASCADE,
  choice_order INTEGER NOT NULL,
  choice_text TEXT NOT NULL,
  -- For free-form input, this stores what the player typed
  is_custom_input BOOLEAN DEFAULT FALSE,
  custom_input_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for AI-generated puzzles
CREATE TABLE IF NOT EXISTS mystery_ai_puzzles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_scene_id UUID REFERENCES mystery_ai_scenes(id) ON DELETE CASCADE,
  puzzle_type TEXT NOT NULL,
  difficulty INTEGER DEFAULT 2,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  puzzle_data JSONB NOT NULL,
  answer_hash TEXT NOT NULL, -- SHA256 of answer
  hints JSONB DEFAULT '[]'::jsonb,
  max_hints INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Store conversation history for AI context
CREATE TABLE IF NOT EXISTS mystery_ai_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES mystery_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'assistant', 'user')),
  content TEXT NOT NULL,
  scene_order INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Player responses in AI episodes (both can type)
CREATE TABLE IF NOT EXISTS mystery_ai_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES mystery_sessions(id) ON DELETE CASCADE,
  scene_order INTEGER NOT NULL,
  player TEXT NOT NULL CHECK (player IN ('daniel', 'huaiyao')),
  response_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, scene_order, player)
);

-- Add current_ai_scene_order to sessions for AI episodes
ALTER TABLE mystery_sessions ADD COLUMN IF NOT EXISTS current_ai_scene_order INTEGER DEFAULT 1;

-- Enable RLS
ALTER TABLE mystery_ai_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_ai_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_ai_puzzles ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_ai_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_ai_responses ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all for now - private app)
CREATE POLICY "Allow all for mystery_ai_scenes" ON mystery_ai_scenes FOR ALL USING (true);
CREATE POLICY "Allow all for mystery_ai_choices" ON mystery_ai_choices FOR ALL USING (true);
CREATE POLICY "Allow all for mystery_ai_puzzles" ON mystery_ai_puzzles FOR ALL USING (true);
CREATE POLICY "Allow all for mystery_ai_history" ON mystery_ai_history FOR ALL USING (true);
CREATE POLICY "Allow all for mystery_ai_responses" ON mystery_ai_responses FOR ALL USING (true);

-- ============================================
-- STEP 2: CREATE EPISODE 3
-- ============================================

INSERT INTO mystery_episodes (id, episode_number, title, description, is_available, is_ai_driven)
VALUES (
  'e9000000-0000-0000-0000-000000000003',
  3,
  'The Quantum Heist',
  'An AI-driven mystery where YOUR choices shape the story. A priceless quantum computer has been stolen from a high-security lab. Work together to investigate, interrogate suspects, and solve dynamically generated puzzles. Every playthrough is unique!',
  true,
  true
) ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  is_ai_driven = EXCLUDED.is_ai_driven;

-- ============================================
-- STEP 3: RPC FUNCTIONS FOR AI EPISODES
-- ============================================

-- Check if episode is AI-driven
CREATE OR REPLACE FUNCTION is_ai_episode(p_session_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_episode_id UUID;
  v_is_ai BOOLEAN;
BEGIN
  SELECT episode_id INTO v_episode_id FROM mystery_sessions WHERE id = p_session_id;
  SELECT is_ai_driven INTO v_is_ai FROM mystery_episodes WHERE id = v_episode_id;
  RETURN COALESCE(v_is_ai, false);
END;
$$;

-- Get AI game state
CREATE OR REPLACE FUNCTION get_ai_game_state(p_session_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  session_data mystery_sessions;
  episode_data mystery_episodes;
  ai_scene mystery_ai_scenes;
  ai_choices JSON;
  ai_puzzle mystery_ai_puzzles;
  ai_responses JSON;
  history_entries JSON;
BEGIN
  -- Get session
  SELECT * INTO session_data FROM mystery_sessions WHERE id = p_session_id;
  IF session_data IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get episode
  SELECT * INTO episode_data FROM mystery_episodes WHERE id = session_data.episode_id;

  -- Get current AI scene
  SELECT * INTO ai_scene
  FROM mystery_ai_scenes
  WHERE session_id = p_session_id
    AND scene_order = session_data.current_ai_scene_order;

  -- Get choices for current scene
  SELECT json_agg(json_build_object(
    'id', c.id,
    'choice_order', c.choice_order,
    'choice_text', c.choice_text,
    'is_custom_input', c.is_custom_input
  ) ORDER BY c.choice_order)
  INTO ai_choices
  FROM mystery_ai_choices c
  WHERE c.ai_scene_id = ai_scene.id;

  -- Get puzzle for current scene (if any)
  SELECT * INTO ai_puzzle
  FROM mystery_ai_puzzles
  WHERE ai_scene_id = ai_scene.id;

  -- Get responses for current scene
  SELECT json_agg(json_build_object(
    'player', r.player,
    'response_text', r.response_text
  ))
  INTO ai_responses
  FROM mystery_ai_responses r
  WHERE r.session_id = p_session_id
    AND r.scene_order = session_data.current_ai_scene_order;

  -- Get recent history (last 10 entries for context display)
  SELECT json_agg(json_build_object(
    'role', h.role,
    'content', h.content,
    'scene_order', h.scene_order
  ) ORDER BY h.created_at DESC)
  INTO history_entries
  FROM (
    SELECT * FROM mystery_ai_history
    WHERE session_id = p_session_id
    ORDER BY created_at DESC
    LIMIT 10
  ) h;

  RETURN json_build_object(
    'session', json_build_object(
      'id', session_data.id,
      'status', session_data.status,
      'daniel_joined', session_data.daniel_joined,
      'huaiyao_joined', session_data.huaiyao_joined,
      'daniel_last_seen', session_data.daniel_last_seen,
      'huaiyao_last_seen', session_data.huaiyao_last_seen,
      'current_ai_scene_order', session_data.current_ai_scene_order
    ),
    'episode', json_build_object(
      'id', episode_data.id,
      'title', episode_data.title,
      'episode_number', episode_data.episode_number,
      'is_ai_driven', episode_data.is_ai_driven
    ),
    'scene', CASE WHEN ai_scene IS NULL THEN NULL ELSE json_build_object(
      'id', ai_scene.id,
      'scene_order', ai_scene.scene_order,
      'title', ai_scene.title,
      'narrative_text', ai_scene.narrative_text,
      'is_decision_point', ai_scene.is_decision_point,
      'is_ending', ai_scene.is_ending,
      'ending_type', ai_scene.ending_type
    ) END,
    'choices', COALESCE(ai_choices, '[]'::json),
    'puzzle', CASE WHEN ai_puzzle IS NULL THEN NULL ELSE json_build_object(
      'id', ai_puzzle.id,
      'puzzle_type', ai_puzzle.puzzle_type,
      'difficulty', ai_puzzle.difficulty,
      'title', ai_puzzle.title,
      'description', ai_puzzle.description,
      'puzzle_data', ai_puzzle.puzzle_data,
      'hints', ai_puzzle.hints,
      'max_hints', ai_puzzle.max_hints
    ) END,
    'responses', COALESCE(ai_responses, '[]'::json),
    'history', COALESCE(history_entries, '[]'::json),
    'needs_generation', ai_scene IS NULL
  );
END;
$$;

-- Submit player response in AI episode
CREATE OR REPLACE FUNCTION submit_ai_response(
  p_session_id UUID,
  p_player TEXT,
  p_response_text TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  session_data mystery_sessions;
  other_response mystery_ai_responses;
BEGIN
  -- Get session
  SELECT * INTO session_data FROM mystery_sessions WHERE id = p_session_id;

  -- Insert or update response
  INSERT INTO mystery_ai_responses (session_id, scene_order, player, response_text)
  VALUES (p_session_id, session_data.current_ai_scene_order, p_player, p_response_text)
  ON CONFLICT (session_id, scene_order, player)
  DO UPDATE SET response_text = p_response_text, created_at = NOW();

  -- Check if other player has also responded
  SELECT * INTO other_response
  FROM mystery_ai_responses
  WHERE session_id = p_session_id
    AND scene_order = session_data.current_ai_scene_order
    AND player != p_player;

  IF other_response IS NOT NULL THEN
    -- Both have responded - ready for AI to generate next scene
    RETURN json_build_object(
      'submitted', true,
      'both_responded', true,
      'daniel_response', CASE WHEN p_player = 'daniel' THEN p_response_text ELSE other_response.response_text END,
      'huaiyao_response', CASE WHEN p_player = 'huaiyao' THEN p_response_text ELSE other_response.response_text END
    );
  END IF;

  RETURN json_build_object(
    'submitted', true,
    'both_responded', false,
    'waiting_for', CASE WHEN p_player = 'daniel' THEN 'huaiyao' ELSE 'daniel' END
  );
END;
$$;

-- Store AI-generated scene
CREATE OR REPLACE FUNCTION store_ai_scene(
  p_session_id UUID,
  p_scene_order INTEGER,
  p_title TEXT,
  p_narrative_text TEXT,
  p_choices JSONB,
  p_is_ending BOOLEAN DEFAULT FALSE,
  p_ending_type TEXT DEFAULT NULL,
  p_puzzle JSONB DEFAULT NULL,
  p_ai_prompt TEXT DEFAULT NULL,
  p_ai_model TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_scene_id UUID;
  choice_record JSONB;
  v_puzzle_id UUID;
BEGIN
  -- Insert the scene
  INSERT INTO mystery_ai_scenes (
    session_id, scene_order, title, narrative_text,
    is_decision_point, is_ending, ending_type, ai_prompt, ai_model
  )
  VALUES (
    p_session_id, p_scene_order, p_title, p_narrative_text,
    TRUE, p_is_ending, p_ending_type, p_ai_prompt, p_ai_model
  )
  ON CONFLICT (session_id, scene_order) DO UPDATE SET
    title = EXCLUDED.title,
    narrative_text = EXCLUDED.narrative_text,
    is_ending = EXCLUDED.is_ending,
    ending_type = EXCLUDED.ending_type
  RETURNING id INTO v_scene_id;

  -- Delete old choices
  DELETE FROM mystery_ai_choices WHERE ai_scene_id = v_scene_id;

  -- Insert new choices
  FOR choice_record IN SELECT * FROM jsonb_array_elements(p_choices)
  LOOP
    INSERT INTO mystery_ai_choices (ai_scene_id, choice_order, choice_text, is_custom_input)
    VALUES (
      v_scene_id,
      (choice_record->>'choice_order')::INTEGER,
      choice_record->>'choice_text',
      COALESCE((choice_record->>'is_custom_input')::BOOLEAN, FALSE)
    );
  END LOOP;

  -- Insert puzzle if provided
  IF p_puzzle IS NOT NULL THEN
    DELETE FROM mystery_ai_puzzles WHERE ai_scene_id = v_scene_id;

    INSERT INTO mystery_ai_puzzles (
      ai_scene_id, puzzle_type, difficulty, title, description,
      puzzle_data, answer_hash, hints, max_hints
    )
    VALUES (
      v_scene_id,
      p_puzzle->>'puzzle_type',
      COALESCE((p_puzzle->>'difficulty')::INTEGER, 2),
      p_puzzle->>'title',
      p_puzzle->>'description',
      COALESCE(p_puzzle->'puzzle_data', '{}'::jsonb),
      p_puzzle->>'answer_hash',
      COALESCE(p_puzzle->'hints', '[]'::jsonb),
      COALESCE((p_puzzle->>'max_hints')::INTEGER, 3)
    );
  END IF;

  -- Update session to this scene
  UPDATE mystery_sessions
  SET current_ai_scene_order = p_scene_order
  WHERE id = p_session_id;

  RETURN v_scene_id;
END;
$$;

-- Add history entry
CREATE OR REPLACE FUNCTION add_ai_history(
  p_session_id UUID,
  p_role TEXT,
  p_content TEXT,
  p_scene_order INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO mystery_ai_history (session_id, role, content, scene_order)
  VALUES (p_session_id, p_role, p_content, p_scene_order);
END;
$$;

-- Advance to next AI scene
CREATE OR REPLACE FUNCTION advance_ai_scene(p_session_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current INTEGER;
  v_next INTEGER;
BEGIN
  SELECT current_ai_scene_order INTO v_current FROM mystery_sessions WHERE id = p_session_id;
  v_next := COALESCE(v_current, 0) + 1;

  UPDATE mystery_sessions SET current_ai_scene_order = v_next WHERE id = p_session_id;

  RETURN v_next;
END;
$$;

-- Check AI puzzle answer
CREATE OR REPLACE FUNCTION check_ai_puzzle_answer(
  p_session_id UUID,
  p_puzzle_id UUID,
  p_answer TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_answer_hash TEXT;
  v_submitted_hash TEXT;
BEGIN
  SELECT answer_hash INTO v_answer_hash FROM mystery_ai_puzzles WHERE id = p_puzzle_id;
  v_submitted_hash := encode(sha256(LOWER(TRIM(p_answer))::bytea), 'hex');

  RETURN v_answer_hash = v_submitted_hash;
END;
$$;

-- ============================================
-- STEP 4: INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_ai_scenes_session ON mystery_ai_scenes(session_id, scene_order);
CREATE INDEX IF NOT EXISTS idx_ai_choices_scene ON mystery_ai_choices(ai_scene_id);
CREATE INDEX IF NOT EXISTS idx_ai_puzzles_scene ON mystery_ai_puzzles(ai_scene_id);
CREATE INDEX IF NOT EXISTS idx_ai_history_session ON mystery_ai_history(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_responses_session ON mystery_ai_responses(session_id, scene_order);

-- ============================================
-- STEP 5: UPDATE get_mystery_episodes TO INCLUDE is_ai_driven
-- ============================================

CREATE OR REPLACE FUNCTION get_mystery_episodes()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(
      json_build_object(
        'id', e.id,
        'episode_number', e.episode_number,
        'title', e.title,
        'description', e.description,
        'is_available', e.is_available,
        'is_ai_driven', COALESCE(e.is_ai_driven, false)
      ) ORDER BY e.episode_number
    ), '[]'::json)
    FROM mystery_episodes e
    WHERE e.is_available = true
  );
END;
$$;

-- ============================================
-- VERIFICATION
-- ============================================

SELECT 'Episode 3 Created: ' || title FROM mystery_episodes WHERE episode_number = 3;
SELECT 'AI Tables: ' || COUNT(*)::text || ' tables ready'
FROM information_schema.tables
WHERE table_name LIKE 'mystery_ai_%';
