-- Allow both users to mark places independently
-- Change from single added_by to separate status columns for each user

-- Add new columns for dual status
ALTER TABLE map_places
ADD COLUMN IF NOT EXISTS daniel_status TEXT CHECK (daniel_status IN ('wishlist', 'visited')),
ADD COLUMN IF NOT EXISTS daniel_visit_date DATE,
ADD COLUMN IF NOT EXISTS huaiyao_status TEXT CHECK (huaiyao_status IN ('wishlist', 'visited')),
ADD COLUMN IF NOT EXISTS huaiyao_visit_date DATE;

-- Migrate existing data to new columns
UPDATE map_places
SET
  daniel_status = CASE WHEN added_by = 'daniel' THEN status ELSE NULL END,
  daniel_visit_date = CASE WHEN added_by = 'daniel' THEN visit_date ELSE NULL END,
  huaiyao_status = CASE WHEN added_by = 'huaiyao' THEN status ELSE NULL END,
  huaiyao_visit_date = CASE WHEN added_by = 'huaiyao' THEN visit_date ELSE NULL END
WHERE daniel_status IS NULL AND huaiyao_status IS NULL;

-- Update RPC to add place with dual status support
DROP FUNCTION IF EXISTS add_map_place(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION add_map_place(
  p_region_id UUID,
  p_name TEXT,
  p_country TEXT,
  p_location_key TEXT,
  p_status TEXT,
  p_added_by TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
  v_existing_id UUID;
BEGIN
  -- Check if place already exists
  SELECT id INTO v_existing_id
  FROM map_places
  WHERE location_key = p_location_key OR (name = p_name AND country = p_country);

  IF v_existing_id IS NOT NULL THEN
    -- Update existing place with this user's status
    IF p_added_by = 'daniel' THEN
      UPDATE map_places
      SET daniel_status = p_status,
          daniel_visit_date = CASE WHEN p_status = 'visited' THEN CURRENT_DATE ELSE NULL END
      WHERE id = v_existing_id;
    ELSE
      UPDATE map_places
      SET huaiyao_status = p_status,
          huaiyao_visit_date = CASE WHEN p_status = 'visited' THEN CURRENT_DATE ELSE NULL END
      WHERE id = v_existing_id;
    END IF;
    RETURN v_existing_id;
  END IF;

  -- Insert new place
  INSERT INTO map_places (region_id, name, country, location_key, status, added_by,
    daniel_status, daniel_visit_date, huaiyao_status, huaiyao_visit_date)
  VALUES (
    p_region_id, p_name, p_country, p_location_key, p_status, p_added_by,
    CASE WHEN p_added_by = 'daniel' THEN p_status ELSE NULL END,
    CASE WHEN p_added_by = 'daniel' AND p_status = 'visited' THEN CURRENT_DATE ELSE NULL END,
    CASE WHEN p_added_by = 'huaiyao' THEN p_status ELSE NULL END,
    CASE WHEN p_added_by = 'huaiyao' AND p_status = 'visited' THEN CURRENT_DATE ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Update toggle status to work with dual status
DROP FUNCTION IF EXISTS toggle_map_place_status(UUID);
DROP FUNCTION IF EXISTS toggle_map_place_status(UUID, TEXT);
CREATE OR REPLACE FUNCTION toggle_map_place_status(p_place_id UUID, p_player TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_status TEXT;
  v_new_status TEXT;
BEGIN
  -- If player specified, toggle that player's status
  IF p_player = 'daniel' THEN
    SELECT daniel_status INTO v_current_status FROM map_places WHERE id = p_place_id;
    v_new_status := CASE WHEN v_current_status = 'wishlist' THEN 'visited' ELSE 'wishlist' END;
    UPDATE map_places
    SET daniel_status = v_new_status,
        daniel_visit_date = CASE WHEN v_new_status = 'visited' THEN CURRENT_DATE ELSE NULL END
    WHERE id = p_place_id;
  ELSIF p_player = 'huaiyao' THEN
    SELECT huaiyao_status INTO v_current_status FROM map_places WHERE id = p_place_id;
    v_new_status := CASE WHEN v_current_status = 'wishlist' THEN 'visited' ELSE 'wishlist' END;
    UPDATE map_places
    SET huaiyao_status = v_new_status,
        huaiyao_visit_date = CASE WHEN v_new_status = 'visited' THEN CURRENT_DATE ELSE NULL END
    WHERE id = p_place_id;
  ELSE
    -- Legacy: toggle the old status field
    SELECT status INTO v_current_status FROM map_places WHERE id = p_place_id;
    v_new_status := CASE WHEN v_current_status = 'wishlist' THEN 'visited' ELSE 'wishlist' END;
    UPDATE map_places SET status = v_new_status WHERE id = p_place_id;
  END IF;

  RETURN v_new_status;
END;
$$;

-- Function to set a player's status for a place
DROP FUNCTION IF EXISTS set_place_status(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION set_place_status(
  p_place_id UUID,
  p_player TEXT,
  p_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_player = 'daniel' THEN
    UPDATE map_places
    SET daniel_status = p_status,
        daniel_visit_date = CASE WHEN p_status = 'visited' THEN CURRENT_DATE ELSE NULL END
    WHERE id = p_place_id;
  ELSIF p_player = 'huaiyao' THEN
    UPDATE map_places
    SET huaiyao_status = p_status,
        huaiyao_visit_date = CASE WHEN p_status = 'visited' THEN CURRENT_DATE ELSE NULL END
    WHERE id = p_place_id;
  END IF;
  RETURN TRUE;
END;
$$;

-- Function to clear a player's status for a place
DROP FUNCTION IF EXISTS clear_place_status(UUID, TEXT);
CREATE OR REPLACE FUNCTION clear_place_status(p_place_id UUID, p_player TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_player = 'daniel' THEN
    UPDATE map_places
    SET daniel_status = NULL, daniel_visit_date = NULL
    WHERE id = p_place_id;
  ELSIF p_player = 'huaiyao' THEN
    UPDATE map_places
    SET huaiyao_status = NULL, huaiyao_visit_date = NULL
    WHERE id = p_place_id;
  END IF;

  -- Delete place if neither user has a status
  DELETE FROM map_places
  WHERE id = p_place_id
    AND daniel_status IS NULL
    AND huaiyao_status IS NULL;

  RETURN TRUE;
END;
$$;

-- Update get_map_data to include dual status
DROP FUNCTION IF EXISTS get_map_data();
CREATE OR REPLACE FUNCTION get_map_data()
RETURNS JSON
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(
      json_build_object(
        'id', r.id,
        'code', r.code,
        'display_name', r.display_name,
        'color_from', r.color_from,
        'color_to', r.color_to,
        'places', COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', p.id,
              'name', p.name,
              'country', p.country,
              'location_key', p.location_key,
              'status', p.status,
              'added_by', p.added_by,
              'daniel_status', p.daniel_status,
              'daniel_visit_date', p.daniel_visit_date,
              'huaiyao_status', p.huaiyao_status,
              'huaiyao_visit_date', p.huaiyao_visit_date,
              'notes', p.notes,
              'visit_date', p.visit_date,
              'created_at', p.created_at
            )
          )
          FROM map_places p
          WHERE p.region_id = r.id
        ), '[]'::json)
      )
    ), '[]'::json)
    FROM map_regions r
    ORDER BY r.display_name
  );
END;
$$;
