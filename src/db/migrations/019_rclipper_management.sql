-- Migration 019: RClipper Management
--
-- A paid area of the requester dashboard where videos are collected, then
-- published to the user's OWN social accounts through a publishing provider
-- (Post for Me).
--
-- CONTENT ENTERS TWO WAYS, both free:
--   1. TRANSFER — a completed RClipper generation project is copied in. The
--      transfer is free and entirely optional; the existing download flow is
--      unaffected whether or not a user ever transfers.
--   2. UPLOAD  — the user uploads their own video. RClipper Management is
--      therefore useful on its own, as a multi-channel publish-and-manage tool,
--      not only as an extension of the generator.
--
-- PAYMENT HAPPENS AT PUBLISH TIME, not at transfer time. Collecting, organising
-- and previewing content costs nothing. Money is only required immediately
-- before a video is actually submitted to social channels.
--
--   management_single_video   — unlocks ONE content item for publishing,
--                               permanently. Re-publishing and publishing to
--                               further channels later never costs again.
--   management_access_*       — unlimited publishing while the pass is active.
--
-- Paid with CREDITS (1 credit = ฿1). Credits reach the wallet only through the
-- existing verified rails — the signed Stripe webhook on web, and Apple /
-- Google receipt verification in the native shells — so this adds no payment
-- provider and no payment webhook, and stays store-policy compliant.
--
-- EVERY PRODUCT IS ONE-TIME. There is no subscription table, no renewal
-- timestamp, and no column that could drive an automatic charge. When a pass
-- expires nothing is billed and nothing is deleted; only NEW publications stop
-- being permitted.
--
-- MEDIA RETENTION: stored video is kept for a limited window
-- (`media_expires_at`, default 90 days) and then purged, while the content
-- record and its publishing history are kept indefinitely. A permanent unlock
-- therefore outlives its media — by design, so a user who paid can re-upload a
-- replacement into the same item at no further cost.
--
-- TYPE NOTES — READ BEFORE EDITING THE FOREIGN KEYS
--   users.id            UUID (created by the Phase 2A migrations, always uuid)
--   clip_requests.id    uuid OR text — DEPENDS ON THE DATABASE
--   uploaded_assets.id  uuid OR text — DEPENDS ON THE DATABASE
--   credits             INTEGER, 1 credit = ฿1 (see config/credits.ts)
--
--   migrations/002 declares the Phase 2B ids as TEXT, but the live type varies by
--   how the database was originally created — migration 006 states this outright
--   and inspects information_schema for the same reason. A foreign key must match
--   its target's type exactly, so the two columns referencing those tables
--   (management_content_items.source_generation_id and
--   management_content_assets.source_video_id) are added in type-aware DO blocks
--   rather than declared inline. Do NOT "simplify" them back to a literal type.
--
-- Idempotent: safe to run more than once.
--
-- Apply with:
--   node scripts/apply-migration.js src/db/migrations/019_rclipper_management.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 0. Clean up an earlier draft of this migration ───────────────────────────
-- An earlier revision gated payment at TRANSFER time and had a
-- `management_single_transfer_entitlements` table. Payment moved to publish
-- time, so that concept no longer exists. Dropped only when present AND empty,
-- so this can never destroy real data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'management_single_transfer_entitlements'
  ) THEN
    IF (SELECT COUNT(*) FROM management_single_transfer_entitlements) = 0 THEN
      DROP TABLE management_single_transfer_entitlements CASCADE;
      RAISE NOTICE 'Dropped empty management_single_transfer_entitlements (superseded).';
    ELSE
      RAISE EXCEPTION
        'management_single_transfer_entitlements has rows — migrate them to management_publish_entitlements before re-running.';
    END IF;
  END IF;
END $$;

-- ── 1. Credit ledger vocabulary ──────────────────────────────────────────────
-- Management spend and refunds get their own ledger types so they are
-- distinguishable from clip charges in reporting. The CHECK is rebuilt because
-- Postgres has no ADD VALUE for a CHECK constraint.
ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_type_check CHECK (
    type IN (
      'signup_bonus', 'request_charge', 'request_refund',
      'admin_credit', 'admin_debit', 'discount_applied', 'top_up',
      'management_purchase', 'management_refund'
    )
  );

