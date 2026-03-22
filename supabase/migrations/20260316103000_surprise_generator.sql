CREATE TABLE IF NOT EXISTS surprise_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_text TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (
    category IN ('at_home', 'low_cost_outing', 'affectionate', 'practical', 'playful', 'thoughtful')
  ),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monthly_surprises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_key TEXT NOT NULL,
  player TEXT NOT NULL CHECK (player IN ('daniel', 'huaiyao')),
  surprise_idea_id UUID NOT NULL REFERENCES surprise_ideas(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notify_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (month_key, player)
);

CREATE INDEX IF NOT EXISTS idx_monthly_surprises_player_month
  ON monthly_surprises(player, month_key DESC);

CREATE INDEX IF NOT EXISTS idx_monthly_surprises_player_generated
  ON monthly_surprises(player, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_monthly_surprises_idea
  ON monthly_surprises(surprise_idea_id);

INSERT INTO surprise_ideas (idea_text, category)
VALUES
  ('Leave a handwritten note somewhere unexpected for your partner to find.', 'at_home'),
  ('Make their side of the bed look hotel-perfect before they notice.', 'practical'),
  ('Hide a tiny snack and a sweet clue where they usually work or relax.', 'playful'),
  ('Plan a no-phones tea or coffee break together and set it up nicely.', 'thoughtful'),
  ('Put together a mini dessert plate from things already at home.', 'at_home'),
  ('Write down three things your partner did this month that made life better.', 'thoughtful'),
  ('Set out their comfiest evening setup before they ask for it.', 'practical'),
  ('Leave a compliment taped to the bathroom mirror.', 'affectionate'),
  ('Create a two-song private soundtrack for tonight and send it with no explanation.', 'affectionate'),
  ('Make a tiny living-room date out of snacks, candles, and one fun question.', 'at_home'),
  ('Straighten one annoying little area they use every day.', 'practical'),
  ('Slip a sweet message into a pocket, bag, or laptop sleeve.', 'playful'),
  ('Write a short “reasons I still choose you” note.', 'affectionate'),
  ('Pick up their least favorite chore without announcing it first.', 'practical'),
  ('Plan a spontaneous walk with one drink stop and one silly rule.', 'low_cost_outing'),
  ('Leave a trail of three small clues that leads to a tiny surprise at home.', 'playful'),
  ('Make them a one-evening “menu” with options for snack, activity, and cuddle level.', 'playful'),
  ('Set the table for an ordinary meal as if it is an anniversary dinner.', 'at_home'),
  ('Create a “pause kit” with tea, water, and one kind note for a stressful day.', 'thoughtful'),
  ('Write one memory you never want them to forget and give it to them folded up.', 'thoughtful'),
  ('Plan a bookstore, market, or cafe browse with no fixed schedule.', 'low_cost_outing'),
  ('Make a playful coupon they can redeem this week.', 'playful'),
  ('Pick one thing they have mentioned wanting to do and make the first step easy.', 'practical'),
  ('Set up a surprise dessert or fruit plate after dinner.', 'at_home'),
  ('Write a one-paragraph love letter with one very specific detail from this month.', 'affectionate'),
  ('Organize a tiny sunrise or sunset moment together, even if it is just outside the house.', 'thoughtful'),
  ('Pack a tiny “open when tired” treat for them.', 'thoughtful'),
  ('Choose one room and make it feel softer, cleaner, or calmer for tonight.', 'practical'),
  ('Plan a spontaneous little trip for a future date and only reveal the theme.', 'low_cost_outing'),
  ('Create a mini scavenger hunt with two clues and one sweet final message.', 'playful'),
  ('Leave them a voice note telling them something you admire about them lately.', 'affectionate'),
  ('Make an ordinary errand feel like a micro-adventure with one extra fun stop.', 'low_cost_outing'),
  ('Prepare their favorite drink exactly how they like it and bring it to them.', 'affectionate'),
  ('Write down three future things you want to do with them this year.', 'thoughtful'),
  ('Pick out an outfit detail, snack, or comfort item for them before they ask.', 'practical'),
  ('Turn one evening into “soft launch date night” with lights, music, and a little effort.', 'at_home'),
  ('Leave a tiny note that says what you noticed them doing well this week.', 'thoughtful'),
  ('Plan a zero-cost outing: park walk, river walk, neighborhood wander, or sunset sit.', 'low_cost_outing'),
  ('Make a silly but charming title for your partner and address them by it for one evening.', 'playful'),
  ('Set up a snack tasting from whatever is already in the kitchen.', 'at_home'),
  ('Do one invisible act of service and only tell them after they notice the difference.', 'practical'),
  ('Write a “top five things I love about us lately” list.', 'affectionate'),
  ('Create a cozy corner with blanket, drink, and a note inviting them to rest.', 'thoughtful'),
  ('Plan a surprise photo together in a place you already visit often.', 'low_cost_outing'),
  ('Leave a note in the fridge or cupboard with a tiny compliment and a heart.', 'affectionate'),
  ('Set up a five-minute dance break at home with one song each.', 'playful'),
  ('Make a “good luck today” setup with one practical thing and one sweet thing.', 'practical'),
  ('Plan a spontaneous picnic-style snack, even if it is just indoors on the floor.', 'at_home'),
  ('Write a short note finishing the sentence “I feel safest with you when…”', 'affectionate'),
  ('Pick a small part of the weekend and secretly make it easier or prettier.', 'practical'),
  ('Invite them on a tiny mystery date and only reveal one clue at a time.', 'playful'),
  ('Make a mini appreciation card for something they do that is easy to overlook.', 'thoughtful'),
  ('Choose a memory of the two of you and retell it like it is your favorite scene in a film.', 'playful'),
  ('Plan one low-cost outing they did not have to think about at all.', 'low_cost_outing'),
  ('Set out a bedtime wind-down with water, charger, and a kind note.', 'practical'),
  ('Write one sentence about the version of them you are proudest of right now.', 'affectionate'),
  ('Create a tiny at-home tasting: tea, fruit, chocolate, or anything already around.', 'at_home'),
  ('Leave a folded note that says exactly what they did recently that made you smile.', 'thoughtful'),
  ('Make them a playful “mission for tonight” card that ends in a cuddle or snack.', 'playful'),
  ('Plan a spontaneous train, bus, or driving outing with a simple destination and no pressure.', 'low_cost_outing')
ON CONFLICT (idea_text) DO NOTHING;

ALTER TABLE surprise_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_surprises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to surprise_ideas" ON surprise_ideas;
CREATE POLICY "Allow all access to surprise_ideas"
  ON surprise_ideas
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to monthly_surprises" ON monthly_surprises;
CREATE POLICY "Allow all access to monthly_surprises"
  ON monthly_surprises
  FOR ALL
  USING (true)
  WITH CHECK (true);
