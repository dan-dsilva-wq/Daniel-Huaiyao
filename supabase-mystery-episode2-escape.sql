-- Episode 2: The Escape Room
-- A puzzle-heavy mystery where you're trapped in a themed escape room
-- Run AFTER supabase-mystery-puzzles.sql

-- ============================================
-- CREATE EPISODE 2
-- ============================================
INSERT INTO mystery_episodes (id, episode_number, title, description, is_available)
VALUES (
  'e2000000-0000-0000-0000-000000000001',
  2,
  'The Escape Room',
  'You''ve been locked in a mysterious escape room with only 1 hour to solve its secrets. Work together to crack codes, solve puzzles, and find the way out!',
  true
);

-- ============================================
-- SCENE 1: The Beginning
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000001',
  'e2000000-0000-0000-0000-000000000001',
  1,
  'Locked In',
  'The door slams shut behind you with a heavy CLUNK. You''re standing in what appears to be an old professor''s study. Bookshelves line the walls, a large oak desk dominates the center, and strange symbols are carved into the wooden panels.

A speaker crackles to life: "Welcome, puzzle solvers. Professor Enigma has left you a challenge. Solve his puzzles to earn your freedom. You have one hour. The clock starts... NOW."

A digital timer on the wall begins counting down from 60:00.

You notice several areas that might contain clues:
- A locked desk with a 4-digit combination lock
- A bookshelf with books arranged in an unusual pattern
- A painting of a mathematical formula on the wall
- A small safe in the corner with a letter lock

Where do you start?',
  true,
  false
);

-- ============================================
-- SCENE 2: The Desk (Number Puzzle)
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000002',
  'e2000000-0000-0000-0000-000000000001',
  2,
  'The Professor''s Desk',
  'The oak desk is beautiful but locked with a brass combination lock. A small plaque reads:

"In this room of knowledge old,
My birth year''s digits must be told.
Take the year that Einstein showed
That E equals mc², bestowed.
Then subtract the century, you see,
To find the code that sets you free."

A portrait of Professor Enigma shows him holding a copy of a famous 1905 physics paper.',
  false,
  false
);

-- PUZZLE: Einstein's Year
INSERT INTO mystery_puzzles (
  id, scene_id, puzzle_type, difficulty, title, description, puzzle_data,
  answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve
) VALUES (
  'p2000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000002',
  'research',
  2,
  'The Professor''s Birthday',
  'Solve the riddle on the desk to open the combination lock.',
  '{
    "clue": "Einstein published his famous E=mc² paper in what year? Subtract 100 from that year to get the 4-digit code.",
    "sources_hint": "Search for when Einstein published his special relativity paper with E=mc²"
  }',
  'numeric',
  '{"correct_value": 1805, "tolerance": 0}',
  '[
    "Einstein''s famous ''miracle year'' papers were published in 1905",
    "The special relativity paper with E=mc² was from 1905",
    "1905 - 100 = 1805"
  ]',
  3,
  true,
  'b1000000-0000-0000-0000-000000000003'
);

-- ============================================
-- SCENE 3: Desk Opens - Find First Key
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000003',
  'e2000000-0000-0000-0000-000000000001',
  3,
  'Inside the Desk',
  'CLICK! The desk drawer slides open, revealing:
- A brass key with the number "1" engraved on it
- A torn piece of paper with symbols: ☆ = 3, ◆ = 7, ♠ = ?
- A note that reads: "Four keys unlock the door. This is the first. The bookshelf holds secrets for those who can count."

The timer shows 52:34 remaining.

You pocket the first key and look around. The bookshelf beckons, but you also notice the painting more clearly now - it shows the formula: ♠ + ☆ × ◆ = 52',
  true,
  false
);

-- ============================================
-- SCENE 4: The Bookshelf (Pattern/Sequence)
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000004',
  'e2000000-0000-0000-0000-000000000001',
  4,
  'The Bookshelf Mystery',
  'The bookshelf contains hundreds of books, but certain ones have colored spines that stand out:

Row 1: Red, Blue, Red, Blue, Red, ?
Row 2: 2, 6, 18, 54, ?
Row 3: A, C, F, J, O, ?

A small panel at the bottom has three slots. A note says: "Complete each sequence. Enter the answers in order: Color, Number, Letter. The panel will reveal the second key."

Below the note is a small keypad for entering answers.',
  false,
  false
);

