-- Map photos table for attaching photos to places
CREATE TABLE IF NOT EXISTS map_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id UUID NOT NULL REFERENCES map_places(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  caption TEXT,
  taken_date DATE,
  uploaded_by TEXT CHECK (uploaded_by IN ('daniel', 'huaiyao')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups by place
CREATE INDEX IF NOT EXISTS idx_map_photos_place_id ON map_photos(place_id);

-- Create map-photos storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'map-photos',
  'map-photos',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policy to allow public read access
CREATE POLICY IF NOT EXISTS "Allow public read map photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'map-photos');

-- Storage policy to allow authenticated uploads
CREATE POLICY IF NOT EXISTS "Allow map photo uploads"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'map-photos');

-- Storage policy to allow deletes
CREATE POLICY IF NOT EXISTS "Allow map photo deletes"
ON storage.objects FOR DELETE
USING (bucket_id = 'map-photos');

-- Function to get photos for a place
CREATE OR REPLACE FUNCTION get_place_photos(p_place_id UUID)
RETURNS TABLE(
  id UUID,
  storage_path TEXT,
  caption TEXT,
  taken_date DATE,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT mp.id, mp.storage_path, mp.caption, mp.taken_date, mp.uploaded_by, mp.created_at
  FROM map_photos mp
  WHERE mp.place_id = p_place_id
  ORDER BY COALESCE(mp.taken_date, mp.created_at::DATE) DESC;
END;
$$;

-- Function to add a photo
CREATE OR REPLACE FUNCTION add_place_photo(
  p_place_id UUID,
  p_storage_path TEXT,
  p_caption TEXT DEFAULT NULL,
  p_taken_date DATE DEFAULT NULL,
  p_uploaded_by TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO map_photos (place_id, storage_path, caption, taken_date, uploaded_by)
  VALUES (p_place_id, p_storage_path, p_caption, p_taken_date, p_uploaded_by)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Function to delete a photo
CREATE OR REPLACE FUNCTION delete_place_photo(p_photo_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM map_photos WHERE id = p_photo_id;
  RETURN true;
END;
$$;
