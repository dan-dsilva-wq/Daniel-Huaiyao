-- Map Memory Photos table

CREATE TABLE map_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id UUID NOT NULL REFERENCES map_places(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  caption TEXT,
  taken_date DATE,
  uploaded_by TEXT NOT NULL CHECK (uploaded_by IN ('daniel', 'huaiyao')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_map_photos_place ON map_photos(place_id);
CREATE INDEX idx_map_photos_date ON map_photos(taken_date DESC);

-- RPC: Get photos for a place
CREATE OR REPLACE FUNCTION get_place_photos(p_place_id UUID)
RETURNS JSON
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id', id,
      'storage_path', storage_path,
      'caption', caption,
      'taken_date', taken_date,
      'uploaded_by', uploaded_by,
      'created_at', created_at
    ) ORDER BY COALESCE(taken_date, created_at::date) DESC)
    FROM map_photos
    WHERE place_id = p_place_id
  ), '[]'::json);
END;
$$;

-- RPC: Add photo to place
CREATE OR REPLACE FUNCTION add_place_photo(
  p_place_id UUID,
  p_storage_path TEXT,
  p_caption TEXT DEFAULT NULL,
  p_taken_date DATE DEFAULT NULL,
  p_uploaded_by TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  INSERT INTO map_photos (place_id, storage_path, caption, taken_date, uploaded_by)
  VALUES (p_place_id, p_storage_path, p_caption, p_taken_date, COALESCE(p_uploaded_by, 'daniel'))
  RETURNING json_build_object(
    'id', id,
    'storage_path', storage_path,
    'caption', caption,
    'taken_date', taken_date,
    'uploaded_by', uploaded_by
  ) INTO result;

  RETURN result;
END;
$$;

-- RPC: Delete photo
CREATE OR REPLACE FUNCTION delete_place_photo(p_photo_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM map_photos WHERE id = p_photo_id;
  RETURN FOUND;
END;
$$;

-- Enable RLS
ALTER TABLE map_photos ENABLE ROW LEVEL SECURITY;

-- RLS policy
CREATE POLICY "Allow all access to map_photos" ON map_photos FOR ALL USING (true);
