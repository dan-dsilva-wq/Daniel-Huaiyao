-- Media items table
CREATE TABLE media_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_type TEXT CHECK (media_type IN ('movie', 'show', 'book', 'restaurant', 'recipe')) NOT NULL,
  title TEXT NOT NULL,
  status TEXT CHECK (status IN ('queue', 'in_progress', 'completed')) DEFAULT 'queue',
  added_by TEXT CHECK (added_by IN ('daniel', 'huaiyao')) NOT NULL,
  metadata JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Media ratings table
CREATE TABLE media_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID REFERENCES media_items(id) ON DELETE CASCADE NOT NULL,
  player TEXT CHECK (player IN ('daniel', 'huaiyao')) NOT NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5) NOT NULL,
  review TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(media_id, player)
);

-- RPC to get media items by type and status
CREATE OR REPLACE FUNCTION get_media_items(
  p_media_type TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  media_type TEXT,
  title TEXT,
  status TEXT,
  added_by TEXT,
  metadata JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ,
  daniel_rating INTEGER,
  daniel_review TEXT,
  huaiyao_rating INTEGER,
  huaiyao_review TEXT,
  avg_rating NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.media_type,
    m.title,
    m.status,
    m.added_by,
    m.metadata,
    m.notes,
    m.created_at,
    (SELECT r.rating FROM media_ratings r WHERE r.media_id = m.id AND r.player = 'daniel') AS daniel_rating,
    (SELECT r.review FROM media_ratings r WHERE r.media_id = m.id AND r.player = 'daniel') AS daniel_review,
    (SELECT r.rating FROM media_ratings r WHERE r.media_id = m.id AND r.player = 'huaiyao') AS huaiyao_rating,
    (SELECT r.review FROM media_ratings r WHERE r.media_id = m.id AND r.player = 'huaiyao') AS huaiyao_review,
    (SELECT AVG(r.rating)::NUMERIC(3,1) FROM media_ratings r WHERE r.media_id = m.id) AS avg_rating
  FROM media_items m
  WHERE (p_media_type IS NULL OR m.media_type = p_media_type)
    AND (p_status IS NULL OR m.status = p_status)
  ORDER BY
    CASE m.status
      WHEN 'in_progress' THEN 0
      WHEN 'queue' THEN 1
      WHEN 'completed' THEN 2
    END,
    m.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- RPC to add media item
CREATE OR REPLACE FUNCTION add_media_item(
  p_media_type TEXT,
  p_title TEXT,
  p_added_by TEXT,
  p_notes TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO media_items (media_type, title, added_by, notes, metadata)
  VALUES (p_media_type, p_title, p_added_by, p_notes, p_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- RPC to update media status
CREATE OR REPLACE FUNCTION update_media_status(
  p_media_id UUID,
  p_status TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE media_items
  SET status = p_status, updated_at = NOW()
  WHERE id = p_media_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- RPC to rate media
CREATE OR REPLACE FUNCTION rate_media(
  p_media_id UUID,
  p_player TEXT,
  p_rating INTEGER,
  p_review TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO media_ratings (media_id, player, rating, review)
  VALUES (p_media_id, p_player, p_rating, p_review)
  ON CONFLICT (media_id, player) DO UPDATE
  SET rating = p_rating, review = p_review
  RETURNING id INTO v_id;

  -- Auto-mark as completed if both rated
  IF (SELECT COUNT(*) FROM media_ratings WHERE media_id = p_media_id) = 2 THEN
    UPDATE media_items SET status = 'completed', updated_at = NOW() WHERE id = p_media_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- RPC to delete media item
CREATE OR REPLACE FUNCTION delete_media_item(p_media_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM media_items WHERE id = p_media_id;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE media_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to media_items" ON media_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to media_ratings" ON media_ratings FOR ALL USING (true) WITH CHECK (true);
