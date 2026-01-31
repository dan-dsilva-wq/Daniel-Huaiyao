-- TEST EPISODE: Quick Puzzle Test
-- A simple episode to verify the puzzle system works
--
-- HOW TO TEST ALONE:
-- 1. Open two browser tabs/windows
-- 2. In tab 1: Select "Daniel"
-- 3. In tab 2: Select "Huaiyao"
-- 4. Both tabs join the same session
-- 5. Submit the same answer in both tabs to solve puzzles
--
-- RUN THIS SQL IN ORDER:
-- 1. First run: supabase-mystery-puzzles.sql (creates tables)
-- 2. Then run: this file (creates test episode)

-- ============================================
-- CREATE TEST EPISODE
-- ============================================
INSERT INTO mystery_episodes (id, episode_number, title, description, is_available)
VALUES (
  'e9000000-0000-0000-0000-000000000001',
  99,
  'Puzzle Test Lab',
  'A quick test episode to verify puzzles work. Contains simple puzzles with known answers.',
  true
);

-- ============================================
-- SCENE 1: Welcome
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'c1000000-0000-0000-0000-000000000001',
  'e9000000-0000-0000-0000-000000000001',
  1,
  'Welcome to the Test Lab',
  'Welcome to the Puzzle Test Lab! This episode contains simple puzzles to verify the system works.

Each puzzle has a known answer listed in the hints (for testing purposes).

Remember: BOTH players must submit the SAME answer to solve a puzzle!

To test alone: Open two browser tabs - one as Daniel, one as Huaiyao.

Let''s start with a simple number puzzle.',
  true,
  false
);

-- ============================================
-- SCENE 2: Number Puzzle Test
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'c1000000-0000-0000-0000-000000000002',
  'e9000000-0000-0000-0000-000000000001',
  2,
  'Number Puzzle',
  'This is a simple number theory puzzle.

The answer should be entered as a number.',
  false,
  false
);

-- PUZZLE: Simple Addition (Answer: 42)
INSERT INTO mystery_puzzles (
  id, scene_id, puzzle_type, difficulty, title, description, puzzle_data,
  answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve
) VALUES (
  'pt000000-0000-0000-0000-000000000001',
  'c1000000-0000-0000-0000-000000000002',
  'number_theory',
  1,
  'The Answer to Everything',
  'What is the answer to life, the universe, and everything?',
  '{
    "equations": ["x = 6 × 7"],
    "note": "If you know the Hitchhiker''s Guide, you know this one!"
  }',
  'numeric',
  '{"correct_value": 42, "tolerance": 0}',
  '[
    "It''s from The Hitchhiker''s Guide to the Galaxy",
    "6 times 7 equals...",
    "The answer is 42"
  ]',
  3,
  true,
  'c1000000-0000-0000-0000-000000000003'
);

-- ============================================
-- SCENE 3: Text Puzzle Test
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'c1000000-0000-0000-0000-000000000003',
  'e9000000-0000-0000-0000-000000000001',
  3,
  'Text Puzzle',
  'Great! The number puzzle worked!

Now let''s test a text-based answer. This uses exact matching (case-insensitive).',
  false,
  false
);

-- PUZZLE: Simple Word (Answer: hello)
INSERT INTO mystery_puzzles (
  id, scene_id, puzzle_type, difficulty, title, description, puzzle_data,
  answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve
) VALUES (
  'pt000000-0000-0000-0000-000000000002',
  'c1000000-0000-0000-0000-000000000003',
  'cryptography',
  1,
  'Simple Cipher',
  'Decode this Caesar cipher (shift -1): IFMMP',
  '{
    "cipher_type": "Caesar Cipher (shift -1)",
    "ciphertext": "IFMMP",
    "context": "Each letter is shifted forward by 1. Shift back to decode: I→H, F→E, etc."
  }',
  'exact',
  '{"answer_hash": "placeholder"}',
  '[
    "Shift each letter back by 1 in the alphabet",
    "I→H, F→E, M→L, M→L, P→O",
    "The answer is: hello"
  ]',
  3,
  true,
  'c1000000-0000-0000-0000-000000000004'
);

