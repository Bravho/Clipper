-- =============================================================================
-- Migration 003: Rename staff role to editor
-- Run this against your PostgreSQL database after deploying the code changes.
-- =============================================================================
-- NOTE: The actual constraint name may differ from 'users_role_check'.
-- Verify with: \d users
-- Then replace the constraint name below if needed.
-- =============================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'editor' WHERE role = 'staff';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('requester', 'editor', 'admin'));