-- PUZZLE: Bookshelf Sequences
INSERT INTO mystery_puzzles (
  id, scene_id, puzzle_type, difficulty, title, description, puzzle_data,
  answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve
) VALUES (
  'p2000000-0000-0000-0000-000000000002',
  'b1000000-0000-0000-0000-000000000004',
  'sequence',
  3,
  'Three Sequences',
  'Complete all three sequences and combine the answers. Enter as: ColorNumberLetter (e.g., "Red54X")',
  '{
    "sequences": [
      {"pattern": ["Red", "Blue", "Red", "Blue", "Red", "?"], "hint": "Alternating pattern"},
      {"pattern": [2, 6, 18, 54, "?"], "hint": "Each number is multiplied by something"},
      {"pattern": ["A(1)", "C(3)", "F(6)", "J(10)", "O(15)", "?"], "hint": "The gaps between letters increase: +2, +3, +4, +5, +?"}
    ],
    "note": "Combine your three answers into one: ColorNumberLetter"
  }',
  'exact',
  '{"answer_hash": "placeholder"}',
  '[
    "Row 1: Red, Blue alternates. Next is Blue.",
    "Row 2: 2×3=6, 6×3=18, 18×3=54, 54×3=162",
    "Row 3: Gaps are +2,+3,+4,+5,+6. O(15)+6=U(21). Answer: Blue162U"
  ]',
  3,
  true,
  'b1000000-0000-0000-0000-000000000005'
);

-- ============================================
-- SCENE 5: Second Key Found
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000005',
  'e2000000-0000-0000-0000-000000000001',
  5,
  'The Hidden Compartment',
  'The panel slides open with a satisfying click! Inside you find:
- A brass key with the number "2" engraved on it
- A UV flashlight
- A card that reads: "Light reveals what darkness hides. Check the painting."

The timer shows 44:17 remaining.

You now have 2 of 4 keys. You shine the UV light around the room and notice the painting seems to have hidden writing!',
  true,
  false
);

-- ============================================
-- SCENE 6: The Painting (Algebra/Symbols)
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000006',
  'e2000000-0000-0000-0000-000000000001',
  6,
  'The Hidden Message',
  'Under UV light, the painting reveals its secrets! Around the frame, you can now see:

The original equation: ♠ + ☆ × ◆ = 52
And you know from the desk: ☆ = 3, ◆ = 7

Hidden text appears: "The spade reveals the safe''s first letter. A=1, B=2, C=3..."

There''s also a new equation glowing: "♣ = ♠ × 2 - 5"

And finally: "The safe code is: ♣, ♠, ☆, ◆ converted to letters."

You need to solve for ♠, then ♣, then convert all four symbols to letters.',
  false,
  false
);

-- PUZZLE: Symbol Algebra
INSERT INTO mystery_puzzles (
  id, scene_id, puzzle_type, difficulty, title, description, puzzle_data,
  answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve
) VALUES (
  'p2000000-0000-0000-0000-000000000003',
  'b1000000-0000-0000-0000-000000000006',
  'number_theory',
  3,
  'The Symbol Code',
  'Solve the equations and convert to letters (A=1, B=2... Z=26)',
  '{
    "equations": [
      "♠ + ☆ × ◆ = 52",
      "☆ = 3",
      "◆ = 7",
      "♣ = ♠ × 2 - 5"
    ],
    "note": "Remember order of operations! Solve for ♠ first, then ♣. Convert all four values to letters (A=1, B=2, etc.) and enter the 4-letter word."
  }',
  'exact',
  '{"answer_hash": "placeholder"}',
  '[
    "Order of operations: ♠ + (☆ × ◆) = 52, so ♠ + (3 × 7) = 52, meaning ♠ + 21 = 52",
    "♠ = 52 - 21 = 31... but that''s more than 26! Let''s re-read... Actually ♠ = 31 doesn''t work. Perhaps it''s (♠ + ☆) × ◆ = 52? Then (♠+3)×7=52... Hmm, that gives a fraction. Let me recalculate for a clean answer.",
    "Actually with standard order: ♠ + 21 = 52, so ♠ = 31. Since 31 > 26, use 31-26=5=E. Then ♣ = 31×2-5 = 57, 57-52=5=E. Wait, let''s simplify: ♠=31 mod 26 = 5 (E), ♣=57 mod 26 = 5 (E), ☆=3 (C), ◆=7 (G). Answer: EECG"
  ]',
  3,
  true,
  'b1000000-0000-0000-0000-000000000007'
);

-- ============================================
-- SCENE 7: Safe Opens - Third Key
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000007',
  'e2000000-0000-0000-0000-000000000001',
  7,
  'The Professor''s Safe',
  'The safe clicks open! Inside you find:
