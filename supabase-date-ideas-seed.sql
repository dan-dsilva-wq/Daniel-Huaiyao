-- Date Ideas Seed Data
-- Run this to populate all date ideas from the list

-- Clear existing data first
DELETE FROM date_ideas;
DELETE FROM date_categories;

-- Insert categories
INSERT INTO date_categories (name, emoji, sort_order) VALUES
  ('Learn Things', '📚', 1),
  ('Feeling Adventurous', '🏔️', 2),
  ('Animals', '🦁', 3),
  ('Something Chilled', '😌', 4),
  ('Daniel', '🎯', 5),
  ('Silly Ideas', '🤪', 6),
  ('Unassigned', '✨', 7);

-- LEARN THINGS
INSERT INTO date_ideas (category_id, title, description, emoji, is_completed) VALUES
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'DND', 'Join a single season', NULL, false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Dancing', 'Go to a dance lesson together', '🕺', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Archery', NULL, '🏹', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Website battle', 'First to £10 profit', NULL, false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Kalimba', NULL, NULL, false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Navigation', 'Map + compass', '🧭', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Memory palaces', NULL, NULL, false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Calligraphy', NULL, '✒️', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Poker', NULL, '🃏', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Trust-building exercises', NULL, NULL, false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Fire-making', NULL, '🔥', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Conflict resolution skills', NULL, NULL, false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Magic trick', NULL, '🪄', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Chess properly', 'Openings, not vibes', '♟️', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Foraging', NULL, '🌿', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'First aid', NULL, '🩹', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Negotiation skills', NULL, NULL, false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Sign language basics', NULL, '🤟', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Morse code', 'Ridiculous but fun', NULL, false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Memory techniques', NULL, '🧠', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Car maintenance basics', NULL, '🚗', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Wilderness survival basics', NULL, '⛺', false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Interrogation skills', NULL, NULL, false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Wild hunting', NULL, NULL, false),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things' LIMIT 1), 'Learn to solve Rubix cube', NULL, '🧩', false);

-- FEELING ADVENTUROUS
INSERT INTO date_ideas (category_id, title, description, emoji, is_completed) VALUES
  ((SELECT id FROM date_categories WHERE name = 'Feeling Adventurous' LIMIT 1), 'Abseiling', NULL, NULL, false),
  ((SELECT id FROM date_categories WHERE name = 'Feeling Adventurous' LIMIT 1), 'Aqueduct', NULL, NULL, false),
  ((SELECT id FROM date_categories WHERE name = 'Feeling Adventurous' LIMIT 1), 'Coastal foraging', NULL, '🦀', false),
  ((SELECT id FROM date_categories WHERE name = 'Feeling Adventurous' LIMIT 1), 'Hilbre Island', 'Chicken edition', '🏝️', false),
  ((SELECT id FROM date_categories WHERE name = 'Feeling Adventurous' LIMIT 1), 'Waterfall pool swim', NULL, '💦', false),
  ((SELECT id FROM date_categories WHERE name = 'Feeling Adventurous' LIMIT 1), 'Swim in the Sea', NULL, '🦈', false),
  ((SELECT id FROM date_categories WHERE name = 'Feeling Adventurous' LIMIT 1), 'Beach barbeque', NULL, '🏖️', false),
  ((SELECT id FROM date_categories WHERE name = 'Feeling Adventurous' LIMIT 1), 'Wild Camping', NULL, '⛺', false),
  ((SELECT id FROM date_categories WHERE name = 'Feeling Adventurous' LIMIT 1), 'Hike up a mountain', NULL, '🏔️', false),
  ((SELECT id FROM date_categories WHERE name = 'Feeling Adventurous' LIMIT 1), 'Treasure Hunting', NULL, '🧑🏻‍🦯', false),
  ((SELECT id FROM date_categories WHERE name = 'Feeling Adventurous' LIMIT 1), 'Sea Rock Walking', NULL, '🪨', false),
  ((SELECT id FROM date_categories WHERE name = 'Feeling Adventurous' LIMIT 1), 'Adventure - Hardmode', 'No GPS, no use of phones', '🗺️', false),
  ((SELECT id FROM date_categories WHERE name = 'Feeling Adventurous' LIMIT 1), 'Find the aurora', NULL, '🌌', false);

-- ANIMALS
INSERT INTO date_ideas (category_id, title, description, emoji, is_completed) VALUES
  ((SELECT id FROM date_categories WHERE name = 'Animals' LIMIT 1), 'Aquarium', NULL, '🐠', false),
  ((SELECT id FROM date_categories WHERE name = 'Animals' LIMIT 1), 'Animal shelter', NULL, '🐶', false),
  ((SELECT id FROM date_categories WHERE name = 'Animals' LIMIT 1), 'Chester Zoo', NULL, '🦁', false),
  ((SELECT id FROM date_categories WHERE name = 'Animals' LIMIT 1), 'Safari', NULL, '🐘', false);

