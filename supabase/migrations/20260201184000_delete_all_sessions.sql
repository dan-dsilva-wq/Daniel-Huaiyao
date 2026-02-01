-- Delete ALL mystery sessions to start fresh
-- This is a one-time cleanup

DELETE FROM mystery_ai_responses;
DELETE FROM mystery_ai_history;
DELETE FROM mystery_ai_puzzles;
DELETE FROM mystery_ai_choices;
DELETE FROM mystery_ai_scenes;
DELETE FROM mystery_votes;
DELETE FROM mystery_puzzle_attempts;
DELETE FROM mystery_puzzle_answers;
DELETE FROM mystery_sessions;
