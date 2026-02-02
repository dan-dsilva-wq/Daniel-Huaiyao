-- User profiles table
CREATE TABLE user_profiles (
  user_name TEXT PRIMARY KEY CHECK (user_name IN ('daniel', 'huaiyao')),
  display_name TEXT,
  emoji TEXT DEFAULT '😊',
  phone TEXT,
  birthday DATE,
  favorite_color TEXT,
  favorite_food TEXT,
  favorite_movie TEXT,
  favorite_song TEXT,
  bio TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default profiles
INSERT INTO user_profiles (user_name, display_name, emoji)
VALUES
  ('daniel', 'Daniel', '🦊'),
  ('huaiyao', 'Huaiyao', '🐰');

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read profiles
CREATE POLICY "Allow read access" ON user_profiles
  FOR SELECT USING (true);

-- Allow anyone to update profiles
CREATE POLICY "Allow update access" ON user_profiles
  FOR UPDATE USING (true);
