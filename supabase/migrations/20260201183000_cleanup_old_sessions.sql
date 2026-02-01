-- Clean up old/stale mystery sessions
-- Delete sessions that are:
-- 1. Still "waiting" status (never started)
-- 2. "Active" but older than 24 hours (abandoned)

-- Delete old waiting sessions
DELETE FROM mystery_sessions
WHERE status = 'waiting'
  AND created_at < NOW() - INTERVAL '1 hour';

-- Delete abandoned active sessions (older than 24 hours)
DELETE FROM mystery_sessions
WHERE status = 'active'
  AND created_at < NOW() - INTERVAL '24 hours';

-- Also clean up any AI scenes/responses for deleted sessions (cascade should handle this, but just in case)
DELETE FROM mystery_ai_scenes
WHERE session_id NOT IN (SELECT id FROM mystery_sessions);

DELETE FROM mystery_ai_responses
WHERE session_id NOT IN (SELECT id FROM mystery_sessions);

DELETE FROM mystery_ai_history
WHERE session_id NOT IN (SELECT id FROM mystery_sessions);