-- ============================================
-- SCENE 4: Logic Puzzle Test
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'c1000000-0000-0000-0000-000000000004',
  'e9000000-0000-0000-0000-000000000001',
  4,
  'Logic Puzzle',
  'Excellent! Text matching works!

Now let''s test a logic puzzle.',
  false,
  false
);

-- PUZZLE: Simple Logic (Answer: cat)
INSERT INTO mystery_puzzles (
  id, scene_id, puzzle_type, difficulty, title, description, puzzle_data,
  answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve
) VALUES (
  'pt000000-0000-0000-0000-000000000003',
  'c1000000-0000-0000-0000-000000000004',
  'logic',
  1,
  'Pet Logic',
  'Use logic to figure out the answer.',
  '{
    "rules": [
      "There are three pets: a cat, a dog, and a fish",
      "The cat is not in the tank",
      "The dog is in the yard",
      "One pet is on the mat"
    ],
    "question": "Which pet is on the mat? Enter: cat, dog, or fish"
  }',
  'exact',
  '{"answer_hash": "placeholder"}',
  '[
    "The fish must be in the tank (fish need water!)",
    "The dog is in the yard",
    "That leaves the cat for the mat. Answer: cat"
  ]',
  3,
  true,
  'c1000000-0000-0000-0000-000000000005'
);

-- ============================================
-- SCENE 5: Sequence Test
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'c1000000-0000-0000-0000-000000000005',
  'e9000000-0000-0000-0000-000000000001',
  5,
  'Sequence Puzzle',
  'Logic puzzle complete!

One more test - a sequence puzzle.',
  false,
  false
);

-- PUZZLE: Simple Sequence (Answer: 10)
INSERT INTO mystery_puzzles (
  id, scene_id, puzzle_type, difficulty, title, description, puzzle_data,
  answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve
) VALUES (
  'pt000000-0000-0000-0000-000000000004',
  'c1000000-0000-0000-0000-000000000005',
  'sequence',
  1,
  'Number Sequence',
  'What comes next in the sequence?',
  '{
    "sequence": [2, 4, 6, 8],
    "find": "What is the next number?",
    "note": "A simple pattern of even numbers"
  }',
  'numeric',
  '{"correct_value": 10, "tolerance": 0}',
  '[
    "Look at the pattern: each number increases by 2",
    "2, 4, 6, 8, ...",
    "The answer is 10"
  ]',
  3,
  true,
  'c1000000-0000-0000-0000-000000000006'
);

-- ============================================
-- SCENE 6: Success!
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending, ending_type)
VALUES (
  'c1000000-0000-0000-0000-000000000006',
  'e9000000-0000-0000-0000-000000000001',
  6,
  'All Tests Passed!',
  'Congratulations! All puzzle types are working correctly!

You successfully tested:
✓ Number puzzles (numeric answers)
✓ Text puzzles (exact string matching)
✓ Logic puzzles
✓ Sequence puzzles

The puzzle system is fully operational. Both players had to agree on each answer to progress.

You can now play the real episodes with confidence!',
  false,
  true,
  'good'
);

-- ============================================
-- CHOICES
-- ============================================
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('c1000000-0000-0000-0000-000000000001', 1, 'Start the number puzzle test', 'c1000000-0000-0000-0000-000000000002');

-- ============================================
-- UPDATE ANSWER HASHES
-- ============================================
UPDATE mystery_puzzles SET answer_config = '{"answer_hash": "' || encode(sha256('hello'::bytea), 'hex') || '"}' WHERE id = 'pt000000-0000-0000-0000-000000000002';
UPDATE mystery_puzzles SET answer_config = '{"answer_hash": "' || encode(sha256('cat'::bytea), 'hex') || '"}' WHERE id = 'pt000000-0000-0000-0000-000000000003';
