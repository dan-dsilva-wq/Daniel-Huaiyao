-- Map Schema for Daniel & Huaiyao
-- Run this in your Supabase SQL editor

-- Regions table
CREATE TABLE map_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  color_from TEXT NOT NULL,
  color_to TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- Places table
CREATE TABLE map_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id UUID REFERENCES map_regions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  country TEXT,
  status TEXT CHECK (status IN ('wishlist', 'visited')) DEFAULT 'wishlist',
  added_by TEXT CHECK (added_by IN ('daniel', 'huaiyao')),
  notes TEXT,
  visit_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed regions with gradients
INSERT INTO map_regions (code, display_name, color_from, color_to, sort_order) VALUES
  ('north-america', 'North America', 'from-blue-400', 'to-cyan-500', 1),
  ('south-america', 'South America', 'from-emerald-400', 'to-teal-500', 2),
  ('europe', 'Europe', 'from-purple-400', 'to-indigo-500', 3),
  ('africa', 'Africa', 'from-amber-400', 'to-orange-500', 4),
  ('asia', 'Asia', 'from-rose-400', 'to-pink-500', 5),
  ('oceania', 'Oceania', 'from-sky-400', 'to-blue-500', 6);

-- Enable RLS
ALTER TABLE map_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_places ENABLE ROW LEVEL SECURITY;

-- Policies for public access
CREATE POLICY "Allow public read on map_regions" ON map_regions FOR SELECT USING (true);
CREATE POLICY "Allow public read on map_places" ON map_places FOR SELECT USING (true);
CREATE POLICY "Allow public insert on map_places" ON map_places FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on map_places" ON map_places FOR UPDATE USING (true);
CREATE POLICY "Allow public delete on map_places" ON map_places FOR DELETE USING (true);

-- RPC function to get all regions with their places
CREATE OR REPLACE FUNCTION get_map_data()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT json_agg(
      json_build_object(
        'id', r.id,
        'code', r.code,
        'display_name', r.display_name,
        'color_from', r.color_from,
        'color_to', r.color_to,
        'places', COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', p.id,
                'name', p.name,
                'country', p.country,
                'status', p.status,
                'added_by', p.added_by,
                'notes', p.notes,
                'visit_date', p.visit_date,
                'created_at', p.created_at
              ) ORDER BY p.created_at DESC
            )
            FROM map_places p
            WHERE p.region_id = r.id
          ),
          '[]'::json
        )
      ) ORDER BY r.sort_order
    )
    FROM map_regions r
  );
END;
$$;

-- RPC function to add a place
CREATE OR REPLACE FUNCTION add_map_place(
  p_region_id UUID,
  p_name TEXT,
  p_country TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'wishlist',
  p_added_by TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_place map_places;
BEGIN
  INSERT INTO map_places (region_id, name, country, status, added_by, notes)
  VALUES (p_region_id, p_name, p_country, p_status, p_added_by, p_notes)
  RETURNING * INTO new_place;

  RETURN row_to_json(new_place);
END;
$$;

-- RPC function to toggle place status
CREATE OR REPLACE FUNCTION toggle_map_place_status(p_place_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_place map_places;
BEGIN
  UPDATE map_places
  SET status = CASE WHEN status = 'wishlist' THEN 'visited' ELSE 'wishlist' END,
      visit_date = CASE WHEN status = 'wishlist' THEN CURRENT_DATE ELSE NULL END
  WHERE id = p_place_id
  RETURNING * INTO updated_place;

  RETURN row_to_json(updated_place);
END;
$$;

-- RPC function to delete a place
CREATE OR REPLACE FUNCTION delete_map_place(p_place_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM map_places WHERE id = p_place_id;
  RETURN FOUND;
END;
$$;
