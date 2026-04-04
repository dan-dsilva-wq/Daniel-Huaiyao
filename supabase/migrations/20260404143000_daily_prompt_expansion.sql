INSERT INTO prompt_categories (name, emoji, description, sort_order) VALUES
  ('romance', '💞', 'Romantic and affectionate prompts', 6),
  ('home', '🏡', 'Questions about everyday life together', 7),
  ('play', '🎲', 'Playful, mischievous, and creative prompts', 8),
  ('curiosity', '🪐', 'Questions that explore how you each think', 9)
ON CONFLICT (name) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_text_unique
  ON prompts (LOWER(prompt_text));

WITH new_prompts(category_name, prompt_text) AS (
  VALUES
    ('deep', 'What part of our relationship feels strongest to you right now?'),
    ('deep', 'What is something you wish I understood more quickly about you?'),
    ('deep', 'What do I do that makes you feel safest with me?'),
    ('deep', 'When do you feel the most emotionally close to me?'),
    ('deep', 'What is one conversation you think would make us even stronger?'),
    ('deep', 'What part of your inner world do you want me to know better?'),
    ('deep', 'What do you think we handle especially well as a team?'),
    ('deep', 'What is something hard you would trust me to help you carry?'),
    ('deep', 'How have you changed for the better since we got together?'),
    ('deep', 'What do you hope never changes about us?'),
    ('deep', 'What is a fear you have that you rarely say out loud?'),
    ('deep', 'What makes you feel genuinely listened to by me?'),
    ('deep', 'When have I made you feel most accepted exactly as you are?'),
    ('deep', 'What kind of life do you think would make us feel most at peace?'),
    ('deep', 'What do you think is the most underrated part of loving someone well?'),
    ('deep', 'What does emotional intimacy look like to you on an ordinary day?'),
    ('deep', 'What is something you want us to protect no matter how busy life gets?'),
    ('deep', 'What is one way I could love you more intelligently, not just more loudly?'),
    ('deep', 'What do you think we are still learning about each other?'),
    ('deep', 'What truth about you feels vulnerable but important for me to know?'),
    ('deep', 'What would make the next year of our relationship feel meaningful to you?'),
    ('deep', 'When do you feel most proud of us?'),
    ('deep', 'What is something you have learned about love from being with me?'),
    ('deep', 'What do you think makes a relationship feel like home?'),
    ('deep', 'What kind of support feels most loving when you are overwhelmed?'),
    ('deep', 'What do you think we do better than most couples?'),
    ('deep', 'What is something you are still healing from that affects how you love?'),
    ('deep', 'What is one thing you want us to become braver about together?'),
    ('deep', 'When have you felt most chosen by me?'),
    ('deep', 'What does commitment mean to you in day-to-day life?'),

    ('fun', 'If we had to host the weirdest themed dinner party possible, what would the theme be?'),
    ('fun', 'What ridiculous competition would we take way too seriously?'),
    ('fun', 'If our relationship had a mascot, what would it be?'),
    ('fun', 'What tiny inconvenience would absolutely destroy us on a reality show?'),
    ('fun', 'If we swapped jobs for a week, who would fail faster?'),
    ('fun', 'What would be the funniest item to find in our shared emergency kit?'),
    ('fun', 'If our texts were turned into a museum exhibit, what section would get the most attention?'),
    ('fun', 'If we were banned from using one overused phrase with each other, what should go first?'),
    ('fun', 'What would our signature couple handshake definitely include?'),
    ('fun', 'Which one of us would survive longer in a deeply unserious apocalypse?'),
    ('fun', 'If we had to enter a talent show tomorrow, what would our act be?'),
    ('fun', 'What would be the funniest fake business for us to launch together?'),
    ('fun', 'If we could instantly become experts in one impractical thing, what should it be?'),
    ('fun', 'What would our pet be like if it inherited both our worst habits?'),
    ('fun', 'What bizarre item would you trust me to buy for us without explanation?'),
    ('fun', 'If we had to communicate only in song titles for one day, whose playlist would win?'),
    ('fun', 'What sort of tiny domestic disagreement would become our sitcom running joke?'),
    ('fun', 'If we had matching jackets, what should the back of them say?'),
    ('fun', 'Which one of us would get too emotionally invested in a trivia night?'),
    ('fun', 'If our date nights had achievement badges, what would we have already unlocked?'),
    ('fun', 'What type of shop would we accidentally spend too long in?'),
    ('fun', 'If we got to rename one boring adult responsibility, what would make it dramatic enough?'),
    ('fun', 'What food would best represent our energy as a couple?'),
    ('fun', 'If we had to film a travel vlog with zero preparation, what would go wrong first?'),
    ('fun', 'What harmless crime would our cartoon versions be accused of?'),
    ('fun', 'What game show would we secretly dominate together?'),
    ('fun', 'If we could be known for one very specific couple tradition, what should it be?'),
    ('fun', 'What would be the funniest thing to hear us arguing passionately about?'),
    ('fun', 'If our house had a dramatic voice-over narrator, what would it say about tonight?'),
    ('fun', 'What weird object could become sentimental if we kept it for long enough?'),

    ('future', 'What kind of weekend would make our future life feel quietly perfect?'),
    ('future', 'What do you want future-us to be known for among our friends?'),
    ('future', 'What tradition should we start before life gets any busier?'),
    ('future', 'What is one adventure you want locked in before the end of next year?'),
    ('future', 'What kind of home atmosphere do you want us to build?'),
    ('future', 'What would a beautiful ordinary Tuesday look like for future-us?'),
    ('future', 'What is one thing you want us to save up for together?'),
    ('future', 'What future memory do you think we would treasure for decades?'),
    ('future', 'What skill do you want us to learn as a pair?'),
    ('future', 'What habit would make our next chapter feel healthier?'),
    ('future', 'What place do you most want us to return to one day?'),
    ('future', 'What kind of social life do you want us to have in the future?'),
    ('future', 'What would make a future holiday feel deeply “us”?'),
    ('future', 'What kind of courage do you want us to practice more?'),
    ('future', 'What dream feels more possible because we are together?'),
    ('future', 'How do you want us to celebrate milestones five years from now?'),
    ('future', 'What future version of you are you most excited to meet?'),
    ('future', 'What would make our future feel abundant, even without being extravagant?'),
    ('future', 'What do you want us to get better at planning?'),
    ('future', 'What future challenge do you think we could handle surprisingly well?'),
    ('future', 'What kind of place should become our signature getaway?'),
    ('future', 'What do you want us to say yes to more often?'),
    ('future', 'What do you want our relationship to feel like during stressful seasons?'),
    ('future', 'What kind of shared project would you love us to build over time?'),
    ('future', 'What does growing old together look like in your imagination?'),
    ('future', 'What does success look like for us that has nothing to do with money?'),
    ('future', 'What memory should we intentionally create this summer?'),
    ('future', 'What are you most curious to discover about us in the next few years?'),
    ('future', 'What kind of future dinner table conversations do you hope we are having?'),
    ('future', 'What would make the rest of this year feel well-lived together?'),

    ('memories', 'What ordinary moment with me unexpectedly became a favorite memory?'),
    ('memories', 'Which day with me do you replay in your head most often?'),
    ('memories', 'What is a memory of us that feels almost unreal in the best way?'),
    ('memories', 'What small detail from an old date do you still remember clearly?'),
    ('memories', 'What is one memory of us that instantly changes your mood?'),
    ('memories', 'When did we feel funniest together?'),
    ('memories', 'What trip or outing of ours deserves a sequel?'),
    ('memories', 'What is the best accidental moment we have ever had?'),
    ('memories', 'What is one memory that proves we are a weirdly good match?'),
    ('memories', 'Which version of us from the past would make you smile most to revisit?'),
    ('memories', 'What was one of the first signs that we really got each other?'),
    ('memories', 'What moment made you think “oh, this is becoming important”?'),
    ('memories', 'What laugh with me do you remember most vividly?'),
    ('memories', 'What object or photo instantly brings back one of our best moments?'),
    ('memories', 'What is the coziest memory you have of us?'),
    ('memories', 'What is a memory that still makes you blush a little?'),
    ('memories', 'Which memory of us would you tell in a speech if you had to?'),
    ('memories', 'What is one place that feels permanently more special because of us?'),
    ('memories', 'What memory captures our chemistry better than words?'),
    ('memories', 'When did we feel most like a team?'),
    ('memories', 'What is a tiny, silly memory you never want to lose?'),
    ('memories', 'What memory reminds you how much we have grown together?'),
    ('memories', 'What meal, snack, or drink now feels tied to a memory of us?'),
    ('memories', 'What is the strongest “I miss that day” memory you have of us?'),
    ('memories', 'What was the most unexpectedly romantic thing we have done together?'),
    ('memories', 'What memory makes you feel the softest toward me?'),
    ('memories', 'What moment from our early days still surprises you when you think about it?'),
    ('memories', 'What is the most cinematic memory we have together?'),
    ('memories', 'What memory proves we can make anything fun?'),
    ('memories', 'What is the best memory we made without spending much at all?'),

    ('gratitude', 'What is one way I have made your week easier lately?'),
    ('gratitude', 'What is something about my character that you quietly admire?'),
    ('gratitude', 'What do I do that makes everyday life feel lighter?'),
    ('gratitude', 'What is something kind I do that might go unnoticed too often?'),
    ('gratitude', 'What part of me do you think deserves more appreciation?'),
    ('gratitude', 'What is one thing I do that makes you feel chosen?'),
    ('gratitude', 'How have I helped you feel more like yourself?'),
    ('gratitude', 'What is something I bring into your life that you never want to lose?'),
    ('gratitude', 'What is a way I have surprised you with my care?'),
    ('gratitude', 'What do you feel most thankful for when you think about us this month?'),
    ('gratitude', 'What is one specific thing I did recently that made you feel loved?'),
    ('gratitude', 'What about me makes hard days easier to face?'),
    ('gratitude', 'What is a quality of mine that has become even more attractive over time?'),
    ('gratitude', 'What is something I naturally do well in relationships?'),
    ('gratitude', 'What are you grateful I understand about you?'),
    ('gratitude', 'What is one thing you would thank me for in a very honest letter?'),
    ('gratitude', 'What is one comfort you associate with me?'),
    ('gratitude', 'What is something I do that makes love feel practical, not just poetic?'),
    ('gratitude', 'What kind of presence do I bring into a room for you?'),
    ('gratitude', 'What is one moment recently when you felt especially lucky to have me?'),
    ('gratitude', 'What do you appreciate about how I care when you are tired or low?'),
    ('gratitude', 'What is something about my mind that you are grateful for?'),
    ('gratitude', 'What part of our dynamic feels like a gift to you?'),
    ('gratitude', 'What do you most appreciate about how we handle life together?'),
    ('gratitude', 'What is one thing I say that lands deeply when you need it?'),
    ('gratitude', 'What is something about my love that feels rare?'),
    ('gratitude', 'What do I do that makes you feel steadier?'),
    ('gratitude', 'What are you grateful we learned early in our relationship?'),
    ('gratitude', 'What version of care from me feels the most healing?'),
    ('gratitude', 'What do you think I give you that I might underestimate?'),

    ('growth', 'What habit would make our relationship feel gentler this month?'),
    ('growth', 'What is something you want to get braver about emotionally?'),
    ('growth', 'What is one way we could argue more kindly?'),
    ('growth', 'What kind of self-respect are you trying to protect lately?'),
    ('growth', 'What is one pattern you want to outgrow in relationships?'),
    ('growth', 'What kind of support helps you keep growing instead of shutting down?'),
    ('growth', 'What is one thing you want to become more honest about?'),
    ('growth', 'What would make communication between us feel more skillful?'),
    ('growth', 'What is one insecurity you want to handle more gently?'),
    ('growth', 'What is one area of life where you want to become more confident?'),
    ('growth', 'How can we make it easier to bring up hard things earlier?'),
    ('growth', 'What would emotional maturity look like for us this year?'),
    ('growth', 'What is one boundary you want to protect more clearly?'),
    ('growth', 'What kind of future version of yourself are you working toward?'),
    ('growth', 'What would make you feel more grounded this month?'),
    ('growth', 'What do you want to stop apologizing for?'),
    ('growth', 'What is one conversation skill you want us both to practice?'),
    ('growth', 'What are you currently learning about yourself?'),
    ('growth', 'What is one thing you want us to recover faster from?'),
    ('growth', 'What kind of care do you need when you are stretched thin?'),
    ('growth', 'What does healthy independence inside a relationship mean to you?'),
    ('growth', 'What is one way we could become more intentional with our time?'),
    ('growth', 'What do you want to be more disciplined about for your own sake?'),
    ('growth', 'What is one emotional shortcut you want to stop taking?'),
    ('growth', 'What would make you feel more understood during conflict?'),
    ('growth', 'What is a personal goal that deserves more serious energy from you?'),
    ('growth', 'How can I challenge you well without making you feel judged?'),
    ('growth', 'What kind of tenderness do you need while you are growing?'),
    ('growth', 'What area of your life do you want more courage in?'),
    ('growth', 'What is one thing we should check in on more consistently as a couple?'),

    ('romance', 'What is one thing I do that instantly makes you feel adored?'),
    ('romance', 'What kind of date makes you feel most swept up in us?'),
    ('romance', 'What compliment from me lands the deepest?'),
    ('romance', 'When do you feel most beautiful with me?'),
    ('romance', 'What romantic gesture feels especially “you know me”?'),
    ('romance', 'What song would soundtrack the softest version of us?'),
    ('romance', 'What kind of affection do you wish I initiated even more?'),
    ('romance', 'What tiny romantic ritual should become ours?'),
    ('romance', 'What would make an evening feel effortlessly romantic to you?'),
    ('romance', 'What is one thing I could do more often that would make you melt a little?'),
    ('romance', 'What romantic memory of us still lingers in your body?'),
    ('romance', 'What flower, scent, or detail feels most like your version of romance?'),
    ('romance', 'What makes being pursued feel good to you?'),
    ('romance', 'What kind of message from me would make your whole day better?'),
    ('romance', 'What part of our chemistry feels the most electric?'),
    ('romance', 'What would your ideal surprise kiss-in-the-rain type scene actually look like?'),
    ('romance', 'What form of tenderness feels more powerful than grand gestures?'),
    ('romance', 'What is one way we can keep romance alive during boring weeks?'),

    ('home', 'What part of living life with me feels the most comforting?'),
    ('home', 'What does a genuinely lovely evening at home look like to you?'),
    ('home', 'What is one household ritual that would make our days feel nicer?'),
    ('home', 'What room or corner could we make feel more like us?'),
    ('home', 'What ordinary task is secretly better when we do it together?'),
    ('home', 'What smell, sound, or light level makes a place feel like home to you?'),
    ('home', 'What tiny upgrade would make our space feel more cosy?'),
    ('home', 'What kind of hosting vibe would you want us to have?'),
    ('home', 'What does a low-stress weekend at home look like for you?'),
    ('home', 'What shared routine would help our mornings feel better?'),
    ('home', 'What makes a home feel emotionally calm, not just tidy?'),
    ('home', 'What is one thing you want people to feel when they walk into our place?'),
    ('home', 'What food should always make our home feel welcoming?'),
    ('home', 'What is one practical thing we could do that would make daily life smoother?'),
    ('home', 'What home tradition would you love us to have in winter?'),
    ('home', 'What makes being domestic together unexpectedly romantic?'),
    ('home', 'What is one thing you want our future home to always have space for?'),
    ('home', 'What small home moment with me feels the most peaceful?'),

    ('play', 'What harmless challenge should we set each other this week?'),
    ('play', 'What silly rule should exist for our next date night?'),
    ('play', 'What ridiculous bet between us would get too competitive too quickly?'),
    ('play', 'If we had to invent a game based on our relationship, how would it work?'),
    ('play', 'What playful side of you comes out most with me?'),
    ('play', 'What is a very unserious activity we would still somehow make romantic?'),
    ('play', 'What would be the funniest prize for winning an at-home challenge with me?'),
    ('play', 'What type of mischief are we best at together?'),
    ('play', 'What tiny adventure would feel playful but still worth leaving the house for?'),
    ('play', 'What should our next themed evening be?'),
    ('play', 'What game do you think reveals too much about a person?'),
    ('play', 'What kind of teasing from me feels fun instead of annoying?'),
    ('play', 'What is one thing we should do just because it would make a good story later?'),
    ('play', 'If we had to make a tiny trophy for couple excellence, what would it look like?'),
    ('play', 'What dare would be cute, not stressful, for us?'),
    ('play', 'What makes flirting feel most playful between us?'),
    ('play', 'What small competition should become a regular thing for us?'),
    ('play', 'What is one activity we would enjoy more if we stopped taking it seriously?'),

    ('curiosity', 'What is something about your mind that people misunderstand?'),
    ('curiosity', 'What topic could you happily fall into for hours?'),
    ('curiosity', 'What does your ideal day of thinking and wandering look like?'),
    ('curiosity', 'What question about life do you keep returning to?'),
    ('curiosity', 'What kind of person instantly makes you curious?'),
    ('curiosity', 'What makes you change your mind about something important?'),
    ('curiosity', 'What is one belief you have become less certain about over time?'),
    ('curiosity', 'What part of the world do you wish you understood more deeply?'),
    ('curiosity', 'What subject reveals the most about your personality?'),
    ('curiosity', 'What is something you notice that many people miss?'),
    ('curiosity', 'What kind of conversation makes time disappear for you?'),
    ('curiosity', 'What is one thing you want to ask older-you?'),
    ('curiosity', 'What makes a question feel beautiful to you?'),
    ('curiosity', 'What are you currently curious enough to explore properly?'),
    ('curiosity', 'What is something you suspect about yourself that you are still testing?'),
    ('curiosity', 'What kind of mystery are you most drawn to: people, places, ideas, or patterns?'),
    ('curiosity', 'What would you love to learn if there were no pressure to be good at it?'),
    ('curiosity', 'What makes a person feel mentally alive to be around?')
)
INSERT INTO prompts (category_id, prompt_text)
SELECT pc.id, np.prompt_text
FROM new_prompts np
JOIN prompt_categories pc ON pc.name = np.category_name
WHERE NOT EXISTS (
  SELECT 1
  FROM prompts p
  WHERE LOWER(p.prompt_text) = LOWER(np.prompt_text)
);

