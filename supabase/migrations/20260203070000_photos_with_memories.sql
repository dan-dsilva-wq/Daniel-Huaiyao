-- Function to get photos from both map_photos and memory_photos for a place
-- This combines directly uploaded map photos with photos from memories tagged with that location

CREATE OR REPLACE FUNCTION get_place_photos_with_memories(
  p_place_id UUID,
  p_place_name TEXT
)
RETURNS TABLE (
  id UUID,
  storage_path TEXT,
  caption TEXT,
  taken_date DATE,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ,
  source TEXT,
  memory_title TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  -- Get map_photos (directly uploaded to this place)
  SELECT
    mp.id,
    mp.storage_path,
    mp.caption,
    mp.taken_date,
    mp.uploaded_by,
    mp.created_at,
    'map'::TEXT as source,
    NULL::TEXT as memory_title
  FROM map_photos mp
  WHERE mp.place_id = p_place_id

  UNION ALL

  -- Get memory_photos where the memory's location matches the place name
  -- This does a case-insensitive search for the place name in the memory's location
  SELECT
    mpf.id,
    mpf.photo_url as storage_path,
    COALESCE(mpf.caption, m.title) as caption,
    m.memory_date as taken_date,
    m.created_by as uploaded_by,
    mpf.created_at,
    'memory'::TEXT as source,
    m.title as memory_title
  FROM memory_photos mpf
  JOIN memories m ON mpf.memory_id = m.id
  WHERE m.location_name IS NOT NULL
    AND (
      -- Direct match: location contains place name
      m.location_name ILIKE '%' || p_place_name || '%'
      -- Or place name contains location (for when place is broader like "United Kingdom")
      OR p_place_name ILIKE '%' || m.location_name || '%'
    )

  ORDER BY taken_date DESC NULLS LAST, created_at DESC;
END;
$$;
