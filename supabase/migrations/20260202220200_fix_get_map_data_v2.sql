-- Fix get_map_data function - remove ORDER BY that causes GROUP BY error
DROP FUNCTION IF EXISTS get_map_data();

CREATE OR REPLACE FUNCTION get_map_data()
RETURNS JSON
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT json_agg(region_data ORDER BY region_data->>'display_name')
      FROM (
        SELECT json_build_object(
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
            ),
            '[]'::json
          )
        ) AS region_data
        FROM map_regions r
      ) subq
    ),
    '[]'::json
  );
$$;