CREATE OR REPLACE FUNCTION get_daily_prompt(p_player TEXT)
RETURNS TABLE (
  daily_prompt_id UUID,
  prompt_id UUID,
  prompt_text TEXT,
  category_name TEXT,
  category_emoji TEXT,
  prompt_date DATE,
  my_response TEXT,
  partner_response TEXT,
  my_response_time TIMESTAMPTZ,
  partner_response_time TIMESTAMPTZ
) AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_daily_prompt_id UUID;
  v_prompt_id UUID;
  v_partner TEXT;
BEGIN
  v_partner := CASE WHEN p_player = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;

  SELECT dp.id, dp.prompt_id INTO v_daily_prompt_id, v_prompt_id
  FROM daily_prompts dp
  WHERE dp.prompt_date = v_today;

  IF NOT FOUND THEN
    SELECT p.id INTO v_prompt_id
    FROM prompts p
    WHERE p.is_active = true
      AND p.id NOT IN (
        SELECT dp.prompt_id
        FROM daily_prompts dp
        WHERE dp.prompt_date > v_today - 365
      )
    ORDER BY RANDOM()
    LIMIT 1;

    IF v_prompt_id IS NULL THEN
      SELECT p.id INTO v_prompt_id
      FROM prompts p
      WHERE p.is_active = true
      ORDER BY RANDOM()
      LIMIT 1;
    END IF;

    INSERT INTO daily_prompts (prompt_id, prompt_date)
    VALUES (v_prompt_id, v_today)
    RETURNING id INTO v_daily_prompt_id;
  END IF;

  RETURN QUERY
  SELECT
    dp.id AS daily_prompt_id,
    p.id AS prompt_id,
    p.prompt_text,
    pc.name AS category_name,
    pc.emoji AS category_emoji,
    dp.prompt_date,
    (SELECT pr.response_text FROM prompt_responses pr WHERE pr.daily_prompt_id = dp.id AND pr.player = p_player) AS my_response,
    (SELECT pr.response_text FROM prompt_responses pr WHERE pr.daily_prompt_id = dp.id AND pr.player = v_partner) AS partner_response,
    (SELECT pr.created_at FROM prompt_responses pr WHERE pr.daily_prompt_id = dp.id AND pr.player = p_player) AS my_response_time,
    (SELECT pr.created_at FROM prompt_responses pr WHERE pr.daily_prompt_id = dp.id AND pr.player = v_partner) AS partner_response_time
  FROM daily_prompts dp
  JOIN prompts p ON p.id = dp.prompt_id
  JOIN prompt_categories pc ON pc.id = p.category_id
  WHERE dp.id = v_daily_prompt_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_prompt_history(p_player TEXT, p_limit INTEGER DEFAULT 30)
