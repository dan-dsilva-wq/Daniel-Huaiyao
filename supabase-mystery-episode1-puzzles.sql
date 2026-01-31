-- Puzzles for Episode 1: The Missing Photograph
-- These puzzles integrate naturally into the family reunion mystery
-- Run AFTER supabase-mystery-puzzles.sql

-- ============================================
-- PUZZLE 1: Grandma's Diary Lock (Scene 2 - Talking to Uncle Marcus)
-- A combination lock on Marcus's briefcase
-- ============================================
INSERT INTO mystery_puzzles (
  id,
  scene_id,
  puzzle_type,
  difficulty,
  title,
  description,
  puzzle_data,
  answer_type,
  answer_config,
  hints,
  max_hints,
  is_blocking
) VALUES (
  'p1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002',
  'logic',
  2,
  'Marcus''s Briefcase',
  'Uncle Marcus nervously clutches his briefcase. "I have documents in here that might help, but I forgot the combination!" The lock has 3 digits. He remembers some clues he used to set it.',
  '{
    "rules": [
      "It''s a 3-digit code (each digit 0-9)",
      "The sum of all digits is 15",
      "The first digit is twice the last digit",
      "The middle digit is odd",
      "No digit is zero"
    ],
    "question": "What is the 3-digit combination?"
  }',
  'exact',
  '{"answer_hash": "b4a333a582ac2bb4a3bc6a2a3621f97eb684e7c8f1f7c9c8e2f1a2b3c4d5e6f7"}',
  '[
    "If the first digit is twice the last, the pairs could be: 2-1, 4-2, 6-3, 8-4",
    "The sum is 15. Try each pair: if last=2 and first=4, middle = 15-4-2 = 9 (odd!)",
    "4 + 9 + 2 = 15 ✓, first (4) = 2 × last (2) ✓, middle (9) is odd ✓"
  ]',
  3,
  false
);
-- Answer: 492 (hash this: SELECT encode(sha256('492'::bytea), 'hex'))

-- ============================================
-- PUZZLE 2: Lily's Phone Password (Scene 3 - Talking to Cousin Lily)
-- A pattern/sequence puzzle
-- ============================================
INSERT INTO mystery_puzzles (
  id,
  scene_id,
  puzzle_type,
  difficulty,
  title,
  description,
  puzzle_data,
  answer_type,
  answer_config,
  hints,
  max_hints,
  is_blocking
) VALUES (
  'p1000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000003',
  'sequence',
  2,
  'Lily''s Phone',
  'Lily wants to show you the photos she took, but her phone locked! "My password is based on my favorite number sequence," she says. "It''s the next number in this pattern: 1, 1, 2, 3, 5, 8, 13, ?"',
  '{
    "sequence": [1, 1, 2, 3, 5, 8, 13],
    "find": "What comes next? This famous sequence appears everywhere in nature - from sunflower seeds to pinecones.",
    "note": "Enter just the number."
  }',
  'numeric',
  '{"correct_value": 21, "tolerance": 0}',
  '[
    "Look at how each number relates to the two before it.",
    "1+1=2, 1+2=3, 2+3=5, 3+5=8, 5+8=13...",
    "This is the Fibonacci sequence! 8 + 13 = ?"
  ]',
  3,
  false
);
-- Answer: 21

-- ============================================
-- PUZZLE 3: The Twins' Secret Code (Scene 4 - Talking to Jake and Emma)
-- A simple substitution cipher
-- ============================================
INSERT INTO mystery_puzzles (
  id,
  scene_id,
  puzzle_type,
  difficulty,
  title,
  description,
  puzzle_data,
  answer_type,
  answer_config,
  hints,
  max_hints,
  is_blocking
) VALUES (
  'p1000000-0000-0000-0000-000000000003',
  'a1000000-0000-0000-0000-000000000004',
  'cryptography',
  2,
  'The Twins'' Secret Message',
  'The twins show you another note they found, but it''s written in a code! "We use this with our friends," Emma giggles. It''s a simple letter shift - each letter is replaced by the one 3 positions forward in the alphabet (A→D, B→E, etc).',
  '{
    "cipher_type": "Caesar Cipher (shift +3)",
    "ciphertext": "ORRN WUHH",
    "context": "Decode this message. Each letter has been shifted forward by 3 positions. (A→D, B→E, ... Z→C)"
  }',
  'exact',
  '{"answer_hash": "a8cfcd74832004951b4408cdb0a5dbcd8c7e52d43f7fe244bf720582e05241da"}',
  '[
    "Shift each letter BACK by 3 to decode. O→L, R→O...",
    "O→L, R→O, R→O, N→K gives LOOK for the first word",
    "ORRN = LOOK, WUHH = TREE. The message is LOOK TREE!"
  ]',
  3,
  false
);
-- Answer: look tree (hash: SELECT encode(sha256('look tree'::bytea), 'hex'))

