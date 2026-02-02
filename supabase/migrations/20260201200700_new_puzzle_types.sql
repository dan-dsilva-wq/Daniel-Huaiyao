-- Update puzzle_type constraint to include new types
-- First, we need to drop the existing constraint and recreate it
ALTER TABLE mystery_puzzles DROP CONSTRAINT IF EXISTS mystery_puzzles_puzzle_type_check;

-- Add the new constraint with additional puzzle types
ALTER TABLE mystery_puzzles ADD CONSTRAINT mystery_puzzles_puzzle_type_check
CHECK (puzzle_type IN (
  'cryptography', 'number_theory', 'logic', 'geometry', 'sequence', 'research', 'minigame',
  'word_puzzle', 'visual_puzzle', 'riddle', 'anagram', 'crossword'
));
