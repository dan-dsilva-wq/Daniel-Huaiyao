-- Episode 98: AI Test Lab
-- A test version of the AI-driven system for testing before Episode 3

INSERT INTO mystery_episodes (id, episode_number, title, description, is_available, is_ai_driven)
VALUES (
  'e9000000-0000-0000-0000-000000000098',
  98,
  'AI Test Lab',
  'Test the AI story system before playing Episode 3. A short mystery about a missing pizza. Great for checking that everything works!',
  true,
  true
) ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  is_ai_driven = EXCLUDED.is_ai_driven;