-- ── 2. Products (trusted price source) ───────────────────────────────────────
-- The client sends a product CODE and nothing else. Amount, duration, currency
-- and entitlement type are always resolved from this table.
CREATE TABLE IF NOT EXISTS management_products (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT        NOT NULL UNIQUE,
  name               TEXT        NOT NULL,
  description        TEXT        NOT NULL DEFAULT '',
  product_type       TEXT        NOT NULL
                     CHECK (product_type IN ('single_video', 'access_pass')),
  -- NULL for the single-video unlock; 3, 6 or 12 for the access passes.
  duration_months    INTEGER
                     CHECK (duration_months IS NULL OR duration_months > 0),
  price_credits      INTEGER     NOT NULL CHECK (price_credits > 0),
  full_price_credits INTEGER     NOT NULL CHECK (full_price_credits > 0),
  currency           TEXT        NOT NULL DEFAULT 'THB',
  is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order         INTEGER     NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT management_products_duration_matches_type CHECK (
    (product_type = 'single_video' AND duration_months IS NULL) OR
    (product_type = 'access_pass'  AND duration_months IS NOT NULL)
  )
);

-- Older drafts used product_type 'single_transfer'. Widen the constraint before
-- re-seeding so a re-run cannot fail on a stale row.
UPDATE management_products
   SET product_type = 'single_video', code = 'management_single_video'
 WHERE code = 'management_single_transfer';

-- Seed / re-sync the four products. Prices are the launch (50 % off) rates;
-- full_price_credits carries the list price so the UI can show the saving.
INSERT INTO management_products
  (code, name, description, product_type, duration_months,
   price_credits, full_price_credits, sort_order)
VALUES
  ('management_single_video',
   'Single Video',
   'Unlock one video for publishing. One-time payment, no expiry on the unlock.',
   'single_video', NULL, 50, 100, 1),
  ('management_access_3_months',
   '3-Month Access',
   'Prepaid unlimited publishing for 3 months. No automatic renewal.',
   'access_pass', 3, 300, 600, 2),
  ('management_access_6_months',
   '6-Month Access',
   'Prepaid unlimited publishing for 6 months. No automatic renewal.',
   'access_pass', 6, 550, 1100, 3),
  ('management_access_1_year',
   '1-Year Access',
   'Prepaid unlimited publishing for 1 year. No automatic renewal.',
   'access_pass', 12, 1000, 2000, 4)
ON CONFLICT (code) DO UPDATE SET
  name               = EXCLUDED.name,
  description        = EXCLUDED.description,
  product_type       = EXCLUDED.product_type,
  duration_months    = EXCLUDED.duration_months,
  price_credits      = EXCLUDED.price_credits,
  full_price_credits = EXCLUDED.full_price_credits,
  sort_order         = EXCLUDED.sort_order,
  updated_at         = NOW();

