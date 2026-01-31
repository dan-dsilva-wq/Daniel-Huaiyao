-- Mystery Files Seed Data: "The Missing Photograph"
-- Run this AFTER the schema migration

-- Insert the episode
INSERT INTO mystery_episodes (id, episode_number, title, description, is_available)
VALUES (
  'e1000000-0000-0000-0000-000000000001',
  1,
  'The Missing Photograph',
  'Grandma''s treasured wedding photo has vanished during the family reunion. Can you find it before dinner?',
  true
);

-- Insert all scenes
-- Scene 1: Introduction
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'a1000000-0000-0000-0000-000000000001',
  'e1000000-0000-0000-0000-000000000001',
  1,
  'The Family Reunion',
  'The Johnson family reunion is in full swing at Grandma Eleanor''s countryside home. The smell of her famous apple pie fills the air, and cousins you haven''t seen in years are catching up in the living room.

Suddenly, Grandma''s voice cuts through the chatter: "My wedding photograph! It''s gone!"

Everyone rushes to the mantelpiece where her prized black-and-white photo always sat. The ornate silver frame is still there, but the photograph inside is missing.

"That photo is irreplaceable," Grandma says, her voice trembling. "Your grandfather gave it to me on our 50th anniversary. It''s the only copy."

The room falls silent. Uncle Marcus clears his throat nervously. Cousin Lily looks at her phone. The twins, Jake and Emma, exchange a glance.

Someone in this room knows something.',
  true,
  false
);

-- Scene 2: Question Uncle Marcus
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'a1000000-0000-0000-0000-000000000002',
  'e1000000-0000-0000-0000-000000000001',
  2,
  'Talking to Uncle Marcus',
  'You approach Uncle Marcus, who is standing by the window looking uncomfortable.

"Marcus, you''ve been acting strange since we arrived," you say gently.

He sighs heavily. "Look, I didn''t take the photo. But... I did see something. About an hour ago, I saw Lily near the mantelpiece taking pictures with her phone. She looked like she was in a hurry."

"Why didn''t you say something earlier?"

"I didn''t want to accuse anyone without proof. Family drama, you know?" He shifts his weight. "But there''s something else. I noticed the twins whispering near the back door earlier. They seemed excited about something."

Uncle Marcus pauses. "I hate to say it, but money has been tight for everyone lately. That silver frame alone must be worth a few hundred dollars."',
  true,
  false
);

-- Scene 3: Question Cousin Lily
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'a1000000-0000-0000-0000-000000000003',
  'e1000000-0000-0000-0000-000000000001',
  3,
  'Talking to Cousin Lily',
  'You find Lily in the corner, rapidly typing on her phone.

"Lily, can we talk about what happened?"

She looks up, startled. "I swear I didn''t take it! I was just... I was photographing it."

"Why?"

Her face flushes. "I''m working on a surprise for Grandma''s birthday next month. I wanted to get the photo restored and colorized as a gift. I was going to put it back after I got a good picture of it."

She shows you her phone—sure enough, there''s a clear photo of the wedding picture.

"But when I went back to replace it, the photo was already gone. Someone must have taken it while I stepped away to check if my camera captured it clearly."

"Did you see anyone near the mantelpiece?"

"The twins were playing nearby. And Uncle Marcus kept pacing around looking nervous."',
  true,
  false
);

-- Scene 4: Question the Twins
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'a1000000-0000-0000-0000-000000000004',
  'e1000000-0000-0000-0000-000000000001',
  4,
  'Talking to Jake and Emma',
  'You find the twins, Jake and Emma, huddled together near the back porch.

"Hey, what are you two up to?" you ask casually.

They exchange guilty looks. Emma speaks first: "We weren''t doing anything wrong! We just..."

Jake interrupts: "We found something in the garden. A piece of paper. We didn''t know what to do with it."

He pulls out a folded note from his pocket. It reads: "Meet me by the old oak tree at 3 PM. Bring the package. - M"

"We found this behind the shed," Emma explains. "We thought it was a treasure hunt at first, but then we realized someone dropped it."

"M?" you ask.

"We don''t know who M is. Could be Uncle Marcus? Or maybe someone from town?"

