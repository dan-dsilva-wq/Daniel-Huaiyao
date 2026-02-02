-- Important dates table for countdown & anniversary tracker
CREATE TABLE important_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  event_date DATE NOT NULL,
  is_recurring BOOLEAN DEFAULT false,
  category TEXT CHECK (category IN ('anniversary', 'birthday', 'trip', 'event')) DEFAULT 'event',
  emoji TEXT DEFAULT '📅',
  notify_days_before INTEGER[] DEFAULT '{1, 7}',
  created_by TEXT CHECK (created_by IN ('daniel', 'huaiyao')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RPC to get important dates with calculated days until
CREATE OR REPLACE FUNCTION get_important_dates()
RETURNS TABLE (
  id UUID,
  title TEXT,
  event_date DATE,
  is_recurring BOOLEAN,
  category TEXT,
  emoji TEXT,
  notify_days_before INTEGER[],
  created_by TEXT,
  created_at TIMESTAMPTZ,
  days_until INTEGER,
  next_occurrence DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.title,
    d.event_date,
    d.is_recurring,
    d.category,
    d.emoji,
    d.notify_days_before,
    d.created_by,
    d.created_at,
    CASE
      WHEN d.is_recurring THEN
        CASE
          WHEN (d.event_date + (EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM d.event_date))::INTEGER * INTERVAL '1 year')::DATE >= CURRENT_DATE
          THEN ((d.event_date + (EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM d.event_date))::INTEGER * INTERVAL '1 year')::DATE - CURRENT_DATE)::INTEGER
          ELSE ((d.event_date + (EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM d.event_date) + 1)::INTEGER * INTERVAL '1 year')::DATE - CURRENT_DATE)::INTEGER
        END
      ELSE (d.event_date - CURRENT_DATE)::INTEGER
    END AS days_until,
    CASE
      WHEN d.is_recurring THEN
        CASE
          WHEN (d.event_date + (EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM d.event_date))::INTEGER * INTERVAL '1 year')::DATE >= CURRENT_DATE
          THEN (d.event_date + (EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM d.event_date))::INTEGER * INTERVAL '1 year')::DATE
          ELSE (d.event_date + (EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM d.event_date) + 1)::INTEGER * INTERVAL '1 year')::DATE
        END
      ELSE d.event_date
    END AS next_occurrence
  FROM important_dates d
  ORDER BY days_until ASC;
END;
$$ LANGUAGE plpgsql;

-- RPC to add a new important date
CREATE OR REPLACE FUNCTION add_important_date(
  p_title TEXT,
  p_event_date DATE,
  p_is_recurring BOOLEAN DEFAULT false,
  p_category TEXT DEFAULT 'event',
  p_emoji TEXT DEFAULT '📅',
  p_created_by TEXT DEFAULT 'daniel'
)
RETURNS UUID AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO important_dates (title, event_date, is_recurring, category, emoji, created_by)
  VALUES (p_title, p_event_date, p_is_recurring, p_category, p_emoji, p_created_by)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- RPC to delete an important date
CREATE OR REPLACE FUNCTION delete_important_date(p_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM important_dates WHERE id = p_id;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE important_dates ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (can be restricted later)
CREATE POLICY "Allow all access to important_dates"
  ON important_dates
  FOR ALL
  USING (true)
  WITH CHECK (true);