-- ============================================
-- PUZZLE 4: The Garden Shed Lock (Scene 5 - Garden Investigation)
-- Number theory - divisibility puzzle
-- ============================================
INSERT INTO mystery_puzzles (
  id,
  scene_id,
  puzzle_type,
  difficulty,
  title,
  description,
  puzzle_data,
  answer_type,
  answer_config,
  hints,
  max_hints,
  is_blocking
) VALUES (
  'p1000000-0000-0000-0000-000000000004',
  'a1000000-0000-0000-0000-000000000005',
  'number_theory',
  3,
  'The Garden Shed',
  'The garden shed has an old padlock. A worn label reads: "Grandpa''s lucky number - the smallest positive integer divisible by 1, 2, 3, 4, 5, and 6."',
  '{
    "equations": [
      "n is divisible by 1",
      "n is divisible by 2",
      "n is divisible by 3",
      "n is divisible by 4",
      "n is divisible by 5",
      "n is divisible by 6"
    ],
    "note": "Find the smallest positive number that satisfies ALL conditions. This is called the Least Common Multiple (LCM)."
  }',
  'numeric',
  '{"correct_value": 60, "tolerance": 0}',
  '[
    "You need the Least Common Multiple (LCM) of 1,2,3,4,5,6",
    "Factor each: 2=2, 3=3, 4=2², 5=5, 6=2×3. Take highest power of each prime.",
    "LCM = 2² × 3 × 5 = 4 × 3 × 5 = 60"
  ]',
  3,
  true
);
-- Answer: 60

-- ============================================
-- PUZZLE 5: The Antique Receipt Code (Scene 6 - Confronting Marcus)
-- Research puzzle - needs to look up info
-- ============================================
INSERT INTO mystery_puzzles (
  id,
  scene_id,
  puzzle_type,
  difficulty,
  title,
  description,
  puzzle_data,
  answer_type,
  answer_config,
  hints,
  max_hints,
  is_blocking
) VALUES (
  'p1000000-0000-0000-0000-000000000005',
  'a1000000-0000-0000-0000-000000000006',
  'research',
  3,
  'Martin''s Authentication Code',
  'The receipt from Martin''s Antiques has a verification code. Marcus says: "Martin uses a special system - the code is the year photography was invented, minus 1000."',
  '{
    "clue": "When was photography invented? The first permanent photograph was created by Joseph Nicéphore Niépce. Subtract 1000 from that year.",
    "sources_hint": "You may need to search for the history of photography - specifically the first permanent photograph."
  }',
  'numeric',
  '{"correct_value": 826, "tolerance": 0}',
  '[
    "Search for ''first photograph'' or ''Joseph Nicéphore Niépce''",
    "The first permanent photograph was made in 1826 or 1827 (1826 is the commonly cited year)",
    "1826 - 1000 = 826"
  ]',
  3,
  false
);
-- Answer: 826 (1826 - 1000)

-- ============================================
-- PUZZLE 6: Timeline Logic (Scene 7 - Lily's Timeline)
-- Logic puzzle about alibis
-- ============================================
INSERT INTO mystery_puzzles (
  id,
  scene_id,
  puzzle_type,
  difficulty,
  title,
  description,
  puzzle_data,
  answer_type,
  answer_config,
  hints,
  max_hints,
  is_blocking
) VALUES (
  'p1000000-0000-0000-0000-000000000006',
  'a1000000-0000-0000-0000-000000000007',
  'logic',
  3,
  'The Timeline Puzzle',
  'You need to figure out who could have taken the photo based on everyone''s movements. The photo was in place at 1:30 PM and missing by 2:15 PM.',
  '{
    "rules": [
      "Marcus was outside from 1:45-2:30 PM (verified by neighbor)",
      "Lily was in the kitchen from 2:00-2:15 PM (verified by Grandma)",
      "The twins were playing video games from 1:00-2:00 PM (verified by each other)",
      "The photo was definitely there at 1:30 PM",
      "The photo was definitely gone by 2:15 PM"
    ],
    "statements": [
      "Suspect must have been near the mantelpiece between 1:30 PM and 2:15 PM",
      "Suspect must NOT have a verified alibi for that entire window"
    ],
    "question": "Who has an UNVERIFIED window of time? Enter: marcus, lily, twins, or grandma"
  }',
  'exact',
  '{"answer_hash": "2c624232cdd221771294dfbb310aca000a0df6ac8b66b696d90ef06fdefb64a3"}',
  '[
    "Map out each person''s timeline between 1:30-2:15 PM",
    "Marcus: outside 1:45-2:30 (but what about 1:30-1:45?). Lily: kitchen 2:00-2:15 (but what about 1:30-2:00?). Twins: gaming until 2:00 PM.",
    "Grandma is the only one without ANY alibi mentioned - she was supposedly moving around the house..."
  ]',
  3,
  false
);
-- Answer: grandma

