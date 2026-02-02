-- Add difficulty ratings to mystery episodes
ALTER TABLE mystery_episodes
ADD COLUMN IF NOT EXISTS difficulty INTEGER DEFAULT 2 CHECK (difficulty >= 1 AND difficulty <= 5),
ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS puzzle_count INTEGER DEFAULT 0;

-- Update existing episodes with appropriate values
UPDATE mystery_episodes SET difficulty = 2, estimated_duration_minutes = 30, puzzle_count = 0 WHERE difficulty IS NULL;
