-- Fix set_first_date function - remove reference to non-existent updated_at column
CREATE OR REPLACE FUNCTION set_first_date(p_date DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE relationship_stats SET first_date = p_date WHERE id = 'main';
  RETURN true;
END;
$$;