RETURNS TABLE (
  daily_prompt_id UUID,
  prompt_text TEXT,
  category_emoji TEXT,
  prompt_date DATE,
  my_response TEXT,
  partner_response TEXT,
  my_response_time TIMESTAMPTZ,
  partner_response_time TIMESTAMPTZ,
  both_answered BOOLEAN,
  needs_my_answer BOOLEAN
) AS $$
DECLARE
  v_partner TEXT;
BEGIN
  v_partner := CASE WHEN p_player = 'daniel' THEN 'huaiyao' ELSE 'daniel' END;

  RETURN QUERY
  SELECT
    dp.id AS daily_prompt_id,
    p.prompt_text,
    pc.emoji AS category_emoji,
    dp.prompt_date,
    my_pr.response_text AS my_response,
    partner_pr.response_text AS partner_response,
    my_pr.created_at AS my_response_time,
    partner_pr.created_at AS partner_response_time,
    (my_pr.id IS NOT NULL AND partner_pr.id IS NOT NULL) AS both_answered,
    (my_pr.id IS NULL AND partner_pr.id IS NOT NULL) AS needs_my_answer
  FROM daily_prompts dp
  JOIN prompts p ON p.id = dp.prompt_id
  JOIN prompt_categories pc ON pc.id = p.category_id
  LEFT JOIN prompt_responses my_pr
    ON my_pr.daily_prompt_id = dp.id AND my_pr.player = p_player
  LEFT JOIN prompt_responses partner_pr
    ON partner_pr.daily_prompt_id = dp.id AND partner_pr.player = v_partner
  WHERE dp.prompt_date < CURRENT_DATE
  ORDER BY
    CASE WHEN my_pr.id IS NULL AND partner_pr.id IS NOT NULL THEN 0 ELSE 1 END,
    dp.prompt_date DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
