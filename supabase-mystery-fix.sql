-- Fix Mystery Story: Narrative Consistency
-- Safe to run multiple times (uses upserts)

-- Create or update the "quiet" ending scene
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending, ending_type)
VALUES (
  'a1000000-0000-0000-0000-000000000013',
  'e1000000-0000-0000-0000-000000000001',
  13,
  'A Secret Kept',
  'You carefully slide the photograph back into its frame on the mantelpiece, making sure no one notices. The frame clicks softly as it settles into place.

Returning to the living room, you find the family still searching and speculating. Uncle Marcus is defending himself against suspicious glances. Lily is showing people her phone. The twins look guilty about something.

"Everyone, stop!" Grandma''s voice cuts through the chaos. She''s standing by the mantelpiece, staring at the photo. "It''s... it''s back. The photo is back!"

The room falls silent. Everyone exchanges confused looks.

"I must have... I don''t know how I missed it," Grandma says, touching the frame gently. "Maybe I''m losing my marbles after all."

You catch her eye and give a small, knowing smile. Some mysteries are better left unsolved. The family will never know the truth, but Grandma''s treasured photo is safe, and that''s what matters.

The reunion continues, the mystery forgotten as quickly as it began.

THE END - A Quiet Resolution',
  false,
  true,
  'good'
)
ON CONFLICT (id) DO UPDATE SET
  narrative_text = EXCLUDED.narrative_text,
  title = EXCLUDED.title;

-- Update scene 8 choices to point to correct endings
DELETE FROM mystery_choices WHERE scene_id = 'a1000000-0000-0000-0000-000000000008';

INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('a1000000-0000-0000-0000-000000000008', 1, 'Gather everyone and reveal the truth gently', 'a1000000-0000-0000-0000-000000000009'),
('a1000000-0000-0000-0000-000000000008', 2, 'Quietly return the photo and say nothing', 'a1000000-0000-0000-0000-000000000013');

-- Update scene 2 (Marcus) to not assume prior knowledge
UPDATE mystery_scenes
SET narrative_text = 'You approach Uncle Marcus, who is standing by the window looking uncomfortable.

"Marcus, you seem nervous. Do you know something about the missing photo?"

He sighs heavily. "Look, I didn''t take it. But... I did see something. About an hour ago, I saw Lily near the mantelpiece taking pictures with her phone. She looked like she was in a hurry."

"Why didn''t you say something earlier?"

"I didn''t want to accuse anyone without proof. Family drama, you know?" He shifts his weight. "But there''s something else. I noticed the twins whispering near the back door earlier. They seemed excited about something."

Uncle Marcus pauses. "I hate to say it, but money has been tight for everyone lately. That silver frame alone must be worth a few hundred dollars."'
WHERE id = 'a1000000-0000-0000-0000-000000000002';

-- Update scene 6 (confronting Marcus) to work regardless of path
UPDATE mystery_scenes
SET narrative_text = 'You confront Uncle Marcus with what you''ve discovered - the receipt from Martin''s Antiques.

His face goes pale. "How did you... where did you find that?"

"Hidden by the old oak tree. There was a note mentioning ''M'' - that''s Martin, isn''t it?"

Marcus slumps into a chair. "You don''t understand. I wasn''t going to sell it! I was going to insure it. Grandma doesn''t know, but that photo is incredibly valuable. I was worried about it being damaged or stolen."

"Then why all the secrecy?"

"Because Grandma would never agree to let it leave her sight, even temporarily. I was going to surprise her with insurance paperwork for her birthday. Martin was going to authenticate it first."

"But the photo is missing now."

Marcus looks genuinely alarmed. "I swear I put it back after Martin photographed it yesterday. Someone else must have taken it after me!"'
WHERE id = 'a1000000-0000-0000-0000-000000000006';

-- Update scene 7 (Lily's timeline) to be more generic
UPDATE mystery_scenes
SET narrative_text = 'You decide to pin down the exact timeline. You find Lily and ask her directly.

"Lily, I need to know exactly when you took your photo of the picture."

She thinks carefully. "It was around 2 PM. I remember because I was worried I''d miss Grandma''s pie coming out of the oven at 2:30."

"And when did you notice it was missing?"

"Maybe 2:15? 2:20 at the latest. I went back to double-check my photo was clear, and the original was already gone from the frame."

So the photo disappeared sometime in the early afternoon. But who had access to it during that window?

"One more question," you say. "Did you notice anything else unusual? Anything at all?"

Lily hesitates. "Actually... I saw the twins near Grandma''s bedroom earlier. They were giggling about something."'
WHERE id = 'a1000000-0000-0000-0000-000000000007';

-- Update scene 12 (keep investigating) to be path-agnostic
UPDATE mystery_scenes
SET narrative_text = 'You decide to think more carefully before making any accusations. The evidence points in multiple directions, and everyone seems to have a reasonable explanation.

But something doesn''t add up. Would any of these people really steal from Grandma? They all love her.

You remember detective shows where the obvious suspect is never the culprit. Maybe you''re looking at this all wrong.

Where haven''t you looked yet? Who haven''t you considered?

Then it hits you—you haven''t checked Grandma''s own room. What if she moved it herself for safekeeping during all the commotion of the reunion?'
WHERE id = 'a1000000-0000-0000-0000-000000000012';