Jake adds, "We also saw Lily acting weird near the fireplace. And Uncle Marcus kept looking out the window like he was expecting someone."',
  true,
  false
);

-- Scene 5: Search the garden
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'a1000000-0000-0000-0000-000000000005',
  'e1000000-0000-0000-0000-000000000001',
  5,
  'The Garden Investigation',
  'You head outside to investigate the garden. The old oak tree stands at the far end of the property, its branches reaching toward the cloudy sky.

As you approach the tree, you notice fresh footprints in the soft earth—two sets, one larger and one smaller. They lead to and from the tree.

Behind the oak, partially hidden by roots, you discover a small metal box. Inside is a collection of old family photos, including some you''ve never seen before. There''s also a receipt from "Martin''s Antique Appraisals" dated yesterday.

"Martin''s..." you murmur. That must be the "M" from the note!

Looking more closely at the receipt, you see: "Wedding photograph - estimated value: $2,500 due to historical significance and excellent condition. Authentication pending."

Someone was getting the photo appraised. But why secretly?',
  true,
  false
);

-- Scene 6: Confront Marcus about the receipt
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'a1000000-0000-0000-0000-000000000006',
  'e1000000-0000-0000-0000-000000000001',
  6,
  'The Truth About Marcus',
  'You confront Uncle Marcus with the receipt from Martin''s Antiques.

His face goes pale. "How did you... where did you find that?"

"The oak tree. The note mentioned ''M'' for a meeting. Martin, right?"

Marcus slumps into a chair. "You don''t understand. I wasn''t going to sell it! I was going to insure it. Grandma doesn''t know, but that photo is incredibly valuable. I was worried about it being damaged or stolen."

"Then why all the secrecy?"

"Because Grandma would never agree to let it leave her sight, even temporarily. I was going to surprise her with insurance paperwork for her birthday. Martin was going to authenticate it first."

"But the photo is missing now."

Marcus looks genuinely alarmed. "I swear I put it back after Martin photographed it. Someone else must have taken it after me!"',
  true,
  false
);

-- Scene 7: Go back to question Lily about the timing
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'a1000000-0000-0000-0000-000000000007',
  'e1000000-0000-0000-0000-000000000001',
  7,
  'Lily''s Timeline',
  'Armed with new information, you return to Lily.

"Lily, I need to know exactly when you took your photo of the picture."

She thinks carefully. "It was around 2 PM. I remember because I was worried I''d miss Grandma''s pie coming out of the oven at 2:30."

"And when you went back to return it?"

"Maybe 2:15? 2:20 at the latest. And it was already gone."

You check your notes. Marcus said he met with Martin at 1 PM and returned the photo by 1:30. So someone took the photo between 1:30 and 2:00—before Lily photographed it—or between 2:00 and 2:15 while Lily was reviewing her shots.

"One more question," you say. "Did you notice anything else unusual? Anything at all?"

Lily hesitates. "Actually... I saw the twins near Grandma''s bedroom earlier. They were giggling about something."',
  true,
  false
);

-- Scene 8: Check Grandma's bedroom
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'a1000000-0000-0000-0000-000000000008',
  'e1000000-0000-0000-0000-000000000001',
  8,
  'Grandma''s Bedroom',
  'You quietly slip into Grandma''s bedroom. It''s neat and cozy, with family photos covering every surface. As you look around, you notice something odd—a corner of paper sticking out from under the pillow.

You carefully pull it out. It''s the missing wedding photograph!

But why would it be here? Did someone hide it, or...

Then you notice a handwritten note on Grandma''s nightstand, in her own handwriting:

"Note to self: Move the photo to a safer place during the reunion. Too many people in the house. Put it under my pillow for now—no one will think to look there. Remember to put it back after everyone leaves!"

The mystery becomes clear. Grandma herself moved the photo for safekeeping and simply forgot to tell anyone—or forgot she did it at all.',
  true,
  false
);