-- ============================================
-- PUZZLE 7: Grandma's Memory Box (Scene 8 - Bedroom)
-- A word puzzle / anagram
-- ============================================
INSERT INTO mystery_puzzles (
  id,
  scene_id,
  puzzle_type,
  difficulty,
  title,
  description,
  puzzle_data,
  answer_type,
  answer_config,
  hints,
  max_hints,
  is_blocking
) VALUES (
  'p1000000-0000-0000-0000-000000000007',
  'a1000000-0000-0000-0000-000000000008',
  'cryptography',
  2,
  'Grandma''s Memory Box',
  'Under the bed, you find a small box with a letter lock. A note says: "Rearrange these letters to find what I treasure most: YAMILF"',
  '{
    "cipher_type": "Anagram",
    "ciphertext": "YAMILF",
    "context": "Rearrange these 6 letters to spell a word. Hint: It''s what Grandma treasures most at this reunion."
  }',
  'exact',
  '{"answer_hash": "3d5086bb5b2b4ce71f81b6e7a7f6a8ec9c8a5e4f3d2c1b0a9e8d7c6b5a4e3f2"}',
  '[
    "What would Grandma treasure most at a family reunion?",
    "The letters are Y, A, M, I, L, F",
    "Rearranged: FAMILY"
  ]',
  3,
  false
);
-- Answer: family

-- ============================================
-- PUZZLE 8: The Final Revelation (Scene 12 - Keep Investigating)
-- A meta-puzzle combining clues
-- ============================================
INSERT INTO mystery_puzzles (
  id,
  scene_id,
  puzzle_type,
  difficulty,
  title,
  description,
  puzzle_data,
  answer_type,
  answer_config,
  hints,
  max_hints,
  is_blocking
) VALUES (
  'p1000000-0000-0000-0000-000000000008',
  'a1000000-0000-0000-0000-000000000012',
  'logic',
  3,
  'Putting It All Together',
  'Before making any accusations, let''s review the facts logically. Answer this question to confirm your deduction.',
  '{
    "rules": [
      "The photo was being secretly appraised (but returned)",
      "Someone was photographing it for a gift (but didn''t take it)",
      "A note about meeting at the oak tree was found (unrelated to theft)",
      "The twins saw someone near Grandma''s bedroom",
      "Grandma has been forgetful lately"
    ],
    "statements": [
      "Marcus wanted to insure the photo - motive to PROTECT, not steal",
      "Lily wanted to restore it - motive to COPY, not steal",
      "The twins found clues but didn''t take anything",
      "Grandma was worried about the photo''s safety with so many visitors"
    ],
    "question": "Who most likely moved the photo to ''protect'' it? Enter the name."
  }',
  'exact',
  '{"answer_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}',
  '[
    "Think about who had both OPPORTUNITY and a PROTECTIVE motive",
    "Everyone else wanted to copy, insure, or was elsewhere. But who lives there and worries about the photo?",
    "Grandma herself would be most likely to move her own precious photo for safekeeping!"
  ]',
  3,
  true
);
-- Answer: grandma

-- ============================================
-- Update answer hashes with correct values
-- Run these to generate correct hashes:
-- ============================================
-- SELECT encode(sha256('492'::bytea), 'hex');
-- SELECT encode(sha256('look tree'::bytea), 'hex');
-- SELECT encode(sha256('family'::bytea), 'hex');
-- SELECT encode(sha256('grandma'::bytea), 'hex');

UPDATE mystery_puzzles SET answer_config = '{"answer_hash": "' || encode(sha256('492'::bytea), 'hex') || '"}' WHERE id = 'p1000000-0000-0000-0000-000000000001';
UPDATE mystery_puzzles SET answer_config = '{"answer_hash": "' || encode(sha256('look tree'::bytea), 'hex') || '"}' WHERE id = 'p1000000-0000-0000-0000-000000000003';
UPDATE mystery_puzzles SET answer_config = '{"answer_hash": "' || encode(sha256('family'::bytea), 'hex') || '"}' WHERE id = 'p1000000-0000-0000-0000-000000000007';
UPDATE mystery_puzzles SET answer_config = '{"answer_hash": "' || encode(sha256('grandma'::bytea), 'hex') || '"}' WHERE id = 'p1000000-0000-0000-0000-000000000008';