-- ── 3. Content items ─────────────────────────────────────────────────────────
-- Created FREE, by transfer or by upload. `source_type` is the discriminator.
--
-- NOTE ON ID TYPES: the Phase 2B tables (clip_requests, uploaded_assets) declare
-- `id TEXT` in migrations/002, but the LIVE type may be `uuid` or `text`
-- depending on how the database was originally created — migration 006 says so
-- explicitly and inspects information_schema for exactly this reason. A foreign
-- key must match its target's type, so the two columns that reference those
-- tables are added in type-aware DO blocks below rather than declared inline.
CREATE TABLE IF NOT EXISTS management_content_items (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  source_type           TEXT        NOT NULL DEFAULT 'rclipper_generation'
                        CHECK (source_type IN ('rclipper_generation', 'user_upload')),

  title                 TEXT        NOT NULL,
  description           TEXT,
  -- Stable Spaces key. Signed URLs are derived on read, never persisted.
  thumbnail_storage_key TEXT,

  status                TEXT        NOT NULL DEFAULT 'ready'
                        CHECK (status IN ('uploading','ready','draft','scheduled','publishing',
                                          'partially_published','published','failed',
                                          'media_expired','cancelled')),

  -- Media retention. The RECORD is kept indefinitely; the FILE is not.
  -- Set on creation to now + RCLIPPER_MANAGEMENT_MEDIA_RETENTION_DAYS.
  media_expires_at      TIMESTAMPTZ,
  media_deleted_at      TIMESTAMPTZ,

  transferred_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- source_generation_id: NULLABLE (an uploaded video has no clip request), typed
-- to match clip_requests.id, ON DELETE SET NULL so purging an old generation
-- project does not destroy Management history.
DO $$
DECLARE dt text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'management_content_items'
       AND column_name = 'source_generation_id'
  ) THEN
    SELECT data_type INTO dt
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'clip_requests' AND column_name = 'id';

    IF dt IS NULL THEN
      RAISE EXCEPTION
        'clip_requests.id not found — apply the Phase 2B migrations before 019.';
    END IF;

    EXECUTE format(
      'ALTER TABLE management_content_items
         ADD COLUMN source_generation_id %s
         REFERENCES clip_requests(id) ON DELETE SET NULL',
      CASE WHEN dt = 'uuid' THEN 'UUID' ELSE 'TEXT' END
    );
    RAISE NOTICE 'Added management_content_items.source_generation_id as % (matching clip_requests.id)', dt;
  END IF;
END $$;

