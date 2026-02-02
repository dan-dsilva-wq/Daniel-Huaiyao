-- Update add_memory function to accept lat/lng coordinates
DROP FUNCTION IF EXISTS add_memory(TEXT, TEXT, TEXT, TEXT, DATE, TEXT, DECIMAL, DECIMAL, TEXT[]);
DROP FUNCTION IF EXISTS add_memory(TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION add_memory(
  p_created_by TEXT,
  p_memory_type TEXT,
  p_title TEXT,
  p_description TEXT DEFAULT NULL,
  p_memory_date DATE DEFAULT CURRENT_DATE,
  p_location_name TEXT DEFAULT NULL,
  p_location_lat DECIMAL DEFAULT NULL,
  p_location_lng DECIMAL DEFAULT NULL,
  p_tags TEXT[] DEFAULT '{}'
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  new_memory_id UUID;
  result JSON;
BEGIN
  -- Insert the memory
  INSERT INTO memories (
    created_by, memory_type, title, description,
    memory_date, location_name, location_lat, location_lng
  )
  VALUES (
    p_created_by, p_memory_type, p_title, p_description,
    p_memory_date, p_location_name, p_location_lat, p_location_lng
  )
  RETURNING id INTO new_memory_id;

  -- Insert tags
  IF array_length(p_tags, 1) > 0 THEN
    INSERT INTO memory_tags (memory_id, tag)
    SELECT new_memory_id, unnest(p_tags);
  END IF;

  -- Return the new memory
  SELECT json_build_object(
    'id', m.id,
    'created_by', m.created_by,
    'memory_type', m.memory_type,
    'title', m.title,
    'description', m.description,
    'memory_date', m.memory_date,
    'location_name', m.location_name,
    'location_lat', m.location_lat,
    'location_lng', m.location_lng,
    'is_pinned', m.is_pinned,
    'created_at', m.created_at,
    'photos', '[]'::json,
    'tags', COALESCE((
      SELECT json_agg(mt.tag)
      FROM memory_tags mt
      WHERE mt.memory_id = m.id
    ), '[]'::json)
  ) INTO result
  FROM memories m
  WHERE m.id = new_memory_id;

  RETURN result;
END;
$$;
