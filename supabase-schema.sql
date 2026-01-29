-- Date Ideas Schema for Supabase

-- Categories table
CREATE TABLE IF NOT EXISTS date_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Date ideas table
CREATE TABLE IF NOT EXISTS date_ideas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID REFERENCES date_categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  emoji TEXT,
  is_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notification rate limiting table
CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY DEFAULT 'date-ideas',
  last_sent TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initialize notification log
INSERT INTO notification_log (id, last_sent) VALUES ('date-ideas', NOW() - INTERVAL '1 hour')
ON CONFLICT (id) DO NOTHING;

-- Enable realtime for date_ideas
ALTER PUBLICATION supabase_realtime ADD TABLE date_ideas;
ALTER PUBLICATION supabase_realtime ADD TABLE date_categories;

-- Insert default categories
INSERT INTO date_categories (name, emoji, sort_order) VALUES
  ('Learn Things', '📚', 1),
  ('Feeling Adventurous', '🏔️', 2),
  ('Animals', '🦁', 3),
  ('Something Chilled', '😌', 4),
  ('Active & Fun', '🎯', 5),
  ('Silly Ideas', '🤪', 6),
  ('Other', '✨', 7);

-- Insert default ideas (you'll need to get category IDs after creating categories)
-- Run this after the categories are created:
/*
INSERT INTO date_ideas (category_id, title, description, emoji) VALUES
  ((SELECT id FROM date_categories WHERE name = 'Learn Things'), 'DND', 'Join a single season', NULL),
  ((SELECT id FROM date_categories WHERE name = 'Learn Things'), 'Dancing', 'Go to a dance lesson together', '🕺'),
  -- ... add more ideas
*/
