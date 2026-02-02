-- Map Trip Planning tables

CREATE TABLE map_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'planning' CHECK (status IN ('planning', 'upcoming', 'completed', 'cancelled')),
  created_by TEXT NOT NULL CHECK (created_by IN ('daniel', 'huaiyao')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE map_trip_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES map_trips(id) ON DELETE CASCADE,
  place_id UUID REFERENCES map_places(id) ON DELETE SET NULL,
  custom_name TEXT,
  custom_lat DECIMAL,
  custom_lng DECIMAL,
  visit_order INTEGER DEFAULT 0,
  planned_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_map_trips_status ON map_trips(status);
CREATE INDEX idx_map_trips_dates ON map_trips(start_date, end_date);
CREATE INDEX idx_map_trip_places_trip ON map_trip_places(trip_id);
CREATE INDEX idx_map_trip_places_order ON map_trip_places(trip_id, visit_order);

-- RPC: Get all trips with places
CREATE OR REPLACE FUNCTION get_trips()
RETURNS JSON
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id', t.id,
      'name', t.name,
      'description', t.description,
      'start_date', t.start_date,
      'end_date', t.end_date,
      'status', t.status,
      'created_by', t.created_by,
      'created_at', t.created_at,
      'places', COALESCE((
        SELECT json_agg(json_build_object(
          'id', tp.id,
          'place_id', tp.place_id,
          'name', COALESCE(p.name, tp.custom_name),
          'lat', COALESCE(p.latitude, tp.custom_lat),
          'lng', COALESCE(p.longitude, tp.custom_lng),
          'visit_order', tp.visit_order,
          'planned_date', tp.planned_date,
          'notes', tp.notes
        ) ORDER BY tp.visit_order)
        FROM map_trip_places tp
        LEFT JOIN map_places p ON p.id = tp.place_id
        WHERE tp.trip_id = t.id
      ), '[]'::json),
      'place_count', (SELECT COUNT(*) FROM map_trip_places WHERE trip_id = t.id)
    ) ORDER BY
      CASE t.status
        WHEN 'upcoming' THEN 1
        WHEN 'planning' THEN 2
        WHEN 'completed' THEN 3
        WHEN 'cancelled' THEN 4
      END,
      t.start_date NULLS LAST
    )
    FROM map_trips t
  ), '[]'::json);
END;
$$;

-- RPC: Create a new trip
CREATE OR REPLACE FUNCTION create_trip(
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_created_by TEXT DEFAULT 'daniel'
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  INSERT INTO map_trips (name, description, start_date, end_date, created_by)
  VALUES (p_name, p_description, p_start_date, p_end_date, p_created_by)
  RETURNING json_build_object(
    'id', id,
    'name', name,
    'description', description,
    'start_date', start_date,
    'end_date', end_date,
    'status', status,
    'created_by', created_by
  ) INTO result;

  RETURN result;
END;
$$;

-- RPC: Update trip status
CREATE OR REPLACE FUNCTION update_trip_status(p_trip_id UUID, p_status TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE map_trips SET status = p_status WHERE id = p_trip_id;
  RETURN FOUND;
END;
$$;

-- RPC: Add place to trip
CREATE OR REPLACE FUNCTION add_trip_place(
  p_trip_id UUID,
  p_place_id UUID DEFAULT NULL,
  p_custom_name TEXT DEFAULT NULL,
  p_custom_lat DECIMAL DEFAULT NULL,
  p_custom_lng DECIMAL DEFAULT NULL,
  p_planned_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  next_order INTEGER;
  result JSON;
BEGIN
  -- Get next order
  SELECT COALESCE(MAX(visit_order), 0) + 1 INTO next_order
  FROM map_trip_places WHERE trip_id = p_trip_id;

  INSERT INTO map_trip_places (trip_id, place_id, custom_name, custom_lat, custom_lng, visit_order, planned_date, notes)
  VALUES (p_trip_id, p_place_id, p_custom_name, p_custom_lat, p_custom_lng, next_order, p_planned_date, p_notes)
  RETURNING json_build_object(
    'id', id,
    'place_id', place_id,
    'visit_order', visit_order,
    'planned_date', planned_date,
    'notes', notes
  ) INTO result;

  RETURN result;
END;
$$;

-- RPC: Reorder trip places
CREATE OR REPLACE FUNCTION reorder_trip_places(
  p_trip_id UUID,
  p_place_ids UUID[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  i INTEGER;
BEGIN
  FOR i IN 1..array_length(p_place_ids, 1)
  LOOP
    UPDATE map_trip_places
    SET visit_order = i
    WHERE id = p_place_ids[i] AND trip_id = p_trip_id;
  END LOOP;
  RETURN TRUE;
END;
$$;

-- RPC: Remove place from trip
CREATE OR REPLACE FUNCTION remove_trip_place(p_trip_place_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM map_trip_places WHERE id = p_trip_place_id;
  RETURN FOUND;
END;
$$;

-- RPC: Delete trip
CREATE OR REPLACE FUNCTION delete_trip(p_trip_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM map_trips WHERE id = p_trip_id;
  RETURN FOUND;
END;
$$;

-- Enable RLS
ALTER TABLE map_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_trip_places ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Allow all access to map_trips" ON map_trips FOR ALL USING (true);
CREATE POLICY "Allow all access to map_trip_places" ON map_trip_places FOR ALL USING (true);
