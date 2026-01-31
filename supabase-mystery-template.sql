-- MYSTERY EPISODE TEMPLATE
-- Copy this file and fill in your story
-- Replace all [PLACEHOLDERS] with your content

-- ============================================
-- STEP 1: Create the Episode
-- ============================================
INSERT INTO mystery_episodes (id, episode_number, title, description, is_available)
VALUES (
  'e2000000-0000-0000-0000-000000000001',  -- Change e2 to e3, e4, etc for new episodes
  2,  -- Episode number (increment for each new episode)
  '[YOUR EPISODE TITLE]',
  '[One sentence description for the episode list]',
  true
);

-- ============================================
-- STEP 2: Define Your Scenes
-- ============================================
-- Use this ID pattern: b1000000-0000-0000-0000-00000000000X
-- (Change 'b' to 'c', 'd', etc for each new episode to avoid conflicts)

-- SCENE 1: Introduction (always scene_order = 1)
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000001',
  'e2000000-0000-0000-0000-000000000001',
  1,
  '[SCENE TITLE - optional]',
  '[INTRODUCTION TEXT]

Set the scene. Introduce the mystery. Make players care.

End with something that demands investigation.',
  true,  -- true = show choices after this scene
  false  -- false = not an ending
);

-- SCENE 2: Investigation Branch A
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000002',
  'e2000000-0000-0000-0000-000000000001',
  2,
  '[SCENE TITLE]',
  '[INVESTIGATION CONTENT]

Remember: Do NOT reference other scenes the player might not have visited!
Write as if this could be the first thing they investigate.',
  true,
  false
);

-- SCENE 3: Investigation Branch B
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000003',
  'e2000000-0000-0000-0000-000000000001',
  3,
  '[SCENE TITLE]',
  '[INVESTIGATION CONTENT]',
  true,
  false
);

-- SCENE 4: Investigation Branch C
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000004',
  'e2000000-0000-0000-0000-000000000001',
  4,
  '[SCENE TITLE]',
  '[INVESTIGATION CONTENT]',
  true,
  false
);

-- SCENE 5: Merge Point / Revelation
-- IMPORTANT: This scene must work regardless of which scenes led here!
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'b1000000-0000-0000-0000-000000000005',
  'e2000000-0000-0000-0000-000000000001',
  5,
  '[SCENE TITLE]',
  '[REVELATION OR DECISION POINT]

DO NOT write: "As [character] told you..."
DO write: "You realize that..." or "It becomes clear that..."

This scene could be reached from Scene 2, 3, OR 4.',
  true,
  false
);

-- SCENE 6: Good Ending
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending, ending_type)
VALUES (
  'b1000000-0000-0000-0000-000000000006',
  'e2000000-0000-0000-0000-000000000001',
  6,
  '[ENDING TITLE]',
  '[GOOD ENDING NARRATIVE]

The mystery is solved. Everyone is happy.

THE END',
  false,  -- No choices on endings
  true,   -- This IS an ending
  'good'
);

-- SCENE 7: Neutral Ending
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending, ending_type)
VALUES (
  'b1000000-0000-0000-0000-000000000007',
  'e2000000-0000-0000-0000-000000000001',
  7,
  '[ENDING TITLE]',
  '[NEUTRAL ENDING NARRATIVE]

The mystery is sort of solved, but something is off.

THE END',
  false,
  true,
  'neutral'
);

-- SCENE 8: Bad Ending
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending, ending_type)
VALUES (
  'b1000000-0000-0000-0000-000000000008',
  'e2000000-0000-0000-0000-000000000001',
  8,
  '[ENDING TITLE]',
  '[BAD ENDING NARRATIVE]

Things went wrong. The truth may never be known.

THE END',
  false,
  true,
  'bad'
);

-- ============================================
-- STEP 3: Connect Scenes with Choices
-- ============================================

-- Scene 1 choices (Introduction)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('b1000000-0000-0000-0000-000000000001', 1, '[First investigation option]', 'b1000000-0000-0000-0000-000000000002'),
('b1000000-0000-0000-0000-000000000001', 2, '[Second investigation option]', 'b1000000-0000-0000-0000-000000000003'),
('b1000000-0000-0000-0000-000000000001', 3, '[Third investigation option]', 'b1000000-0000-0000-0000-000000000004');

-- Scene 2 choices (Branch A)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('b1000000-0000-0000-0000-000000000002', 1, '[Continue to revelation]', 'b1000000-0000-0000-0000-000000000005'),
('b1000000-0000-0000-0000-000000000002', 2, '[Investigate branch B instead]', 'b1000000-0000-0000-0000-000000000003');

-- Scene 3 choices (Branch B)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('b1000000-0000-0000-0000-000000000003', 1, '[Continue to revelation]', 'b1000000-0000-0000-0000-000000000005'),
('b1000000-0000-0000-0000-000000000003', 2, '[Investigate branch C instead]', 'b1000000-0000-0000-0000-000000000004');

-- Scene 4 choices (Branch C)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('b1000000-0000-0000-0000-000000000004', 1, '[Continue to revelation]', 'b1000000-0000-0000-0000-000000000005'),
('b1000000-0000-0000-0000-000000000004', 2, '[Go back to branch A]', 'b1000000-0000-0000-0000-000000000002');

-- Scene 5 choices (Revelation/Decision)
-- Each DIFFERENT meaningful choice should lead to a DIFFERENT ending
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('b1000000-0000-0000-0000-000000000005', 1, '[Choice leading to good ending]', 'b1000000-0000-0000-0000-000000000006'),
('b1000000-0000-0000-0000-000000000005', 2, '[Choice leading to neutral ending]', 'b1000000-0000-0000-0000-000000000007'),
('b1000000-0000-0000-0000-000000000005', 3, '[Choice leading to bad ending]', 'b1000000-0000-0000-0000-000000000008');

-- ============================================
-- VERIFICATION CHECKLIST
-- ============================================
-- Run these queries to verify your episode:

-- 1. Check all scenes exist:
-- SELECT scene_order, title, is_decision_point, is_ending FROM mystery_scenes
-- WHERE episode_id = 'e2000000-0000-0000-0000-000000000001' ORDER BY scene_order;

-- 2. Check all decision points have choices:
-- SELECT s.title, COUNT(c.id) as choice_count
-- FROM mystery_scenes s
-- LEFT JOIN mystery_choices c ON s.id = c.scene_id
-- WHERE s.episode_id = 'e2000000-0000-0000-0000-000000000001' AND s.is_decision_point = true
-- GROUP BY s.id, s.title;

-- 3. Check no broken links (choices pointing to non-existent scenes):
-- SELECT c.choice_text, c.next_scene_id
-- FROM mystery_choices c
-- JOIN mystery_scenes s ON c.scene_id = s.id
-- WHERE s.episode_id = 'e2000000-0000-0000-0000-000000000001'
-- AND c.next_scene_id NOT IN (SELECT id FROM mystery_scenes);
