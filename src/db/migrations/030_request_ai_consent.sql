-- Request-scoped, affirmative consent recorded before third-party AI processing.
ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS ai_processing_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_consent_version TEXT,
  ADD COLUMN IF NOT EXISTS ai_consent_accepted_at TIMESTAMPTZ;

COMMENT ON COLUMN clip_requests.ai_processing_confirmed IS
  'Affirmative permission to send this request data to the AI providers disclosed in ai_consent_version.';