-- SOMETHING CHILLED
INSERT INTO date_ideas (category_id, title, description, emoji, is_completed) VALUES
  ((SELECT id FROM date_categories WHERE name = 'Something Chilled' LIMIT 1), 'Escape room', NULL, '🔐', true),
  ((SELECT id FROM date_categories WHERE name = 'Something Chilled' LIMIT 1), 'Plan out a start-up together', NULL, '✨', false),
  ((SELECT id FROM date_categories WHERE name = 'Something Chilled' LIMIT 1), 'Build a fort and sleep in it', NULL, '🛌', false),
  ((SELECT id FROM date_categories WHERE name = 'Something Chilled' LIMIT 1), 'Board game cafe', 'Spiel des jahres', '🎲', false),
  ((SELECT id FROM date_categories WHERE name = 'Something Chilled' LIMIT 1), 'All of the films Daniel hasn''t seen', NULL, '🎬', false),
  ((SELECT id FROM date_categories WHERE name = 'Something Chilled' LIMIT 1), 'Dish off', 'Compete to make the best meal', '👨‍🍳', false);

-- DANIEL (Active & Fun)
INSERT INTO date_ideas (category_id, title, description, emoji, is_completed) VALUES
  ((SELECT id FROM date_categories WHERE name = 'Daniel' LIMIT 1), 'Sport Fantastic', 'Try a new sport group together', '🏑', false),
  ((SELECT id FROM date_categories WHERE name = 'Daniel' LIMIT 1), 'The Eden project', NULL, '🌱', false),
  ((SELECT id FROM date_categories WHERE name = 'Daniel' LIMIT 1), 'Trampoline Park', NULL, '🦘', false),
  ((SELECT id FROM date_categories WHERE name = 'Daniel' LIMIT 1), 'Real Go Karting', NULL, '🏎️', false),
  ((SELECT id FROM date_categories WHERE name = 'Daniel' LIMIT 1), 'Arcade', 'Old school arcade ticket competition', '🎟️', false),
  ((SELECT id FROM date_categories WHERE name = 'Daniel' LIMIT 1), 'Paint ball', NULL, '🎨', false),
  ((SELECT id FROM date_categories WHERE name = 'Daniel' LIMIT 1), 'Laser tag', NULL, '🔫', false),
  ((SELECT id FROM date_categories WHERE name = 'Daniel' LIMIT 1), 'Go to a random country in Europe', NULL, '✈️', false),
  ((SELECT id FROM date_categories WHERE name = 'Daniel' LIMIT 1), 'Go Ape', NULL, '🦧', false),
  ((SELECT id FROM date_categories WHERE name = 'Daniel' LIMIT 1), 'Ninja Warrior', NULL, '🥷', false);

-- SILLY IDEAS
INSERT INTO date_ideas (category_id, title, description, emoji, is_completed) VALUES
  ((SELECT id FROM date_categories WHERE name = 'Silly Ideas' LIMIT 1), 'Power Point V1', 'Most offensive', '📊', false),
  ((SELECT id FROM date_categories WHERE name = 'Silly Ideas' LIMIT 1), 'Power Point V2', 'Make a funny power point about our lives', '📊', false),
  ((SELECT id FROM date_categories WHERE name = 'Silly Ideas' LIMIT 1), 'Fancy Dress', 'Dress up and make up like old people and go to an event', '🧓', false),
  ((SELECT id FROM date_categories WHERE name = 'Silly Ideas' LIMIT 1), 'Write a Book', 'Where we alternate after each sentence', '📖', true),
  ((SELECT id FROM date_categories WHERE name = 'Silly Ideas' LIMIT 1), 'Conspiracy', 'Find a conspiracy you believe and try to convince the other person', '👽', false),
  ((SELECT id FROM date_categories WHERE name = 'Silly Ideas' LIMIT 1), 'Who are you?', 'In public, pretend we''ve never met and massively over escalate', '🎭', false),
  ((SELECT id FROM date_categories WHERE name = 'Silly Ideas' LIMIT 1), 'Day of Sins', 'Complete the most sins in a day', '😈', false),
  ((SELECT id FROM date_categories WHERE name = 'Silly Ideas' LIMIT 1), 'Power Point V3', 'Zombie apocalypse plan', '🧟', false),
  ((SELECT id FROM date_categories WHERE name = 'Silly Ideas' LIMIT 1), 'Sex Club', 'Go to a sex club', '🔞', false),
  ((SELECT id FROM date_categories WHERE name = 'Silly Ideas' LIMIT 1), 'Post mortem', 'Write a bibliography about each other', '📜', false),
  ((SELECT id FROM date_categories WHERE name = 'Silly Ideas' LIMIT 1), 'Stand up', 'Write the best stand up routine possible in 1-2 hours', '🎤', false),
  ((SELECT id FROM date_categories WHERE name = 'Silly Ideas' LIMIT 1), 'Junky Hustling', 'Make £100 net profit first. No selling what you have. Current job doesn''t count', '💰', false),
  ((SELECT id FROM date_categories WHERE name = 'Silly Ideas' LIMIT 1), 'Lightsaber Combat Academy', NULL, '⚔️', false);

-- UNASSIGNED
INSERT INTO date_ideas (category_id, title, description, emoji, is_completed) VALUES
  ((SELECT id FROM date_categories WHERE name = 'Unassigned' LIMIT 1), 'Ice skating', NULL, '⛸️', false),
  ((SELECT id FROM date_categories WHERE name = 'Unassigned' LIMIT 1), 'Jury experience', NULL, '⚖️', false);
