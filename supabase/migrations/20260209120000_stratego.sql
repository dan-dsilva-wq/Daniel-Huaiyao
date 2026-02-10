-- Stratego: Async turn-based strategy game
-- Table + RPC functions + update get_new_item_counts

-- ============================================
-- TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS stratego_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'playing', 'finished')),
  player_red TEXT NOT NULL CHECK (player_red IN ('daniel', 'huaiyao')),
  player_blue TEXT NOT NULL CHECK (player_blue IN ('daniel', 'huaiyao')),
  current_turn TEXT NOT NULL DEFAULT 'red' CHECK (current_turn IN ('red', 'blue')),
  turn_number INTEGER NOT NULL DEFAULT 0,
  red_setup_done BOOLEAN NOT NULL DEFAULT false,
  blue_setup_done BOOLEAN NOT NULL DEFAULT false,
  red_pieces JSONB NOT NULL DEFAULT '[]'::jsonb,
  blue_pieces JSONB NOT NULL DEFAULT '[]'::jsonb,
  red_captured JSONB NOT NULL DEFAULT '[]'::jsonb,
  blue_captured JSONB NOT NULL DEFAULT '[]'::jsonb,
  move_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  winner TEXT CHECK (winner IN ('red', 'blue')),
  win_reason TEXT CHECK (win_reason IN ('flag_captured', 'no_moves', 'resignation')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stratego_games_status ON stratego_games(status);
CREATE INDEX IF NOT EXISTS idx_stratego_games_player_red ON stratego_games(player_red);
CREATE INDEX IF NOT EXISTS idx_stratego_games_player_blue ON stratego_games(player_blue);

-- Enable RLS
ALTER TABLE stratego_games ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read stratego games" ON stratego_games FOR SELECT USING (true);
CREATE POLICY "Allow insert stratego games" ON stratego_games FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update stratego games" ON stratego_games FOR UPDATE USING (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE stratego_games;

-- ============================================
-- 1. create_stratego_game
-- ============================================
CREATE OR REPLACE FUNCTION create_stratego_game(p_creator TEXT)
RETURNS JSON AS $$
DECLARE
  v_red TEXT;
  v_blue TEXT;
  v_game_id UUID;
  v_result JSON;
BEGIN
  -- Randomly assign colors
  IF random() < 0.5 THEN
    v_red := p_creator;
    v_blue := CASE WHEN p_creator = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;
  ELSE
    v_blue := p_creator;
    v_red := CASE WHEN p_creator = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;
  END IF;

  INSERT INTO stratego_games (player_red, player_blue)
  VALUES (v_red, v_blue)
  RETURNING id INTO v_game_id;

  SELECT json_build_object(
    'id', v_game_id,
    'player_red', v_red,
    'player_blue', v_blue
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 2. get_stratego_state — hides opponent ranks
-- ============================================
CREATE OR REPLACE FUNCTION get_stratego_state(p_game_id UUID, p_user TEXT)
RETURNS JSON AS $$
DECLARE
  v_game stratego_games%ROWTYPE;
  v_my_color TEXT;
  v_my_pieces JSONB;
  v_opp_pieces JSONB;
  v_opp_piece JSONB;
  v_hidden_opp JSONB := '[]'::jsonb;
  v_result JSON;
BEGIN
  SELECT * INTO v_game FROM stratego_games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Game not found');
  END IF;

  -- Determine which color the user is
  IF v_game.player_red = p_user THEN
    v_my_color := 'red';
    v_my_pieces := v_game.red_pieces;
    v_opp_pieces := v_game.blue_pieces;
  ELSIF v_game.player_blue = p_user THEN
    v_my_color := 'blue';
    v_my_pieces := v_game.blue_pieces;
    v_opp_pieces := v_game.red_pieces;
  ELSE
    RETURN json_build_object('error', 'User not in this game');
  END IF;

  -- Hide opponent piece ranks unless revealed OR game is finished
  IF v_game.status = 'finished' THEN
    v_hidden_opp := v_opp_pieces;
  ELSE
    FOR v_opp_piece IN SELECT * FROM jsonb_array_elements(v_opp_pieces)
    LOOP
      IF (v_opp_piece->>'revealed')::boolean = true THEN
        v_hidden_opp := v_hidden_opp || jsonb_build_array(v_opp_piece);
      ELSE
        v_hidden_opp := v_hidden_opp || jsonb_build_array(
          jsonb_build_object(
            'id', v_opp_piece->>'id',
            'rank', -1,
            'row', (v_opp_piece->>'row')::int,
            'col', (v_opp_piece->>'col')::int,
            'revealed', false
          )
        );
      END IF;
    END LOOP;
  END IF;

  SELECT json_build_object(
    'id', v_game.id,
    'status', v_game.status,
    'player_red', v_game.player_red,
    'player_blue', v_game.player_blue,
    'my_color', v_my_color,
    'current_turn', v_game.current_turn,
    'turn_number', v_game.turn_number,
    'red_setup_done', v_game.red_setup_done,
    'blue_setup_done', v_game.blue_setup_done,
    'my_pieces', v_my_pieces,
    'opponent_pieces', v_hidden_opp,
    'red_captured', v_game.red_captured,
    'blue_captured', v_game.blue_captured,
    'move_history', v_game.move_history,
    'winner', v_game.winner,
    'win_reason', v_game.win_reason,
    'created_at', v_game.created_at,
    'updated_at', v_game.updated_at
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. submit_stratego_setup
-- ============================================
CREATE OR REPLACE FUNCTION submit_stratego_setup(p_game_id UUID, p_user TEXT, p_pieces JSONB)
RETURNS JSON AS $$
DECLARE
  v_game stratego_games%ROWTYPE;
  v_my_color TEXT;
  v_piece JSONB;
  v_piece_row INT;
  v_min_row INT;
  v_max_row INT;
  v_rank_counts JSONB := '{}'::jsonb;
  v_rank TEXT;
  v_count INT;
  -- Expected piece counts: rank -> count
  v_expected JSONB := '{
    "0": 1, "1": 1, "2": 8, "3": 5, "4": 4,
    "5": 4, "6": 4, "7": 3, "8": 2, "9": 1, "10": 1, "11": 6
  }'::jsonb;
BEGIN
  SELECT * INTO v_game FROM stratego_games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Game not found');
  END IF;

  IF v_game.status != 'setup' THEN
    RETURN json_build_object('error', 'Game not in setup phase');
  END IF;

  -- Determine color
  IF v_game.player_red = p_user THEN
    v_my_color := 'red';
  ELSIF v_game.player_blue = p_user THEN
    v_my_color := 'blue';
  ELSE
    RETURN json_build_object('error', 'User not in this game');
  END IF;

  -- Validate 40 pieces
  IF jsonb_array_length(p_pieces) != 40 THEN
    RETURN json_build_object('error', 'Must have exactly 40 pieces');
  END IF;

  -- Red places in rows 6-9, Blue places in rows 0-3 (from red perspective)
  IF v_my_color = 'red' THEN
    v_min_row := 6; v_max_row := 9;
  ELSE
    v_min_row := 0; v_max_row := 3;
  END IF;

  -- Validate positions and count ranks
  FOR v_piece IN SELECT * FROM jsonb_array_elements(p_pieces)
  LOOP
    v_piece_row := (v_piece->>'row')::int;
    IF v_piece_row < v_min_row OR v_piece_row > v_max_row THEN
      RETURN json_build_object('error', 'Piece at invalid row: ' || v_piece_row);
    END IF;
    IF (v_piece->>'col')::int < 0 OR (v_piece->>'col')::int > 9 THEN
      RETURN json_build_object('error', 'Piece at invalid column');
    END IF;

    v_rank := v_piece->>'rank';
    v_count := COALESCE((v_rank_counts->>v_rank)::int, 0) + 1;
    v_rank_counts := v_rank_counts || jsonb_build_object(v_rank, v_count);
  END LOOP;

  -- Validate rank counts match expected
  FOR v_rank IN SELECT * FROM jsonb_object_keys(v_expected)
  LOOP
    IF COALESCE((v_rank_counts->>v_rank)::int, 0) != (v_expected->>v_rank)::int THEN
      RETURN json_build_object('error', 'Wrong count for rank ' || v_rank ||
        ': expected ' || (v_expected->>v_rank) || ', got ' || COALESCE((v_rank_counts->>v_rank)::text, '0'));
    END IF;
  END LOOP;

  -- Save pieces and mark setup done
  IF v_my_color = 'red' THEN
    UPDATE stratego_games
    SET red_pieces = p_pieces, red_setup_done = true, updated_at = NOW()
    WHERE id = p_game_id;
  ELSE
    UPDATE stratego_games
    SET blue_pieces = p_pieces, blue_setup_done = true, updated_at = NOW()
    WHERE id = p_game_id;
  END IF;

  -- Check if both players are ready
  SELECT * INTO v_game FROM stratego_games WHERE id = p_game_id;
  IF v_game.red_setup_done AND v_game.blue_setup_done THEN
    UPDATE stratego_games
    SET status = 'playing', current_turn = 'red', turn_number = 1, updated_at = NOW()
    WHERE id = p_game_id;
  END IF;

  RETURN json_build_object('success', true, 'both_ready', v_game.red_setup_done AND v_game.blue_setup_done);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. make_stratego_move — full server-side validation + combat
-- ============================================
CREATE OR REPLACE FUNCTION make_stratego_move(
  p_game_id UUID, p_user TEXT, p_piece_id TEXT, p_to_row INT, p_to_col INT
)
RETURNS JSON AS $$
DECLARE
  v_game stratego_games%ROWTYPE;
  v_my_color TEXT;
  v_my_pieces JSONB;
  v_opp_pieces JSONB;
  v_piece JSONB;
  v_piece_idx INT;
  v_from_row INT;
  v_from_col INT;
  v_piece_rank INT;
  v_row_diff INT;
  v_col_diff INT;
  v_defender JSONB;
  v_defender_idx INT;
  v_defender_rank INT;
  v_combat_result TEXT := null;
  v_attacker_wins BOOLEAN;
  v_move_entry JSONB;
  v_new_my_pieces JSONB;
  v_new_opp_pieces JSONB;
  v_my_captured JSONB;
  v_opp_captured JSONB;
  v_game_over BOOLEAN := false;
  v_winner TEXT := null;
  v_win_reason TEXT := null;
  v_next_turn TEXT;
  v_i INT;
  v_scout_step_row INT;
  v_scout_step_col INT;
  v_step_row_dir INT;
  v_step_col_dir INT;
  v_steps INT;
  v_opp_has_moves BOOLEAN;
  v_check_piece JSONB;
  v_check_row INT;
  v_check_col INT;
  v_check_rank INT;
  v_adj_row INT;
  v_adj_col INT;
  v_blocked BOOLEAN;
BEGIN
  SELECT * INTO v_game FROM stratego_games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Game not found');
  END IF;
  IF v_game.status != 'playing' THEN
    RETURN json_build_object('error', 'Game not in playing state');
  END IF;

  -- Determine color
  IF v_game.player_red = p_user THEN
    v_my_color := 'red';
  ELSIF v_game.player_blue = p_user THEN
    v_my_color := 'blue';
  ELSE
    RETURN json_build_object('error', 'User not in this game');
  END IF;

  IF v_game.current_turn != v_my_color THEN
    RETURN json_build_object('error', 'Not your turn');
  END IF;

  -- Get pieces
  IF v_my_color = 'red' THEN
    v_my_pieces := v_game.red_pieces;
    v_opp_pieces := v_game.blue_pieces;
    v_my_captured := v_game.red_captured;
    v_opp_captured := v_game.blue_captured;
  ELSE
    v_my_pieces := v_game.blue_pieces;
    v_opp_pieces := v_game.red_pieces;
    v_my_captured := v_game.blue_captured;
    v_opp_captured := v_game.red_captured;
  END IF;

  -- Find the piece
  v_piece := null;
  FOR v_i IN 0..jsonb_array_length(v_my_pieces)-1 LOOP
    IF (v_my_pieces->v_i->>'id') = p_piece_id THEN
      v_piece := v_my_pieces->v_i;
      v_piece_idx := v_i;
      EXIT;
    END IF;
  END LOOP;

  IF v_piece IS NULL THEN
    RETURN json_build_object('error', 'Piece not found');
  END IF;

  v_from_row := (v_piece->>'row')::int;
  v_from_col := (v_piece->>'col')::int;
  v_piece_rank := (v_piece->>'rank')::int;

  -- Bombs (11) and Flags (0) cannot move
  IF v_piece_rank = 0 OR v_piece_rank = 11 THEN
    RETURN json_build_object('error', 'This piece cannot move');
  END IF;

  -- Validate destination is on the board
  IF p_to_row < 0 OR p_to_row > 9 OR p_to_col < 0 OR p_to_col > 9 THEN
    RETURN json_build_object('error', 'Destination out of bounds');
  END IF;

  -- Check destination is not a lake
  IF (p_to_row = 4 AND p_to_col IN (2,3,6,7)) OR (p_to_row = 5 AND p_to_col IN (2,3,6,7)) THEN
    RETURN json_build_object('error', 'Cannot move into lake');
  END IF;

  -- Check not moving onto own piece
  FOR v_i IN 0..jsonb_array_length(v_my_pieces)-1 LOOP
    IF (v_my_pieces->v_i->>'row')::int = p_to_row AND (v_my_pieces->v_i->>'col')::int = p_to_col THEN
      RETURN json_build_object('error', 'Cannot move onto own piece');
    END IF;
  END LOOP;

  v_row_diff := p_to_row - v_from_row;
  v_col_diff := p_to_col - v_from_col;

  -- Movement validation
  IF v_piece_rank = 2 THEN
    -- Scout: moves any number of squares in a straight line
    IF NOT ((v_row_diff = 0 AND v_col_diff != 0) OR (v_row_diff != 0 AND v_col_diff = 0)) THEN
      RETURN json_build_object('error', 'Scout must move in a straight line');
    END IF;

    -- Check path is clear
    v_steps := GREATEST(ABS(v_row_diff), ABS(v_col_diff));
    v_step_row_dir := SIGN(v_row_diff);
    v_step_col_dir := SIGN(v_col_diff);

    FOR v_i IN 1..v_steps-1 LOOP
      v_scout_step_row := v_from_row + v_i * v_step_row_dir;
      v_scout_step_col := v_from_col + v_i * v_step_col_dir;

      -- Check lake
      IF (v_scout_step_row = 4 AND v_scout_step_col IN (2,3,6,7)) OR
         (v_scout_step_row = 5 AND v_scout_step_col IN (2,3,6,7)) THEN
        RETURN json_build_object('error', 'Path blocked by lake');
      END IF;

      -- Check own pieces in path
      FOR v_i IN 0..jsonb_array_length(v_my_pieces)-1 LOOP
        IF (v_my_pieces->v_i->>'row')::int = v_scout_step_row AND
           (v_my_pieces->v_i->>'col')::int = v_scout_step_col THEN
          RETURN json_build_object('error', 'Path blocked by own piece');
        END IF;
      END LOOP;

      -- Check opponent pieces in path (can only be at destination)
      FOR v_i IN 0..jsonb_array_length(v_opp_pieces)-1 LOOP
        IF (v_opp_pieces->v_i->>'row')::int = v_scout_step_row AND
           (v_opp_pieces->v_i->>'col')::int = v_scout_step_col THEN
          RETURN json_build_object('error', 'Path blocked by opponent piece');
        END IF;
      END LOOP;
    END LOOP;
  ELSE
    -- All other movable pieces: exactly 1 square orthogonally
    IF NOT ((ABS(v_row_diff) = 1 AND v_col_diff = 0) OR (v_row_diff = 0 AND ABS(v_col_diff) = 1)) THEN
      RETURN json_build_object('error', 'Must move exactly one square orthogonally');
    END IF;
  END IF;

  -- Check if destination has opponent piece (combat)
  v_defender := null;
  FOR v_i IN 0..jsonb_array_length(v_opp_pieces)-1 LOOP
    IF (v_opp_pieces->v_i->>'row')::int = p_to_row AND (v_opp_pieces->v_i->>'col')::int = p_to_col THEN
      v_defender := v_opp_pieces->v_i;
      v_defender_idx := v_i;
      EXIT;
    END IF;
  END LOOP;

  v_new_my_pieces := v_my_pieces;
  v_new_opp_pieces := v_opp_pieces;

  IF v_defender IS NOT NULL THEN
    v_defender_rank := (v_defender->>'rank')::int;

    -- Combat resolution
    -- Special cases first
    IF v_defender_rank = 0 THEN
      -- Captured the flag!
      v_combat_result := 'attacker_wins';
      v_game_over := true;
      v_winner := v_my_color;
      v_win_reason := 'flag_captured';
    ELSIF v_piece_rank = 1 AND v_defender_rank = 10 THEN
      -- Spy attacks Marshal: Spy wins
      v_combat_result := 'attacker_wins';
    ELSIF v_defender_rank = 11 THEN
      -- Attacking a bomb
      IF v_piece_rank = 3 THEN
        -- Miner defuses bomb
        v_combat_result := 'attacker_wins';
      ELSE
        -- Bomb destroys attacker
        v_combat_result := 'defender_wins';
      END IF;
    ELSIF v_piece_rank > v_defender_rank THEN
      v_combat_result := 'attacker_wins';
    ELSIF v_piece_rank = v_defender_rank THEN
      v_combat_result := 'both_die';
    ELSE
      v_combat_result := 'defender_wins';
    END IF;

    -- Apply combat result
    IF v_combat_result = 'attacker_wins' THEN
      -- Move attacker to defender's position, mark revealed
      v_new_my_pieces := jsonb_set(v_new_my_pieces, ARRAY[v_piece_idx::text],
        jsonb_build_object(
          'id', v_piece->>'id', 'rank', v_piece_rank,
          'row', p_to_row, 'col', p_to_col, 'revealed', true
        )
      );
      -- Remove defender, add to captured
      v_opp_captured := v_opp_captured || jsonb_build_array(v_defender);
      v_new_opp_pieces := v_new_opp_pieces - v_defender_idx;
    ELSIF v_combat_result = 'defender_wins' THEN
      -- Remove attacker, add to captured. Defender stays, mark revealed
      v_my_captured := v_my_captured || jsonb_build_array(v_piece);
      v_new_my_pieces := v_new_my_pieces - v_piece_idx;
      v_new_opp_pieces := jsonb_set(v_new_opp_pieces, ARRAY[v_defender_idx::text],
        jsonb_build_object(
          'id', v_defender->>'id', 'rank', v_defender_rank,
          'row', (v_defender->>'row')::int, 'col', (v_defender->>'col')::int, 'revealed', true
        )
      );
    ELSIF v_combat_result = 'both_die' THEN
      -- Both removed
      v_my_captured := v_my_captured || jsonb_build_array(v_piece);
      v_opp_captured := v_opp_captured || jsonb_build_array(v_defender);
      -- Remove higher index first to preserve lower index
      IF v_piece_idx > v_defender_idx THEN
        v_new_my_pieces := v_new_my_pieces - v_piece_idx;
      ELSE
        v_new_my_pieces := v_new_my_pieces - v_piece_idx;
      END IF;
      v_new_opp_pieces := v_new_opp_pieces - v_defender_idx;
    END IF;
  ELSE
    -- No combat: just move the piece
    v_new_my_pieces := jsonb_set(v_new_my_pieces, ARRAY[v_piece_idx::text],
      jsonb_build_object(
        'id', v_piece->>'id', 'rank', v_piece_rank,
        'row', p_to_row, 'col', p_to_col,
        'revealed', COALESCE((v_piece->>'revealed')::boolean, false)
      )
    );
  END IF;

  -- Build move history entry
  v_move_entry := jsonb_build_object(
    'turn', v_game.turn_number,
    'color', v_my_color,
    'piece_id', p_piece_id,
    'from_row', v_from_row, 'from_col', v_from_col,
    'to_row', p_to_row, 'to_col', p_to_col,
    'combat_result', v_combat_result,
    'attacker_rank', v_piece_rank,
    'defender_rank', CASE WHEN v_defender IS NOT NULL THEN v_defender_rank ELSE null END
  );

  -- Determine next turn
  v_next_turn := CASE WHEN v_my_color = 'red' THEN 'blue' ELSE 'red' END;

  -- Check if opponent has any movable pieces (no_moves win condition)
  IF NOT v_game_over THEN
    v_opp_has_moves := false;
    FOR v_i IN 0..jsonb_array_length(v_new_opp_pieces)-1 LOOP
      v_check_piece := v_new_opp_pieces->v_i;
      v_check_rank := (v_check_piece->>'rank')::int;
      -- Bombs and flags can't move
      IF v_check_rank = 0 OR v_check_rank = 11 THEN
        CONTINUE;
      END IF;
      v_check_row := (v_check_piece->>'row')::int;
      v_check_col := (v_check_piece->>'col')::int;
      -- Check 4 adjacent squares
      FOR v_adj_row, v_adj_col IN VALUES
        (v_check_row-1, v_check_col), (v_check_row+1, v_check_col),
        (v_check_row, v_check_col-1), (v_check_row, v_check_col+1)
      LOOP
        IF v_adj_row < 0 OR v_adj_row > 9 OR v_adj_col < 0 OR v_adj_col > 9 THEN
          CONTINUE;
        END IF;
        -- Lake check
        IF (v_adj_row = 4 AND v_adj_col IN (2,3,6,7)) OR (v_adj_row = 5 AND v_adj_col IN (2,3,6,7)) THEN
          CONTINUE;
        END IF;
        -- Check if blocked by own piece
        v_blocked := false;
        FOR v_i IN 0..jsonb_array_length(v_new_opp_pieces)-1 LOOP
          IF (v_new_opp_pieces->v_i->>'row')::int = v_adj_row AND
             (v_new_opp_pieces->v_i->>'col')::int = v_adj_col THEN
            v_blocked := true;
            EXIT;
          END IF;
        END LOOP;
        IF NOT v_blocked THEN
          v_opp_has_moves := true;
          EXIT;
        END IF;
      END LOOP;
      IF v_opp_has_moves THEN EXIT; END IF;
    END LOOP;

    IF NOT v_opp_has_moves THEN
      v_game_over := true;
      v_winner := v_my_color;
      v_win_reason := 'no_moves';
    END IF;
  END IF;

  -- Update game state
  IF v_my_color = 'red' THEN
    UPDATE stratego_games SET
      red_pieces = v_new_my_pieces,
      blue_pieces = v_new_opp_pieces,
      red_captured = v_my_captured,
      blue_captured = v_opp_captured,
      current_turn = CASE WHEN v_game_over THEN current_turn ELSE v_next_turn END,
      turn_number = CASE WHEN v_game_over THEN turn_number ELSE turn_number + 1 END,
      move_history = move_history || jsonb_build_array(v_move_entry),
      status = CASE WHEN v_game_over THEN 'finished' ELSE 'playing' END,
      winner = v_winner,
      win_reason = v_win_reason,
      updated_at = NOW()
    WHERE id = p_game_id;
  ELSE
    UPDATE stratego_games SET
      red_pieces = v_new_opp_pieces,
      blue_pieces = v_new_my_pieces,
      red_captured = v_opp_captured,
      blue_captured = v_my_captured,
      current_turn = CASE WHEN v_game_over THEN current_turn ELSE v_next_turn END,
      turn_number = CASE WHEN v_game_over THEN turn_number ELSE turn_number + 1 END,
      move_history = move_history || jsonb_build_array(v_move_entry),
      status = CASE WHEN v_game_over THEN 'finished' ELSE 'playing' END,
      winner = v_winner,
      win_reason = v_win_reason,
      updated_at = NOW()
    WHERE id = p_game_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'combat_result', v_combat_result,
    'attacker_rank', v_piece_rank,
    'defender_rank', CASE WHEN v_defender IS NOT NULL THEN v_defender_rank ELSE null END,
    'game_over', v_game_over,
    'winner', v_winner,
    'win_reason', v_win_reason
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. get_active_stratego_game
-- ============================================
CREATE OR REPLACE FUNCTION get_active_stratego_game(p_user TEXT)
RETURNS JSON AS $$
DECLARE
  v_game_id UUID;
  v_result JSON;
BEGIN
  SELECT id INTO v_game_id
  FROM stratego_games
  WHERE status IN ('setup', 'playing')
    AND (player_red = p_user OR player_blue = p_user)
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_game_id IS NULL THEN
    RETURN json_build_object('game_id', null);
  END IF;

  RETURN json_build_object('game_id', v_game_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. resign_stratego_game
-- ============================================
CREATE OR REPLACE FUNCTION resign_stratego_game(p_game_id UUID, p_user TEXT)
RETURNS JSON AS $$
DECLARE
  v_game stratego_games%ROWTYPE;
  v_my_color TEXT;
  v_winner_color TEXT;
BEGIN
  SELECT * INTO v_game FROM stratego_games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Game not found');
  END IF;
  IF v_game.status = 'finished' THEN
    RETURN json_build_object('error', 'Game already finished');
  END IF;

  IF v_game.player_red = p_user THEN
    v_my_color := 'red';
    v_winner_color := 'blue';
  ELSIF v_game.player_blue = p_user THEN
    v_my_color := 'blue';
    v_winner_color := 'red';
  ELSE
    RETURN json_build_object('error', 'User not in this game');
  END IF;

  UPDATE stratego_games SET
    status = 'finished',
    winner = v_winner_color,
    win_reason = 'resignation',
    updated_at = NOW()
  WHERE id = p_game_id;

  RETURN json_build_object('success', true, 'winner', v_winner_color);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Update get_new_item_counts to include Stratego
-- ============================================
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
  last_stratego TIMESTAMPTZ;
  today_prompt_id UUID;
  user_answered_today BOOLEAN;
  prompts_indicator INTEGER;
  stratego_indicator INTEGER;
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

  SELECT COALESCE(last_viewed_at, '1970-01-01'::TIMESTAMPTZ) INTO last_stratego
  FROM user_app_views WHERE user_name = p_user_name AND app_name = 'stratego';
  last_stratego := COALESCE(last_stratego, '1970-01-01'::TIMESTAMPTZ);

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

  -- Stratego: show indicator if it's the user's turn in any active game
  SELECT COUNT(*)::INTEGER INTO stratego_indicator
  FROM stratego_games
  WHERE status = 'playing'
    AND updated_at > last_stratego
    AND ((player_red = p_user_name AND current_turn = 'red')
      OR (player_blue = p_user_name AND current_turn = 'blue'));

  -- Build result
  SELECT json_build_object(
    'Quiz Time', (SELECT COUNT(*) FROM quiz_questions WHERE created_at > last_quiz AND author != p_user_name),
    'Date Ideas', 0,
    'Memories', (SELECT COUNT(*) FROM memories WHERE created_at > last_memories AND created_by != p_user_name),
    'Gratitude Wall', (SELECT COUNT(*) FROM gratitude_notes WHERE created_at > last_gratitude AND from_player != p_user_name AND to_player = p_user_name),
    'Daily Prompts', prompts_indicator,
    'Our Map', (SELECT COUNT(*) FROM map_places WHERE created_at > last_map AND added_by != p_user_name),
    'Media Tracker', (SELECT COUNT(*) FROM media_items WHERE created_at > last_media AND added_by != p_user_name),
    'Countdown', (SELECT COUNT(*) FROM important_dates WHERE created_at > last_countdown AND created_by != p_user_name),
    'Story Book', (SELECT COUNT(*) FROM book_sentences WHERE created_at > last_book AND writer != p_user_name),
    'Stratego', stratego_indicator
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql;
