-- Fix Episode 2 hints - remove answer spoilers
-- The hints should guide thinking, not give answers

-- Puzzle 1: Einstein's Year
UPDATE mystery_puzzles
SET hints = '[
  "Einstein had a famous ''miracle year'' - look up when that was",
  "The riddle says to subtract a century (100 years)",
  "Think about what year relativity was published"
]'::jsonb
WHERE id = 'p2000000-0000-0000-0000-000000000001';

-- Puzzle 2: Three Sequences
UPDATE mystery_puzzles
SET hints = '[
  "Each row follows a different pattern type",
  "For Row 2, look at the relationship between consecutive numbers",
  "For Row 3, count the positions of each letter in the alphabet and find the pattern in the gaps"
]'::jsonb
WHERE id = 'p2000000-0000-0000-0000-000000000002';

-- Puzzle 3: Symbol Algebra
UPDATE mystery_puzzles
SET hints = '[
  "Remember PEMDAS - multiplication comes before addition",
  "Once you find the spade value, you might need to think about how letters cycle",
  "If a number is bigger than 26, consider what happens when counting letters"
]'::jsonb
WHERE id = 'p2000000-0000-0000-0000-000000000003';

-- Puzzle 4: Fermat's Clock
UPDATE mystery_puzzles
SET hints = '[
  "What is the smallest prime number?",
  "The puzzle asks for ''the first such p'' - meaning the first prime",
  "Hours and minutes both use the same prime number"
]'::jsonb
WHERE id = 'p2000000-0000-0000-0000-000000000004';

-- Puzzle 5: Key Order
UPDATE mystery_puzzles
SET hints = '[
  "You need to know the approximate values of famous mathematical constants",
  "The magnitude of i (imaginary unit) is 1",
  "Order the constants by their numerical values, then map to the key numbers"
]'::jsonb
WHERE id = 'p2000000-0000-0000-0000-000000000005';

-- Also fix Test Lab hints if they exist
UPDATE mystery_puzzles
SET hints = '[
  "What is the meaning of life, the universe, and everything?",
  "Think Douglas Adams",
  "The answer is a famous number from a famous book"
]'::jsonb
WHERE id = 'dd000000-0000-0000-0000-000000000001';

UPDATE mystery_puzzles
SET hints = '[
  "This is a simple Caesar cipher",
  "Each letter is shifted by the same amount",
  "Try shifting each letter back a few positions"
]'::jsonb
WHERE id = 'dd000000-0000-0000-0000-000000000002';

UPDATE mystery_puzzles
SET hints = '[
  "Read the logic statements carefully",
  "Only one animal can be the answer",
  "Process of elimination works well here"
]'::jsonb
WHERE id = 'dd000000-0000-0000-0000-000000000003';

UPDATE mystery_puzzles
SET hints = '[
  "Look at the pattern between numbers",
  "How does each number relate to the next?",
  "The sequence has a simple arithmetic rule"
]'::jsonb
WHERE id = 'dd000000-0000-0000-0000-000000000004';

-- Fix interactive puzzle hints too
UPDATE mystery_puzzles
SET hints = '[
  "Start from the green IN node",
  "You can only connect adjacent nodes (up, down, left, right)",
  "Try to find the shortest path"
]'::jsonb
WHERE id = 'dd000000-0000-0000-0000-000000000010';

UPDATE mystery_puzzles
SET hints = '[
  "Watch the pattern carefully before trying",
  "Count how many colors flash in total",
  "Work together - one person can call out colors while the other clicks"
]'::jsonb
WHERE id = 'dd000000-0000-0000-0000-000000000011';

UPDATE mystery_puzzles
SET hints = '[
  "Each wire goes to exactly one terminal",
  "The terminal numbers might not be in order",
  "Try different combinations systematically"
]'::jsonb
WHERE id = 'dd000000-0000-0000-0000-000000000012';

-- Also fix puzzle_data that contains hints/answers

-- Puzzle 2: Remove revealing hints from puzzle_data
UPDATE mystery_puzzles
SET puzzle_data = '{
  "sequences": [
    {"pattern": ["Red", "Blue", "Red", "Blue", "Red", "?"]},
    {"pattern": [2, 6, 18, 54, "?"]},
    {"pattern": ["A", "C", "F", "J", "O", "?"]}
  ],
  "note": "Find what comes next in each sequence. Combine answers as: ColorNumberLetter"
}'::jsonb
WHERE id = 'p2000000-0000-0000-0000-000000000002';

-- Puzzle 3: Simplify note
UPDATE mystery_puzzles
SET puzzle_data = '{
  "equations": [
    "♠ + ☆ × ◆ = 52",
    "☆ = 3",
    "◆ = 7",
    "♣ = ♠ × 2 - 5"
  ],
  "note": "Solve for all symbols, convert to letters (A=1, B=2...), enter the 4-letter code: ♣♠☆◆"
}'::jsonb
WHERE id = 'p2000000-0000-0000-0000-000000000003';

-- Puzzle 4: Remove hints from puzzle_data
UPDATE mystery_puzzles
SET puzzle_data = '{
  "clue": "The riddle mentions Fermat''s Little Theorem. What is the smallest prime number?",
  "note": "Hours = p mod 12, Minutes = p"
}'::jsonb
WHERE id = 'p2000000-0000-0000-0000-000000000004';

-- Puzzle 5: Remove hints from puzzle_data
UPDATE mystery_puzzles
SET puzzle_data = '{
  "constants": [
    "π (pi) - Key 1",
    "e (Euler''s number) - Key 2",
    "φ (phi/golden ratio) - Key 3",
    "i (imaginary unit) - Key 4"
  ],
  "note": "Order the constants by their numerical value (smallest to largest). For i, use its magnitude. Enter the key numbers in that order."
}'::jsonb
WHERE id = 'p2000000-0000-0000-0000-000000000005';

SELECT 'Hints and puzzle data updated - no more spoilers!' as status;
