-- Event Planning feature: timeline, checklist, and notes for countdown events
-- Safe to re-run (all statements are idempotent)

-- Add notes columns to important_dates
ALTER TABLE important_dates ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE important_dates ADD COLUMN IF NOT EXISTS notes_updated_by TEXT CHECK (notes_updated_by IN ('daniel', 'huaiyao'));
ALTER TABLE important_dates ADD COLUMN IF NOT EXISTS notes_updated_at TIMESTAMPTZ;

-- Timeline items for event day-of schedule
CREATE TABLE IF NOT EXISTS event_timeline_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES important_dates(id) ON DELETE CASCADE,
  time_slot TIME NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  sort_order INTEGER DEFAULT 0,
  created_by TEXT CHECK (created_by IN ('daniel', 'huaiyao')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE event_timeline_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_timeline_items' AND policyname = 'Allow all access to event_timeline_items') THEN
    CREATE POLICY "Allow all access to event_timeline_items"
      ON event_timeline_items FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Checklist items for event planning
CREATE TABLE IF NOT EXISTS event_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES important_dates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_checked BOOLEAN DEFAULT false,
  checked_by TEXT CHECK (checked_by IN ('daniel', 'huaiyao')),
  checked_at TIMESTAMPTZ,
  created_by TEXT CHECK (created_by IN ('daniel', 'huaiyao')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE event_checklist_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_checklist_items' AND policyname = 'Allow all access to event_checklist_items') THEN
    CREATE POLICY "Allow all access to event_checklist_items"
      ON event_checklist_items FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 1. Get full event plan (timeline + checklist + notes)
CREATE OR REPLACE FUNCTION get_event_plan(p_event_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'timeline', COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.time_slot, t.sort_order)
      FROM event_timeline_items t
      WHERE t.event_id = p_event_id
    ), '[]'::json),
    'checklist', COALESCE((
      SELECT json_agg(row_to_json(c) ORDER BY c.created_at)
      FROM event_checklist_items c
      WHERE c.event_id = p_event_id
    ), '[]'::json),
    'notes', d.notes,
    'notes_updated_by', d.notes_updated_by,
    'notes_updated_at', d.notes_updated_at
  ) INTO result
  FROM important_dates d
  WHERE d.id = p_event_id;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 2. Add timeline item
CREATE OR REPLACE FUNCTION add_timeline_item(
  p_event_id UUID,
  p_time_slot TIME,
  p_title TEXT,
  p_description TEXT DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT 'daniel'
)
RETURNS JSON AS $$
DECLARE
  new_row event_timeline_items;
BEGIN
  INSERT INTO event_timeline_items (event_id, time_slot, title, description, location, created_by)
  VALUES (p_event_id, p_time_slot, p_title, p_description, p_location, p_created_by)
  RETURNING * INTO new_row;
  RETURN row_to_json(new_row);
END;
$$ LANGUAGE plpgsql;

-- 3. Delete timeline item
CREATE OR REPLACE FUNCTION delete_timeline_item(p_item_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM event_timeline_items WHERE id = p_item_id;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- 4. Add checklist item
CREATE OR REPLACE FUNCTION add_checklist_item(
  p_event_id UUID,
  p_title TEXT,
  p_created_by TEXT DEFAULT 'daniel'
)
RETURNS JSON AS $$
DECLARE
  new_row event_checklist_items;
BEGIN
  INSERT INTO event_checklist_items (event_id, title, created_by)
  VALUES (p_event_id, p_title, p_created_by)
  RETURNING * INTO new_row;
  RETURN row_to_json(new_row);
END;
$$ LANGUAGE plpgsql;

-- 5. Toggle checklist item
CREATE OR REPLACE FUNCTION toggle_checklist_item(p_item_id UUID, p_checked_by TEXT DEFAULT 'daniel')
RETURNS JSON AS $$
DECLARE
  updated_row event_checklist_items;
BEGIN
  UPDATE event_checklist_items
  SET
    is_checked = NOT is_checked,
    checked_by = CASE WHEN NOT is_checked THEN p_checked_by ELSE NULL END,
    checked_at = CASE WHEN NOT is_checked THEN NOW() ELSE NULL END
  WHERE id = p_item_id
  RETURNING * INTO updated_row;
  RETURN row_to_json(updated_row);
END;
$$ LANGUAGE plpgsql;

-- 6. Delete checklist item
CREATE OR REPLACE FUNCTION delete_checklist_item(p_item_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM event_checklist_items WHERE id = p_item_id;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- 7. Update timeline item
CREATE OR REPLACE FUNCTION update_timeline_item(
  p_item_id UUID,
  p_time_slot TIME,
  p_title TEXT,
  p_description TEXT DEFAULT NULL,
  p_location TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  updated_row event_timeline_items;
BEGIN
  UPDATE event_timeline_items
  SET time_slot = p_time_slot,
      title = p_title,
      description = p_description,
      location = p_location
  WHERE id = p_item_id
  RETURNING * INTO updated_row;
  RETURN row_to_json(updated_row);
END;
$$ LANGUAGE plpgsql;

-- 8. Update checklist item title
CREATE OR REPLACE FUNCTION update_checklist_item(
  p_item_id UUID,
  p_title TEXT
)
RETURNS JSON AS $$
DECLARE
  updated_row event_checklist_items;
BEGIN
  UPDATE event_checklist_items
  SET title = p_title
  WHERE id = p_item_id
  RETURNING * INTO updated_row;
  RETURN row_to_json(updated_row);
END;
$$ LANGUAGE plpgsql;

-- 9. Update event notes
CREATE OR REPLACE FUNCTION update_event_notes(
  p_event_id UUID,
  p_notes TEXT,
  p_updated_by TEXT DEFAULT 'daniel'
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE important_dates
  SET notes = p_notes,
      notes_updated_by = p_updated_by,
      notes_updated_at = NOW()
  WHERE id = p_event_id;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;