-- Scene 9: Ending - Tell everyone the truth (Good ending)
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending, ending_type)
VALUES (
  'a1000000-0000-0000-0000-000000000009',
  'e1000000-0000-0000-0000-000000000001',
  9,
  'The Family Secret',
  'You gather everyone in the living room and gently reveal the truth. Grandma looks confused at first, then her face lights up with recognition.

"Oh my goodness, I completely forgot! I moved it this morning when everyone started arriving. I was worried about it getting damaged with all the commotion."

The room fills with relieved laughter. Uncle Marcus admits he was trying to get it insured as a surprise. Lily reveals her colorization project. The twins hand over the mysterious note—which turns out to be from Marcus to Martin.

"Well," Grandma says, holding the precious photo close, "I suppose I''m lucky to have a family that cares so much about this old thing. And about me."

As the sun sets on the reunion, the family gathers for a new photo—one that will become just as treasured as the original.

THE END - The Best Outcome',
  false,
  true,
  'good'
);

-- Scene 10: Ending - Accuse Marcus (Neutral ending)
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending, ending_type)
VALUES (
  'a1000000-0000-0000-0000-000000000010',
  'e1000000-0000-0000-0000-000000000001',
  10,
  'A Hasty Accusation',
  'You announce to everyone that Uncle Marcus was secretly having the photo appraised, implying he might have taken it.

Marcus protests loudly, but the damage is done. Grandma looks hurt and confused. The twins feel guilty about the note. Lily defends Marcus, causing an argument.

In the chaos, Grandma quietly slips away to her room. A few minutes later, she returns, holding the photograph.

"I found it under my pillow," she says softly. "I must have put it there myself for safekeeping and forgot."

The room falls silent. Marcus''s face is red with embarrassment and anger. Several family members look at you with disappointment.

"I just wanted to get it insured for you, Mom," Marcus finally says. "As a surprise."

The photo is returned to its place, but the celebration feels hollow now. Some wounds take time to heal.

THE END - Trust Was Broken',
  false,
  true,
  'neutral'
);

-- Scene 11: Ending - Accuse the twins (Bad ending)
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending, ending_type)
VALUES (
  'a1000000-0000-0000-0000-000000000011',
  'e1000000-0000-0000-0000-000000000001',
  11,
  'Innocent Until Proven Guilty',
  'You point at Jake and Emma. "The twins found a suspicious note and were seen near the mantelpiece. They must know something!"

The twins burst into tears. Their parents rush to defend them. What follows is a painful scene of accusations and hurt feelings.

Grandma, distressed by the fighting, retreats to her bedroom. When she goes to lie down, she finds the photograph under her pillow—where she had hidden it herself and forgotten.

She returns to find her family in disarray. The twins are sobbing. Their parents are furious. Uncle Marcus is trying to explain about the insurance. Lily is showing everyone her phone.

"I found it," Grandma says quietly, but nobody hears her over the shouting.

She places the photo back on the mantelpiece and sits in her chair, watching her fractured family with sad eyes. This was supposed to be a joyful reunion.

THE END - The Reunion Ruined',
  false,
  true,
  'bad'
);

-- Scene 12: Keep investigating before accusing
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point, is_ending)
VALUES (
  'a1000000-0000-0000-0000-000000000012',
  'e1000000-0000-0000-0000-000000000001',
  12,
  'More Questions Than Answers',
  'You decide to think more carefully before making any accusations. The evidence points in multiple directions—Marcus with his secret appraisal, Lily with her photos, the twins with their mysterious note.

But something doesn''t add up. Everyone seems to have a reasonable explanation, and all of them genuinely love Grandma. Would any of them really steal from her?

You remember detective shows where the obvious suspect is never the culprit. Maybe you''re looking at this all wrong.

Where haven''t you looked yet? Who haven''t you considered?

Then it hits you—you haven''t checked Grandma''s own room. Maybe she moved it herself for safekeeping during the busy reunion?',
  true,
  false
);

-- Now insert all the choices
-- Scene 1 choices
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('a1000000-0000-0000-0000-000000000001', 1, 'Talk to Uncle Marcus - he''s been acting nervous', 'a1000000-0000-0000-0000-000000000002'),
('a1000000-0000-0000-0000-000000000001', 2, 'Question Cousin Lily - she was on her phone near the photo', 'a1000000-0000-0000-0000-000000000003'),
('a1000000-0000-0000-0000-000000000001', 3, 'Ask the twins what they know - they exchanged a suspicious look', 'a1000000-0000-0000-0000-000000000004');

