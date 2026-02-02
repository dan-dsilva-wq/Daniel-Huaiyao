-- Memory Timeline/Journal tables

-- Main memories table
CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by TEXT NOT NULL CHECK (created_by IN ('daniel', 'huaiyao')),
  memory_type TEXT NOT NULL CHECK (memory_type IN ('milestone', 'note', 'photo', 'moment')),
  title TEXT NOT NULL,
  description TEXT,
  memory_date DATE NOT NULL,
  location_name TEXT,
  location_lat DECIMAL,
  location_lng DECIMAL,
  is_pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Memory photos (multiple photos per memory)
CREATE TABLE memory_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  caption TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Memory tags for categorization
CREATE TABLE memory_tags (
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (memory_id, tag)
);

-- Indexes for performance
CREATE INDEX idx_memories_date ON memories(memory_date DESC);
CREATE INDEX idx_memories_created_by ON memories(created_by);
CREATE INDEX idx_memories_type ON memories(memory_type);
CREATE INDEX idx_memories_pinned ON memories(is_pinned) WHERE is_pinned = true;
CREATE INDEX idx_memory_photos_memory ON memory_photos(memory_id);
CREATE INDEX idx_memory_tags_tag ON memory_tags(tag);

-- RPC: Get memories with photos and tags
CREATE OR REPLACE FUNCTION get_memories(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_type TEXT DEFAULT NULL,
  p_tag TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'memories', COALESCE((
      SELECT json_agg(m ORDER BY m.is_pinned DESC, m.memory_date DESC)
      FROM (
        SELECT
          mem.id,
          mem.created_by,
          mem.memory_type,
          mem.title,
          mem.description,
          mem.memory_date,
          mem.location_name,
          mem.location_lat,
          mem.location_lng,
          mem.is_pinned,
          mem.created_at,
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', mp.id,
              'photo_url', mp.photo_url,
              'caption', mp.caption
            ) ORDER BY mp.sort_order)
            FROM memory_photos mp
            WHERE mp.memory_id = mem.id
          ), '[]'::json) as photos,
          COALESCE((
            SELECT json_agg(mt.tag)
            FROM memory_tags mt
            WHERE mt.memory_id = mem.id
          ), '[]'::json) as tags
        FROM memories mem
        WHERE (p_type IS NULL OR mem.memory_type = p_type)
          AND (p_tag IS NULL OR EXISTS (
            SELECT 1 FROM memory_tags mt2
            WHERE mt2.memory_id = mem.id AND mt2.tag = p_tag
          ))
        LIMIT p_limit
        OFFSET p_offset
      ) m
    ), '[]'::json),
    'total', (
      SELECT COUNT(*)
      FROM memories mem
      WHERE (p_type IS NULL OR mem.memory_type = p_type)
        AND (p_tag IS NULL OR EXISTS (
          SELECT 1 FROM memory_tags mt2
          WHERE mt2.memory_id = mem.id AND mt2.tag = p_tag
        ))
    ),
    'all_tags', COALESCE((
      SELECT json_agg(DISTINCT tag)
      FROM memory_tags
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

-- RPC: Add a new memory
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

-- RPC: Toggle pin status
CREATE OR REPLACE FUNCTION toggle_memory_pin(p_memory_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  new_status BOOLEAN;
BEGIN
  UPDATE memories
  SET is_pinned = NOT is_pinned
  WHERE id = p_memory_id
  RETURNING is_pinned INTO new_status;

  RETURN new_status;
END;
$$;

-- RPC: Delete a memory
CREATE OR REPLACE FUNCTION delete_memory(p_memory_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM memories WHERE id = p_memory_id;
  RETURN FOUND;
END;
$$;

-- RPC: Add photo to memory
CREATE OR REPLACE FUNCTION add_memory_photo(
  p_memory_id UUID,
  p_photo_url TEXT,
  p_caption TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  INSERT INTO memory_photos (memory_id, photo_url, caption, sort_order)
  VALUES (
    p_memory_id,
    p_photo_url,
    p_caption,
    (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM memory_photos WHERE memory_id = p_memory_id)
  )
  RETURNING json_build_object(
    'id', id,
    'photo_url', photo_url,
    'caption', caption
  ) INTO result;

  RETURN result;
END;
$$;

-- Enable RLS
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_tags ENABLE ROW LEVEL SECURITY;

-- RLS policies (allow all for now, can be restricted later)
CREATE POLICY "Allow all access to memories" ON memories FOR ALL USING (true);
CREATE POLICY "Allow all access to memory_photos" ON memory_photos FOR ALL USING (true);
CREATE POLICY "Allow all access to memory_tags" ON memory_tags FOR ALL USING (true);
