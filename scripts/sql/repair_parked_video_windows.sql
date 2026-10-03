-- Repair: video package months that were parked in the future.
--
-- Before the 25 Sep 2026 fix, a package bought while the current month had
-- 0 requests left was stacked AFTER that month, so it started weeks later and
-- the account stayed on "free - 0 of 3 left". This pulls each affected
-- account's future months forward so the earliest starts now; the lengths and
-- the order of the months are kept.
--
-- Affected = has no month usable right now, but has active future months.
-- Run the SELECT first to see who/what moves, then the UPDATE.

-- Preview
WITH affected AS (
  SELECT user_id, MIN(starts_at) AS first_start
    FROM video_allowance_windows
   WHERE status = 'active' AND remaining > 0 AND starts_at > NOW()
   GROUP BY user_id
  HAVING NOT EXISTS (
    SELECT 1 FROM video_allowance_windows u
     WHERE u.user_id = video_allowance_windows.user_id
       AND u.status = 'active' AND u.remaining > 0
       AND u.starts_at <= NOW() AND u.expires_at > NOW())
)
SELECT w.user_id, w.purchase_id, w.sequence, w.starts_at, w.expires_at,
       w.starts_at - (a.first_start - NOW()) AS new_starts_at,
       w.expires_at - (a.first_start - NOW()) AS new_expires_at
  FROM video_allowance_windows w
  JOIN affected a ON a.user_id = w.user_id
 WHERE w.status = 'active' AND w.starts_at > NOW()
 ORDER BY w.user_id, w.starts_at;

-- Apply
BEGIN;
WITH affected AS (
  SELECT user_id, MIN(starts_at) - NOW() AS shift
    FROM video_allowance_windows
   WHERE status = 'active' AND remaining > 0 AND starts_at > NOW()
   GROUP BY user_id
  HAVING NOT EXISTS (
    SELECT 1 FROM video_allowance_windows u
     WHERE u.user_id = video_allowance_windows.user_id
       AND u.status = 'active' AND u.remaining > 0
       AND u.starts_at <= NOW() AND u.expires_at > NOW())
)
UPDATE video_allowance_windows w
   SET starts_at = w.starts_at - a.shift,
       expires_at = w.expires_at - a.shift,
       updated_at = NOW()
  FROM affected a
 WHERE a.user_id = w.user_id
   AND w.status = 'active' AND w.starts_at > NOW();
COMMIT;