-- Scene 2 choices (after talking to Marcus)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('a1000000-0000-0000-0000-000000000002', 1, 'Follow up on Lily''s suspicious behavior', 'a1000000-0000-0000-0000-000000000003'),
('a1000000-0000-0000-0000-000000000002', 2, 'Investigate what the twins were doing by the back door', 'a1000000-0000-0000-0000-000000000004'),
('a1000000-0000-0000-0000-000000000002', 3, 'Search the garden for clues', 'a1000000-0000-0000-0000-000000000005');

-- Scene 3 choices (after talking to Lily)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('a1000000-0000-0000-0000-000000000003', 1, 'Question the twins about what they saw', 'a1000000-0000-0000-0000-000000000004'),
('a1000000-0000-0000-0000-000000000003', 2, 'Confront Uncle Marcus about his nervous behavior', 'a1000000-0000-0000-0000-000000000002'),
('a1000000-0000-0000-0000-000000000003', 3, 'Check outside - maybe someone took it out of the house', 'a1000000-0000-0000-0000-000000000005');

-- Scene 4 choices (after talking to twins)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('a1000000-0000-0000-0000-000000000004', 1, 'Investigate the garden and the "old oak tree" mentioned in the note', 'a1000000-0000-0000-0000-000000000005'),
('a1000000-0000-0000-0000-000000000004', 2, 'Confront Uncle Marcus - "M" could be him', 'a1000000-0000-0000-0000-000000000006'),
('a1000000-0000-0000-0000-000000000004', 3, 'Ask Lily more questions about the timeline', 'a1000000-0000-0000-0000-000000000007');

-- Scene 5 choices (after garden investigation)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('a1000000-0000-0000-0000-000000000005', 1, 'Confront Marcus about the antique appraisal receipt', 'a1000000-0000-0000-0000-000000000006'),
('a1000000-0000-0000-0000-000000000005', 2, 'This feels wrong - investigate more carefully before accusing anyone', 'a1000000-0000-0000-0000-000000000012');

-- Scene 6 choices (after confronting Marcus)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('a1000000-0000-0000-0000-000000000006', 1, 'Accuse Marcus of stealing the photo for insurance money', 'a1000000-0000-0000-0000-000000000010'),
('a1000000-0000-0000-0000-000000000006', 2, 'Believe Marcus and look for other suspects', 'a1000000-0000-0000-0000-000000000007'),
('a1000000-0000-0000-0000-000000000006', 3, 'Something doesn''t add up - keep investigating', 'a1000000-0000-0000-0000-000000000012');

-- Scene 7 choices (after Lily's timeline)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('a1000000-0000-0000-0000-000000000007', 1, 'Check Grandma''s bedroom - the twins were seen there', 'a1000000-0000-0000-0000-000000000008'),
('a1000000-0000-0000-0000-000000000007', 2, 'The twins are suspicious - accuse them of taking it', 'a1000000-0000-0000-0000-000000000011'),
('a1000000-0000-0000-0000-000000000007', 3, 'Go back to Marcus - his story has too many holes', 'a1000000-0000-0000-0000-000000000006');

-- Scene 8 choices (found the photo)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('a1000000-0000-0000-0000-000000000008', 1, 'Gather everyone and reveal the truth gently', 'a1000000-0000-0000-0000-000000000009'),
('a1000000-0000-0000-0000-000000000008', 2, 'Quietly return the photo and say nothing', 'a1000000-0000-0000-0000-000000000009');

-- Scene 12 choices (keep investigating)
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('a1000000-0000-0000-0000-000000000012', 1, 'Check Grandma''s bedroom - maybe she hid it herself', 'a1000000-0000-0000-0000-000000000008'),
('a1000000-0000-0000-0000-000000000012', 2, 'Actually, Marcus is still the most suspicious', 'a1000000-0000-0000-0000-000000000010'),
('a1000000-0000-0000-0000-000000000012', 3, 'The twins'' note is too suspicious to ignore', 'a1000000-0000-0000-0000-000000000011');
