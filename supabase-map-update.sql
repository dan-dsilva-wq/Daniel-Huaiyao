-- Run this if you already have the map tables created
-- This adds the missing location_key column and updates the RPC functions

-- Add location_key column if it doesn't exist
ALTER TABLE map_places ADD COLUMN IF NOT EXISTS location_key TEXT;

-- Update RPC function to get all regions with their places
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
                'location_key', p.location_key,
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

-- Update RPC function to add a place (with location_key parameter)
CREATE OR REPLACE FUNCTION add_map_place(
  p_region_id UUID,
  p_name TEXT,
  p_country TEXT DEFAULT NULL,
  p_location_key TEXT DEFAULT NULL,
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
  INSERT INTO map_places (region_id, name, country, location_key, status, added_by, notes)
  VALUES (p_region_id, p_name, p_country, p_location_key, p_status, p_added_by, p_notes)
  RETURNING * INTO new_place;

  RETURN row_to_json(new_place);
END;
$$;

-- Update RPC function to toggle place status
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

-- Update RPC function to delete a place
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