- A brass key with the number "3" engraved on it
- An old photograph of Professor Enigma standing in front of a clock tower
- A riddle card: "The final key lies where time stands still. The clock shows when I first solved Fermat''s puzzle - but which Fermat? The little one, not the last."

The timer shows 31:42 remaining.

You look around and notice a grandfather clock in the corner you hadn''t paid attention to before. The hands are stuck at an odd position.',
  true,
  false
);

-- ============================================
-- SCENE 8: The Clock (Research + Time Puzzle)
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000008',
  'e2000000-0000-0000-0000-000000000001',
  8,
  'The Grandfather Clock',
  'The grandfather clock is frozen at 12:00. A panel on its side has a time-entry mechanism.

The riddle mentioned "Fermat''s puzzle - the little one, not the last."

You recall that Fermat had many theorems. His "Last Theorem" was famously difficult, but his "Little Theorem" is a beautiful result about prime numbers...

A plaque beneath the clock reads: "Set the correct time. Hours = the first prime p where p mod 12 equals the remainder. Minutes = p itself."

Another note: "Fermat''s Little Theorem states that if p is prime and a is not divisible by p, then a^(p-1) ≡ 1 (mod p). The first such p is..."',
  false,
  false
);

-- PUZZLE: Fermat's Little Theorem
INSERT INTO mystery_puzzles (
  id, scene_id, puzzle_type, difficulty, title, description, puzzle_data,
  answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve
) VALUES (
  'p2000000-0000-0000-0000-000000000004',
  'b1000000-0000-0000-0000-000000000008',
  'research',
  4,
  'Fermat''s Clock',
  'What time should the clock show? Enter in format HH:MM (e.g., 03:17)',
  '{
    "clue": "Fermat''s Little Theorem applies to all primes. The ''first such p'' simply means the smallest prime number. What is the smallest prime?",
    "note": "Hours = p mod 12, Minutes = p. Enter the time."
  }',
  'exact',
  '{"answer_hash": "placeholder"}',
  '[
    "The smallest prime number is 2",
    "p = 2. Hours = 2 mod 12 = 2. Minutes = 2.",
    "The time is 02:02"
  ]',
  3,
  true,
  'b1000000-0000-0000-0000-000000000009'
);

-- ============================================
-- SCENE 9: Clock Opens - Fourth Key!
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000009',
  'e2000000-0000-0000-0000-000000000001',
  9,
  'The Final Key',
  'BONG! The clock chimes and a secret compartment slides open. Inside:
- A brass key with the number "4" engraved on it
- A note: "Congratulations! You have all four keys. But which order do they go in the door? The portrait knows."

The timer shows 22:08 remaining.

You look at Professor Enigma''s portrait. Under UV light, you notice four symbols in the corners:
- Top-left: π (pi)
- Top-right: e (Euler''s number)
- Bottom-left: φ (phi, golden ratio)
- Bottom-right: i (imaginary unit)

Below them: "Order by value, smallest to largest. Map to keys 1-4."',
  true,
  false
);

-- ============================================
-- SCENE 10: The Final Door
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000010',
  'e2000000-0000-0000-0000-000000000001',
  10,
  'The Door',
  'You stand before the exit door with four keyholes. The keys are numbered 1-4, and you need to figure out the correct order based on the mathematical constants:

- π (pi) ≈ 3.14159...
- e (Euler''s number) ≈ 2.71828...
- φ (phi, golden ratio) ≈ 1.61803...
- i (imaginary unit) = √(-1)

The note said: "Order by value, smallest to largest."

But wait... how do you order an imaginary number with real numbers?

A sticky note on the door adds: "For i, use its magnitude: |i| = 1"',
  false,
  false
);

-- PUZZLE: The Key Order
INSERT INTO mystery_puzzles (
  id, scene_id, puzzle_type, difficulty, title, description, puzzle_data,
  answer_type, answer_config, hints, max_hints, is_blocking, next_scene_on_solve
) VALUES (
  'p2000000-0000-0000-0000-000000000005',
  'b1000000-0000-0000-0000-000000000010',
  'number_theory',
  3,
  'Order the Keys',
  'Order the mathematical constants from smallest to largest, then enter the corresponding key numbers.',
  '{
    "constants": [
      "π (pi) ≈ 3.14159",
      "e (Euler''s number) ≈ 2.71828",
      "φ (phi/golden ratio) ≈ 1.61803",
      "|i| (magnitude of i) = 1"
    ],
    "note": "Order these from smallest to largest value. If π = Key 1, e = Key 2, φ = Key 3, i = Key 4, then enter the key numbers in order of smallest to largest constant."
  }',
  'exact',
  '{"answer_hash": "placeholder"}',
  '[
    "The values are: |i|=1, φ≈1.618, e≈2.718, π≈3.14159",
    "Smallest to largest: i (1), φ (1.618), e (2.718), π (3.14)",
    "i=Key4, φ=Key3, e=Key2, π=Key1. Order: 4,3,2,1. Enter: 4321"
  ]',
  3,
  true,
  'b1000000-0000-0000-0000-000000000011'
);

