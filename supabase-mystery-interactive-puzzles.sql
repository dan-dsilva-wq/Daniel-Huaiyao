-- Interactive Mini-Game Puzzles
-- These are visually interactive puzzles that both players solve together
-- Run AFTER supabase-mystery-ALL.sql

-- ============================================
-- ADD INTERACTIVE GAMES TO TEST LAB (Episode 99)
-- ============================================

-- Scene for Circuit Puzzle
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'c1000000-0000-0000-0000-000000000010',
  'e9000000-0000-0000-0000-000000000001',
  10,
  'The Circuit Board',
  'You find an old circuit board that controls the vault door. The power has been disconnected.

You''ll need to reconnect the nodes to restore power from the INPUT to the OUTPUT.

Click on nodes to select them, then click adjacent nodes to create connections. Work together to find the right path!',
  false,
  false
) ON CONFLICT (id) DO NOTHING;

-- Circuit Puzzle
INSERT INTO mystery_puzzles (
  id, scene_id, puzzle_type, difficulty, title, description, puzzle_data,
  answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve
) VALUES (
  'dd000000-0000-0000-0000-000000000010',
  'c1000000-0000-0000-0000-000000000010',
  'minigame',
  2,
  'Power Grid',
  'Connect the green INPUT node to the red OUTPUT node by clicking adjacent nodes to create a path.',
  '{
    "game_type": "circuit",
    "target": ["0-0_0-1", "0-1_1-1", "1-1_1-2", "1-2_2-2", "2-2_3-2", "3-2_3-3"]
  }',
  'exact',
  '{"answer_hash": "placeholder"}'::jsonb,
  '["Start from the green IN node", "You need to connect adjacent nodes", "The path goes: right, down, right, down, down, right"]',
  3,
  true,
  'c1000000-0000-0000-0000-000000000011'
) ON CONFLICT (id) DO NOTHING;

-- Scene for Pattern Sequence
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'c1000000-0000-0000-0000-000000000011',
  'e9000000-0000-0000-0000-000000000001',
  11,
  'The Memory Lock',
  'The vault has a secondary lock - a color sequence pad.

Watch the pattern carefully when it plays, then repeat it by clicking the colored buttons in the correct order.

Both of you can click - coordinate who enters which part of the sequence!',
  false,
  false
) ON CONFLICT (id) DO NOTHING;

-- Pattern Sequence Puzzle
INSERT INTO mystery_puzzles (
  id, scene_id, puzzle_type, difficulty, title, description, puzzle_data,
  answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve
) VALUES (
  'dd000000-0000-0000-0000-000000000011',
  'c1000000-0000-0000-0000-000000000011',
  'minigame',
  2,
  'Color Memory',
  'Watch the color pattern, then repeat it together! Click "Show Pattern" to see the sequence.',
  '{
    "game_type": "pattern_sequence",
    "target_sequence": [0, 2, 1, 3, 0, 1]
  }',
  'exact',
  '{"answer_hash": "placeholder"}'::jsonb,
  '["Red is 0, Blue is 1, Green is 2, Yellow is 3", "The pattern starts with Red, then Green", "Full sequence: Red, Green, Blue, Yellow, Red, Blue"]',
  3,
  true,
  'c1000000-0000-0000-0000-000000000012'
) ON CONFLICT (id) DO NOTHING;

-- Scene for Wire Matching
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'c1000000-0000-0000-0000-000000000012',
  'e9000000-0000-0000-0000-000000000001',
  12,
  'The Wire Panel',
  'Almost there! The final security measure is a wire panel.

Each colored wire must be connected to the correct numbered terminal. Click a wire on the left, then click a terminal on the right to connect them.

Talk to each other - you each might remember different parts of the code!',
  false,
  false
) ON CONFLICT (id) DO NOTHING;

-- Wire Matching Puzzle
INSERT INTO mystery_puzzles (
  id, scene_id, puzzle_type, difficulty, title, description, puzzle_data,
  answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve
) VALUES (
  'dd000000-0000-0000-0000-000000000012',
  'c1000000-0000-0000-0000-000000000012',
  'minigame',
  2,
  'Wire Connection',
  'Connect each colored wire to the correct terminal number. Click a wire, then click a terminal.',
  '{
    "game_type": "wire_matching",
    "target": {"red": 2, "blue": 0, "green": 3, "yellow": 1, "purple": 4}
  }',
  'exact',
  '{"answer_hash": "placeholder"}'::jsonb,
  '["Red goes to terminal 3", "Blue goes to terminal 1, Yellow to terminal 2", "Green→4, Purple→5"]',
  3,
  true,
  'c1000000-0000-0000-0000-000000000013'
) ON CONFLICT (id) DO NOTHING;

-- Final success scene
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending, ending_type)
VALUES (
  'c1000000-0000-0000-0000-000000000013',
  'e9000000-0000-0000-0000-000000000001',
  13,
  'Vault Opened!',
  'CLICK! The vault door swings open with a satisfying mechanical sound.

You''ve successfully tested all the interactive puzzle systems:
✓ Circuit Connection
✓ Pattern Memory
✓ Wire Matching

The collaborative puzzle system is fully operational. Great teamwork!',
  false,
  true,
  'good'
) ON CONFLICT (id) DO NOTHING;

-- Update answer hashes
UPDATE mystery_puzzles SET answer_config = '{"answer_hash": "' || encode(sha256('COMPLETE'::bytea), 'hex') || '"}'::jsonb WHERE id = 'dd000000-0000-0000-0000-000000000010';
UPDATE mystery_puzzles SET answer_config = '{"answer_hash": "' || encode(sha256('CORRECT'::bytea), 'hex') || '"}'::jsonb WHERE id = 'dd000000-0000-0000-0000-000000000011';
UPDATE mystery_puzzles SET answer_config = '{"answer_hash": "' || encode(sha256('CORRECT'::bytea), 'hex') || '"}'::jsonb WHERE id = 'dd000000-0000-0000-0000-000000000012';

-- Add transition from the last regular puzzle (scene 6) to circuit puzzle
-- First, update scene 6's ending to go to the new interactive puzzles
UPDATE mystery_puzzles
SET next_scene_on_solve = 'c1000000-0000-0000-0000-000000000010'
WHERE id = 'dd000000-0000-0000-0000-000000000004';
