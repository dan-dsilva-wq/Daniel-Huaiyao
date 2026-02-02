-- Add difficulty ratings to mystery episodes
ALTER TABLE mystery_episodes
ADD COLUMN IF NOT EXISTS difficulty INTEGER DEFAULT 2 CHECK (difficulty >= 1 AND difficulty <= 5),
ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS puzzle_count INTEGER DEFAULT 0;

-- Update existing episodes with default values
UPDATE mystery_episodes
SET
  difficulty = COALESCE(difficulty, 2),
  estimated_duration_minutes = COALESCE(estimated_duration_minutes, 30),
  puzzle_count = COALESCE(puzzle_count, 3)
WHERE difficulty IS NULL OR estimated_duration_minutes IS NULL OR puzzle_count IS NULL;