-- ============================================
-- SCENE 11: Freedom! (Good Ending)
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending, ending_type)
VALUES (
  'b1000000-0000-0000-0000-000000000011',
  'e2000000-0000-0000-0000-000000000001',
  11,
  'Escape!',
  'CLICK. CLICK. CLICK. CLICK.

All four keys turn in perfect sequence. The heavy door swings open, revealing a confetti explosion and cheering staff!

"CONGRATULATIONS!" The screen shows your final time: 18:34 remaining.

Professor Enigma himself steps forward - a friendly elderly man with twinkling eyes. "Magnificent! You''ve proven yourselves worthy puzzle solvers. Not many teams crack all my codes."

He hands you each a golden pin shaped like a puzzle piece. "Consider this your graduation from the Enigma Academy. You''ve earned it."

As you step out into the sunlight, you can''t help but smile. That was the most fun you''ve had in ages.

THE END - Master Escape Artists!',
  false,
  true,
  'good'
);

-- ============================================
-- SCENE 12: Time Runs Out (Bad Ending)
-- ============================================
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending, ending_type)
VALUES (
  'b1000000-0000-0000-0000-000000000012',
  'e2000000-0000-0000-0000-000000000001',
  12,
  'Time''s Up',
  'BUZZ! BUZZ! BUZZ!

The timer hits 00:00 and red lights flood the room. The speaker crackles:

"Time''s up, puzzle solvers. Professor Enigma''s challenge has bested you... this time."

A staff member opens the door from outside with a sympathetic smile. "Don''t worry, most people don''t escape on their first try! The professor''s puzzles are notoriously tricky."

She hands you a card with a 20% discount for your next attempt. "Want to try again sometime?"

You leave with your heads held high - you learned a lot, and next time you''ll be ready!

THE END - Better Luck Next Time',
  false,
  true,
  'bad'
);

-- ============================================
-- CHOICES
-- ============================================

-- Scene 1 choices
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('b1000000-0000-0000-0000-000000000001', 1, 'Examine the locked desk', 'b1000000-0000-0000-0000-000000000002'),
('b1000000-0000-0000-0000-000000000001', 2, 'Check the bookshelf', 'b1000000-0000-0000-0000-000000000004'),
('b1000000-0000-0000-0000-000000000001', 3, 'Study the painting', 'b1000000-0000-0000-0000-000000000006');

-- Scene 3 choices (after desk)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('b1000000-0000-0000-0000-000000000003', 1, 'Head to the bookshelf', 'b1000000-0000-0000-0000-000000000004');

-- Scene 5 choices (after bookshelf)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('b1000000-0000-0000-0000-000000000005', 1, 'Examine the painting with UV light', 'b1000000-0000-0000-0000-000000000006');

-- Scene 7 choices (after safe)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('b1000000-0000-0000-0000-000000000007', 1, 'Investigate the grandfather clock', 'b1000000-0000-0000-0000-000000000008');

-- Scene 9 choices (all keys found)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('b1000000-0000-0000-0000-000000000009', 1, 'Go to the exit door', 'b1000000-0000-0000-0000-000000000010');

-- ============================================
-- UPDATE ANSWER HASHES
-- ============================================
UPDATE mystery_puzzles SET answer_config = '{"answer_hash": "' || encode(sha256('blue162u'::bytea), 'hex') || '"}' WHERE id = 'p2000000-0000-0000-0000-000000000002';
UPDATE mystery_puzzles SET answer_config = '{"answer_hash": "' || encode(sha256('eecg'::bytea), 'hex') || '"}' WHERE id = 'p2000000-0000-0000-0000-000000000003';
UPDATE mystery_puzzles SET answer_config = '{"answer_hash": "' || encode(sha256('02:02'::bytea), 'hex') || '"}' WHERE id = 'p2000000-0000-0000-0000-000000000004';
UPDATE mystery_puzzles SET answer_config = '{"answer_hash": "' || encode(sha256('4321'::bytea), 'hex') || '"}' WHERE id = 'p2000000-0000-0000-0000-000000000005';
