-- Supabase Schema for Couples' Shared Story Book
-- Run this in your Supabase SQL Editor to set up the database

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Book settings table
CREATE TABLE IF NOT EXISTS book_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT DEFAULT 'To be seen...',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Sentences/entries table
CREATE TABLE IF NOT EXISTS sentences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content TEXT NOT NULL,
  writer TEXT NOT NULL CHECK (writer IN ('daniel', 'huaiyao')),
  page_number INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS sentences_created_at_idx ON sentences(created_at);
CREATE INDEX IF NOT EXISTS sentences_writer_idx ON sentences(writer);

-- Enable Row Level Security (RLS)
ALTER TABLE sentences ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read sentences
CREATE POLICY "Anyone can read sentences"
  ON sentences
  FOR SELECT
  USING (true);

-- Policy: Anyone can insert sentences
CREATE POLICY "Anyone can insert sentences"
  ON sentences
  FOR INSERT
  WITH CHECK (true);

-- Policy: Anyone can read book settings
CREATE POLICY "Anyone can read book_settings"
  ON book_settings
  FOR SELECT
  USING (true);

-- Policy: Anyone can update book settings
CREATE POLICY "Anyone can update book_settings"
  ON book_settings
  FOR UPDATE
  USING (true);

-- Insert default book settings if not exists
INSERT INTO book_settings (title)
SELECT 'To be seen...'
WHERE NOT EXISTS (SELECT 1 FROM book_settings);

-- Enable Realtime for sentences table
ALTER PUBLICATION supabase_realtime ADD TABLE sentences;
