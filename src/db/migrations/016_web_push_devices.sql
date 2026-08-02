-- Web Push (browser) support.
--
-- Browser subscriptions are stored in the same push_devices table as native
-- FCM/APNs tokens: the subscription endpoint URL goes in `token` (already UNIQUE),
-- and the two Web Push encryption keys (p256dh + auth, from PushSubscription) are
-- stored alongside it. They are NULL for native ('ios'/'android') devices.

ALTER TABLE push_devices DROP CONSTRAINT IF EXISTS push_devices_platform_check;
ALTER TABLE push_devices
  ADD CONSTRAINT push_devices_platform_check
  CHECK (platform IN ('ios', 'android', 'web'));

ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS p256dh TEXT;
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS auth TEXT;
