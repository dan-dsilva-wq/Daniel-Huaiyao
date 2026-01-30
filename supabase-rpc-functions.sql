-- RPC Functions to bypass schema cache issue
-- Run this in Supabase SQL Editor

-- Function to get all categories with their ideas
CREATE OR REPLACE FUNCTION get_date_categories()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT json_agg(
      json_build_object(
        'id', c.id,
        'name', c.name,
        'emoji', c.emoji,
        'sort_order', c.sort_order,
        'ideas', COALESCE(
          (SELECT json_agg(
            json_build_object(
              'id', i.id,
              'title', i.title,
              'description', i.description,
              'emoji', i.emoji,
              'is_completed', i.is_completed
            ) ORDER BY i.created_at
          )
          FROM date_ideas i
          WHERE i.category_id = c.id
          ), '[]'::json
        )
      ) ORDER BY c.sort_order
    )
    FROM date_categories c
  );
END;
$$;

-- Function to add a new idea
CREATE OR REPLACE FUNCTION add_date_idea(
  p_category_id UUID,
  p_title TEXT,
  p_description TEXT DEFAULT NULL,
  p_emoji TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
BEGIN
  INSERT INTO date_ideas (category_id, title, description, emoji)
  VALUES (p_category_id, p_title, p_description, p_emoji)
  RETURNING json_build_object(
    'id', id,
    'category_id', category_id,
    'title', title,
    'description', description,
    'emoji', emoji,
    'is_completed', is_completed
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Function to remove an idea
CREATE OR REPLACE FUNCTION remove_date_idea(p_idea_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM date_ideas WHERE id = p_idea_id;
  RETURN FOUND;
END;
$$;

-- Function to toggle idea completion
CREATE OR REPLACE FUNCTION toggle_date_idea(p_idea_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
BEGIN
  UPDATE date_ideas
  SET is_completed = NOT is_completed,
      updated_at = NOW()
  WHERE id = p_idea_id
  RETURNING json_build_object(
    'id', id,
    'is_completed', is_completed
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Grant execute permissions to anon and authenticated roles
GRANT EXECUTE ON FUNCTION get_date_categories() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION add_date_idea(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION remove_date_idea(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION toggle_date_idea(UUID) TO anon, authenticated;