-- A transferred item must name its source; an upload must not. Added separately
-- because it references the column created above.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'management_content_source_matches_type'
  ) THEN
    ALTER TABLE management_content_items
      ADD CONSTRAINT management_content_source_matches_type CHECK (
        (source_type = 'rclipper_generation' AND source_generation_id IS NOT NULL) OR
        (source_type = 'user_upload'         AND source_generation_id IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mgmt_content_user   ON management_content_items(user_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_content_status ON management_content_items(status);
CREATE INDEX IF NOT EXISTS idx_mgmt_content_type   ON management_content_items(source_type);
CREATE INDEX IF NOT EXISTS idx_mgmt_content_media_expiry
  ON management_content_items(media_expires_at)
  WHERE media_deleted_at IS NULL;

-- Transfer idempotency: one live item per (user, generation). The WHERE clause
-- excludes uploads (NULL source) entirely, so a user may upload as many videos
-- as they like while a project can still only be transferred once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mgmt_content_per_source
  ON management_content_items(user_id, source_generation_id)
  WHERE source_generation_id IS NOT NULL AND status <> 'cancelled';

-- ── 4. Purchases (accounting) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS management_purchases (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  management_product_id UUID        NOT NULL REFERENCES management_products(id),
  product_code          TEXT        NOT NULL,
  -- The item being unlocked, for a single-video purchase. NULL for a pass,
  -- which is not tied to any one video.
  management_content_id UUID REFERENCES management_content_items(id) ON DELETE SET NULL,
  status                TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','paid','failed','refunded')),
  amount_credits        INTEGER     NOT NULL CHECK (amount_credits >= 0),
  currency              TEXT        NOT NULL DEFAULT 'THB',
  -- UNIQUE: the guard against a double-clicked or replayed checkout debiting
  -- the wallet twice. For a single-video unlock this is derived from
  -- (user, product, content), so it is naturally unrepeatable.
  idempotency_key       TEXT        NOT NULL UNIQUE,
  credit_transaction_id UUID,
  paid_at               TIMESTAMPTZ,
  failure_reason        TEXT,
  refunded_at           TIMESTAMPTZ,
  refund_credit_transaction_id UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgmt_purchases_user    ON management_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_purchases_status  ON management_purchases(status);
CREATE INDEX IF NOT EXISTS idx_mgmt_purchases_content ON management_purchases(management_content_id);

-- ── 5. Access passes ─────────────────────────────────────────────────────────
-- ONE ROW PER PURCHASE — never mutated to extend. Buying another pass inserts a
-- new row starting at the later of NOW() and the current effective expiry, so
-- remaining paid time is preserved (expiry 31 Dec + a 3-month pass bought 1 Dec
-- => new row 31 Dec -> 31 Mar). Effective access = MAX(expires_at) over active
-- rows. An active pass permits UNLIMITED publishing.
CREATE TABLE IF NOT EXISTS management_access_passes (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  management_product_id UUID        NOT NULL REFERENCES management_products(id),
  product_code          TEXT        NOT NULL,
  -- One pass per purchase: the guard against a replayed activation granting two
  -- windows of access for a single payment.
  purchase_id           UUID        NOT NULL UNIQUE
                        REFERENCES management_purchases(id) ON DELETE CASCADE,
  credit_transaction_id UUID,
  status                TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('pending','active','expired','revoked','refunded')),
  starts_at             TIMESTAMPTZ NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  revoked_at            TIMESTAMPTZ,
  revoked_reason        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT management_access_passes_window CHECK (expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_mgmt_passes_user    ON management_access_passes(user_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_passes_status  ON management_access_passes(status);
CREATE INDEX IF NOT EXISTS idx_mgmt_passes_expires ON management_access_passes(expires_at);
CREATE INDEX IF NOT EXISTS idx_mgmt_passes_user_active
  ON management_access_passes(user_id, expires_at)
  WHERE status = 'active';

-- ── 6. Publish entitlements (the single-video unlock) ────────────────────────
-- PERMANENT. Unlocks one content item for publishing forever: re-publishing,
-- adding channels later, and retrying a failed publication all cost nothing
-- more. It deliberately outlives the stored media, so a user whose file has
-- been purged can upload a replacement into the same item without paying again.
CREATE TABLE IF NOT EXISTS management_publish_entitlements (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  management_content_id UUID        NOT NULL
                        REFERENCES management_content_items(id) ON DELETE CASCADE,
  management_product_id UUID        NOT NULL REFERENCES management_products(id),
  purchase_id           UUID        NOT NULL UNIQUE
                        REFERENCES management_purchases(id) ON DELETE CASCADE,
  credit_transaction_id UUID,
  status                TEXT        NOT NULL DEFAULT 'paid'
                        CHECK (status IN ('paid','refunded','revoked')),
  revoked_at            TIMESTAMPTZ,
  revoked_reason        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgmt_publish_ent_user ON management_publish_entitlements(user_id);

-- At most ONE live unlock per content item, so a user cannot be charged twice
-- for the same video. Refunded and revoked rows are excluded, leaving a
-- legitimate re-purchase after a refund possible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mgmt_publish_ent_live_per_content
  ON management_publish_entitlements(management_content_id)
  WHERE status = 'paid';

-- ── 7. Content assets (the publishable video variants) ───────────────────────
CREATE TABLE IF NOT EXISTS management_content_assets (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  management_content_id UUID        NOT NULL
                        REFERENCES management_content_items(id) ON DELETE CASCADE,
  -- Which channel/ratio this variant serves ("9:16", "tiktok", "original"...).
  platform_variant      TEXT        NOT NULL,
  storage_key           TEXT        NOT NULL,
  mime_type             TEXT,
  width                 INTEGER,
  height                INTEGER,
  duration_seconds      NUMERIC(10,3),
  aspect_ratio          TEXT,
  original_filename     TEXT,
  file_size_bytes       BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mgmt_asset_variant UNIQUE (management_content_id, platform_variant)
);

-- source_video_id: NULLABLE and typed to match uploaded_assets.id (see the note
-- in section 3 — the live type may be uuid or text).
--
-- A transferred variant points at the generated uploaded_assets row, so media is
-- REFERENCED, never duplicated. A user-uploaded video has no clip request and
-- therefore no uploaded_assets row, and relies on storage_key alone.
-- ON DELETE SET NULL so purging generated media leaves the Management record.
DO $$
DECLARE dt text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'management_content_assets'
       AND column_name = 'source_video_id'
  ) THEN
    SELECT data_type INTO dt
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'uploaded_assets' AND column_name = 'id';

    IF dt IS NULL THEN
      RAISE EXCEPTION
        'uploaded_assets.id not found — apply the Phase 2B migrations before 019.';
    END IF;

    EXECUTE format(
      'ALTER TABLE management_content_assets
         ADD COLUMN source_video_id %s
         REFERENCES uploaded_assets(id) ON DELETE SET NULL',
      CASE WHEN dt = 'uuid' THEN 'UUID' ELSE 'TEXT' END
    );
    RAISE NOTICE 'Added management_content_assets.source_video_id as % (matching uploaded_assets.id)', dt;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mgmt_assets_content ON management_content_assets(management_content_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_assets_source  ON management_content_assets(source_video_id);

-- Retention pin on the generator's own media. The clip-request sweep purges
-- generated media on the ordinary availability window, but a transferred item
-- keeps its own, longer window and may have a post scheduled weeks out. The
-- sweep must skip anything pinned here.
ALTER TABLE uploaded_assets
  ADD COLUMN IF NOT EXISTS retention_pinned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_uploaded_assets_retention_pinned
  ON uploaded_assets(retention_pinned) WHERE retention_pinned = TRUE;

-- ── 8. Social connections ────────────────────────────────────────────────────
-- Identifiers and display metadata ONLY. Provider access/refresh tokens are
-- dropped at the provider boundary and never stored. No social passwords, ever.
CREATE TABLE IF NOT EXISTS social_connections (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                 TEXT        NOT NULL DEFAULT 'post_for_me',
  provider_account_id      TEXT,
  provider_project_id      TEXT,
  platform                 TEXT        NOT NULL,
  account_name             TEXT,
  account_username         TEXT,
  avatar_url               TEXT,
  connection_status        TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (connection_status IN ('pending','connected','disconnected','removed')),
  provider_metadata        JSONB,
  -- Single-use signed correlation token, hashed. Stops one user claiming
  -- another user's OAuth callback.
  connect_state_hash       TEXT,
  connect_state_expires_at TIMESTAMPTZ,
  connected_at             TIMESTAMPTZ,
  last_synced_at           TIMESTAMPTZ,
  disconnected_at          TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_conn_user   ON social_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_social_conn_status ON social_connections(connection_status);
CREATE INDEX IF NOT EXISTS idx_social_conn_state  ON social_connections(connect_state_hash)
  WHERE connect_state_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_conn_user_account
  ON social_connections(user_id, provider, provider_account_id)
  WHERE provider_account_id IS NOT NULL;

-- ── 9. Publications and their destinations ───────────────────────────────────
CREATE TABLE IF NOT EXISTS management_publications (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  management_content_id UUID        NOT NULL
                        REFERENCES management_content_items(id) ON DELETE CASCADE,
  publish_mode          TEXT        NOT NULL
                        CHECK (publish_mode IN ('publish_now','scheduled')),
  -- Always UTC. The user's chosen zone is stored alongside for display only.
  scheduled_at          TIMESTAMPTZ,
  timezone              TEXT,
  status                TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','scheduled','publishing',
                                          'partially_published','published','failed','cancelled')),
  -- WHAT AUTHORISED THIS, snapshotted at creation. A scheduled post must still
  -- go out if the pass that paid for it lapses before the send time — the user
  -- already paid, so entitlement is consumed when the publication is created,
  -- never re-checked when it fires.
  entitlement_type      TEXT        NOT NULL DEFAULT 'none'
                        CHECK (entitlement_type IN ('single_video','three_months',
                                                    'six_months','one_year','none')),
  access_pass_id        UUID REFERENCES management_access_passes(id) ON DELETE SET NULL,
  publish_entitlement_id UUID REFERENCES management_publish_entitlements(id) ON DELETE SET NULL,
  provider_post_id      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT management_publications_schedule_present CHECK (
    publish_mode = 'publish_now' OR scheduled_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_mgmt_pub_user      ON management_publications(user_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_pub_content   ON management_publications(management_content_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_pub_status    ON management_publications(status);
CREATE INDEX IF NOT EXISTS idx_mgmt_pub_scheduled ON management_publications(scheduled_at)
  WHERE scheduled_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS management_publication_targets (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id              UUID        NOT NULL
                              REFERENCES management_publications(id) ON DELETE CASCADE,
  social_connection_id        UUID        NOT NULL REFERENCES social_connections(id),
  platform                    TEXT        NOT NULL,
  caption                     TEXT        NOT NULL DEFAULT '',
  title                       TEXT,
  description                 TEXT,
  hashtags                    TEXT[]      NOT NULL DEFAULT '{}',
  management_content_asset_id UUID REFERENCES management_content_assets(id) ON DELETE SET NULL,
  provider_post_id            TEXT,
  provider_result_id          TEXT,
  status                      TEXT        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','scheduled','publishing',
                                                'published','failed','cancelled')),
  -- Classified code, never a raw provider payload.
  error_code                  TEXT,
  error_message               TEXT,
  published_url               TEXT,
  scheduled_at                TIMESTAMPTZ,
  published_at                TIMESTAMPTZ,
  provider_metadata           JSONB,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Publication idempotency: one destination per account per publication, so a
  -- retried job cannot post twice to the same account.
  CONSTRAINT uq_mgmt_target_per_account UNIQUE (publication_id, social_connection_id)
);

CREATE INDEX IF NOT EXISTS idx_mgmt_target_pub    ON management_publication_targets(publication_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_target_status ON management_publication_targets(status);
CREATE INDEX IF NOT EXISTS idx_mgmt_target_result ON management_publication_targets(provider_result_id)
  WHERE provider_result_id IS NOT NULL;

-- ── 10. Async work ───────────────────────────────────────────────────────────
-- Mirrors the render-queue claim seam (migration 010) rather than introducing
-- Redis or a new queue runtime. Every job must be idempotent — duplicate
-- deliveries are expected, not exceptional.
CREATE TABLE IF NOT EXISTS management_jobs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT        NOT NULL,
  -- Natural key for the work. UNIQUE, so enqueuing the same job twice is a no-op.
  dedupe_key   TEXT        NOT NULL UNIQUE,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  state        TEXT        NOT NULL DEFAULT 'queued'
               CHECK (state IN ('queued','claimed','done','failed')),
  attempts     INTEGER     NOT NULL DEFAULT 0,
  max_attempts INTEGER     NOT NULL DEFAULT 8,
  -- Exponential backoff: a retryable failure pushes this forward.
  run_after    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by   TEXT,
  claimed_at   TIMESTAMPTZ,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgmt_jobs_runnable
  ON management_jobs(run_after) WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS idx_mgmt_jobs_claimed
  ON management_jobs(claimed_at) WHERE state = 'claimed';

-- ── 11. Provider webhook dedupe ──────────────────────────────────────────────
-- The provider retries ~8 times over 24 h and duplicates are expected, so every
-- delivery is recorded here first; a unique violation means "already handled".
CREATE TABLE IF NOT EXISTS management_webhook_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT        NOT NULL DEFAULT 'post_for_me',
  provider_event_id TEXT        NOT NULL,
  event_type        TEXT        NOT NULL,
  payload           JSONB,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ,
  CONSTRAINT uq_mgmt_webhook_event UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_mgmt_webhook_received ON management_webhook_events(received_at);

-- ── 12. Audit trail ──────────────────────────────────────────────────────────
-- Every financial and publishing action, with correlation ids. Safe metadata
-- only: no secrets, no tokens, no raw provider payloads.
CREATE TABLE IF NOT EXISTS management_audit_events (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event                  TEXT        NOT NULL,
  user_id                UUID REFERENCES users(id) ON DELETE SET NULL,
  purchase_id            UUID,
  access_pass_id         UUID,
  publish_entitlement_id UUID,
  source_generation_id   TEXT,
  management_content_id  UUID,
  publication_id         UUID,
  provider_post_id       TEXT,
  metadata               JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgmt_audit_user  ON management_audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_audit_event ON management_audit_events(event);
CREATE INDEX IF NOT EXISTS idx_mgmt_audit_time  ON management_audit_events(created_at);
