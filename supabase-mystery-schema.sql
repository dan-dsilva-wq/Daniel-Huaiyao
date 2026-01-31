-- Mystery Files Schema for Daniel & Huaiyao
-- Run this in your Supabase SQL editor

-- Episodes table (story chapters)
CREATE TABLE mystery_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_number INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scenes table (story content)
CREATE TABLE mystery_scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID REFERENCES mystery_episodes(id) ON DELETE CASCADE,
  scene_order INTEGER NOT NULL,
  title TEXT,
  narrative_text TEXT NOT NULL,
  is_decision_point BOOLEAN DEFAULT false,
  is_ending BOOLEAN DEFAULT false,
  ending_type TEXT CHECK (ending_type IN ('good', 'neutral', 'bad')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(episode_id, scene_order)
);

-- Choices table (decision options)
CREATE TABLE mystery_choices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id UUID REFERENCES mystery_scenes(id) ON DELETE CASCADE,
  choice_order INTEGER NOT NULL DEFAULT 0,
  choice_text TEXT NOT NULL,
  next_scene_id UUID REFERENCES mystery_scenes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions table (active games)
CREATE TABLE mystery_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID REFERENCES mystery_episodes(id) ON DELETE CASCADE,
  current_scene_id UUID REFERENCES mystery_scenes(id) ON DELETE SET NULL,
  status TEXT CHECK (status IN ('waiting', 'active', 'completed')) DEFAULT 'waiting',
  daniel_joined BOOLEAN DEFAULT false,
  huaiyao_joined BOOLEAN DEFAULT false,
  daniel_last_seen TIMESTAMPTZ,
  huaiyao_last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Votes table (player votes)
CREATE TABLE mystery_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES mystery_sessions(id) ON DELETE CASCADE,
  scene_id UUID REFERENCES mystery_scenes(id) ON DELETE CASCADE,
  player TEXT CHECK (player IN ('daniel', 'huaiyao')) NOT NULL,
  choice_id UUID REFERENCES mystery_choices(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, scene_id, player)
);

-- Enable RLS
ALTER TABLE mystery_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystery_votes ENABLE ROW LEVEL SECURITY;

-- Policies for public access
CREATE POLICY "Allow public read on mystery_episodes" ON mystery_episodes FOR SELECT USING (true);
CREATE POLICY "Allow public read on mystery_scenes" ON mystery_scenes FOR SELECT USING (true);
CREATE POLICY "Allow public read on mystery_choices" ON mystery_choices FOR SELECT USING (true);
CREATE POLICY "Allow public read on mystery_sessions" ON mystery_sessions FOR SELECT USING (true);
CREATE POLICY "Allow public insert on mystery_sessions" ON mystery_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on mystery_sessions" ON mystery_sessions FOR UPDATE USING (true);
CREATE POLICY "Allow public read on mystery_votes" ON mystery_votes FOR SELECT USING (true);
CREATE POLICY "Allow public insert on mystery_votes" ON mystery_votes FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on mystery_votes" ON mystery_votes FOR UPDATE USING (true);
CREATE POLICY "Allow public delete on mystery_votes" ON mystery_votes FOR DELETE USING (true);

-- Enable realtime for votes and sessions
ALTER PUBLICATION supabase_realtime ADD TABLE mystery_votes;
ALTER PUBLICATION supabase_realtime ADD TABLE mystery_sessions;

-- RPC: Get available episodes
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
        'is_available', e.is_available
      ) ORDER BY e.episode_number
    ), '[]'::json)
    FROM mystery_episodes e
    WHERE e.is_available = true
  );
END;
$$;

