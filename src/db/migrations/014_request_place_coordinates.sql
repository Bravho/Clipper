-- 014_request_place_coordinates.sql
--
-- Store the requester-confirmed place name and map coordinate. The application
-- treats place_name as an authoritative protected subtitle phrase.

ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS place_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE clip_requests
  DROP CONSTRAINT IF EXISTS clip_requests_place_name_not_blank,
  DROP CONSTRAINT IF EXISTS clip_requests_latitude_range,
  DROP CONSTRAINT IF EXISTS clip_requests_longitude_range,
  DROP CONSTRAINT IF EXISTS clip_requests_coordinates_pair;

ALTER TABLE clip_requests
  ADD CONSTRAINT clip_requests_place_name_not_blank
    CHECK (
      place_name IS NULL
      OR CHAR_LENGTH(BTRIM(place_name)) BETWEEN 1 AND 150
    ),
  ADD CONSTRAINT clip_requests_latitude_range
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT clip_requests_longitude_range
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT clip_requests_coordinates_pair
    CHECK (
      (latitude IS NULL AND longitude IS NULL)
      OR (latitude IS NOT NULL AND longitude IS NOT NULL)
    );

COMMENT ON COLUMN clip_requests.place_name IS
  'Requester-provided authoritative place/business name; protected from subtitle cue splitting.';
COMMENT ON COLUMN clip_requests.latitude IS
  'User-confirmed WGS84 latitude.';
COMMENT ON COLUMN clip_requests.longitude IS
  'User-confirmed WGS84 longitude.';

-- Existing rows need manual review/backfill before enforcing NOT NULL. After
-- every row is populated and the updated app is deployed, run:
--
-- ALTER TABLE clip_requests
--   ALTER COLUMN place_name SET NOT NULL,
--   ALTER COLUMN latitude SET NOT NULL,
--   ALTER COLUMN longitude SET NOT NULL;
