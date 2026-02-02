-- Fix get_map_data function to handle columns that may not exist yet
-- Drop any existing versions
DROP FUNCTION IF EXISTS get_map_data();

-- Ensure columns exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'map_places' AND column_name = 'daniel_status') THEN
    ALTER TABLE map_places ADD COLUMN daniel_status TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'map_places' AND column_name = 'daniel_visit_date') THEN
    ALTER TABLE map_places ADD COLUMN daniel_visit_date DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'map_places' AND column_name = 'huaiyao_status') THEN
    ALTER TABLE map_places ADD COLUMN huaiyao_status TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'map_places' AND column_name = 'huaiyao_visit_date') THEN
    ALTER TABLE map_places ADD COLUMN huaiyao_visit_date DATE;
  END IF;
END
$$;

-- Recreate get_map_data with dual status support
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