-- RPC: Start a new mystery session
CREATE OR REPLACE FUNCTION start_mystery_session(p_episode_id UUID, p_player TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  first_scene_id UUID;
  new_session mystery_sessions;
BEGIN
  -- Get the first scene of the episode
  SELECT id INTO first_scene_id
  FROM mystery_scenes
  WHERE episode_id = p_episode_id
  ORDER BY scene_order ASC
  LIMIT 1;

  IF first_scene_id IS NULL THEN
    RAISE EXCEPTION 'Episode has no scenes';
  END IF;

  -- Create new session
  INSERT INTO mystery_sessions (episode_id, current_scene_id, status, daniel_joined, huaiyao_joined, daniel_last_seen, huaiyao_last_seen)
  VALUES (
    p_episode_id,
    first_scene_id,
    'waiting',
    p_player = 'daniel',
    p_player = 'huaiyao',
    CASE WHEN p_player = 'daniel' THEN NOW() ELSE NULL END,
    CASE WHEN p_player = 'huaiyao' THEN NOW() ELSE NULL END
  )
  RETURNING * INTO new_session;

  RETURN row_to_json(new_session);
END;
$$;

-- RPC: Join an existing mystery session
CREATE OR REPLACE FUNCTION join_mystery_session(p_session_id UUID, p_player TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_session mystery_sessions;
  both_joined BOOLEAN;
BEGIN
  -- Update player presence
  IF p_player = 'daniel' THEN
    UPDATE mystery_sessions
    SET daniel_joined = true, daniel_last_seen = NOW()
    WHERE id = p_session_id
    RETURNING * INTO updated_session;
  ELSE
    UPDATE mystery_sessions
    SET huaiyao_joined = true, huaiyao_last_seen = NOW()
    WHERE id = p_session_id
    RETURNING * INTO updated_session;
  END IF;

  -- Check if both players have joined
  IF updated_session.daniel_joined AND updated_session.huaiyao_joined AND updated_session.status = 'waiting' THEN
    UPDATE mystery_sessions
    SET status = 'active'
    WHERE id = p_session_id
    RETURNING * INTO updated_session;
  END IF;

  RETURN row_to_json(updated_session);
END;
$$;

-- RPC: Update player presence (heartbeat)
CREATE OR REPLACE FUNCTION update_mystery_presence(p_session_id UUID, p_player TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_session mystery_sessions;
BEGIN
  IF p_player = 'daniel' THEN
    UPDATE mystery_sessions
    SET daniel_last_seen = NOW()
    WHERE id = p_session_id
    RETURNING * INTO updated_session;
  ELSE
    UPDATE mystery_sessions
    SET huaiyao_last_seen = NOW()
    WHERE id = p_session_id
    RETURNING * INTO updated_session;
  END IF;

  RETURN row_to_json(updated_session);
END;
$$;

-- RPC: Get current game state
CREATE OR REPLACE FUNCTION get_mystery_game_state(p_session_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  session_data mystery_sessions;
  scene_data JSON;
  choices_data JSON;
  votes_data JSON;
  episode_data JSON;
BEGIN
  -- Get session
  SELECT * INTO session_data FROM mystery_sessions WHERE id = p_session_id;

  IF session_data IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get episode info
  SELECT json_build_object(
    'id', e.id,
    'title', e.title,
    'episode_number', e.episode_number
  ) INTO episode_data
  FROM mystery_episodes e
  WHERE e.id = session_data.episode_id;

  -- Get current scene
  SELECT json_build_object(
    'id', s.id,
    'title', s.title,
    'narrative_text', s.narrative_text,
    'is_decision_point', s.is_decision_point,
    'is_ending', s.is_ending,
    'ending_type', s.ending_type,
    'scene_order', s.scene_order
  ) INTO scene_data
  FROM mystery_scenes s
  WHERE s.id = session_data.current_scene_id;

  -- Get choices for current scene
  SELECT COALESCE(json_agg(
    json_build_object(
      'id', c.id,
      'choice_text', c.choice_text,
      'choice_order', c.choice_order,
      'next_scene_id', c.next_scene_id
    ) ORDER BY c.choice_order
  ), '[]'::json) INTO choices_data
  FROM mystery_choices c
  WHERE c.scene_id = session_data.current_scene_id;

  -- Get votes for current scene
  SELECT COALESCE(json_agg(
    json_build_object(
      'player', v.player,
      'choice_id', v.choice_id
    )
  ), '[]'::json) INTO votes_data
  FROM mystery_votes v
  WHERE v.session_id = p_session_id
    AND v.scene_id = session_data.current_scene_id;

  RETURN json_build_object(
    'session', json_build_object(
      'id', session_data.id,
      'status', session_data.status,
      'daniel_joined', session_data.daniel_joined,
      'huaiyao_joined', session_data.huaiyao_joined,
      'daniel_last_seen', session_data.daniel_last_seen,
      'huaiyao_last_seen', session_data.huaiyao_last_seen,
      'current_scene_id', session_data.current_scene_id,
      'created_at', session_data.created_at,
      'completed_at', session_data.completed_at
    ),
    'episode', episode_data,
    'scene', scene_data,
    'choices', choices_data,
    'votes', votes_data
  );
END;
$$;

-- RPC: Cast a vote and auto-advance if both agree
CREATE OR REPLACE FUNCTION cast_mystery_vote(p_session_id UUID, p_player TEXT, p_choice_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  session_data mystery_sessions;
  current_scene_id UUID;
  other_vote mystery_votes;
  next_scene_id UUID;
  next_scene mystery_scenes;
  result JSON;
BEGIN
  -- Get current session and scene
  SELECT * INTO session_data FROM mystery_sessions WHERE id = p_session_id;
  current_scene_id := session_data.current_scene_id;

  -- Upsert vote
  INSERT INTO mystery_votes (session_id, scene_id, player, choice_id)
  VALUES (p_session_id, current_scene_id, p_player, p_choice_id)
  ON CONFLICT (session_id, scene_id, player)
  DO UPDATE SET choice_id = p_choice_id, created_at = NOW();

  -- Check for the other player's vote
  SELECT * INTO other_vote
  FROM mystery_votes
  WHERE session_id = p_session_id
    AND scene_id = current_scene_id
    AND player != p_player;

  -- If other player voted the same choice, advance the story
  IF other_vote IS NOT NULL AND other_vote.choice_id = p_choice_id THEN
    -- Get next scene from the choice
    SELECT c.next_scene_id INTO next_scene_id
    FROM mystery_choices c
    WHERE c.id = p_choice_id;

    IF next_scene_id IS NOT NULL THEN
      -- Get the next scene details
      SELECT * INTO next_scene FROM mystery_scenes WHERE id = next_scene_id;

      -- Update session to next scene
      UPDATE mystery_sessions
      SET current_scene_id = next_scene_id,
          status = CASE WHEN next_scene.is_ending THEN 'completed' ELSE status END,
          completed_at = CASE WHEN next_scene.is_ending THEN NOW() ELSE NULL END
      WHERE id = p_session_id;

      RETURN json_build_object(
        'agreed', true,
        'next_scene_id', next_scene_id,
        'is_ending', next_scene.is_ending
      );
    END IF;
  END IF;

  RETURN json_build_object(
    'agreed', false,
    'voted', true
  );
END;
$$;

-- RPC: Clear votes for current scene (allows re-voting)
CREATE OR REPLACE FUNCTION clear_mystery_votes(p_session_id UUID, p_scene_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM mystery_votes
  WHERE session_id = p_session_id AND scene_id = p_scene_id;
  RETURN true;
END;
$$;
