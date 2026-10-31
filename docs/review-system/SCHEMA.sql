-- =============================================================================
-- Migration 048: Admin Review System + LINE intake + service packages
--
-- DESIGN ONLY (31 Oct 2026). When implemented, this file is split per phase
-- into src/db/migrations/048_review_core.sql, 049_line_intake.sql,
-- 050_service_packages.sql (see IMPLEMENTATION_PLAN.md). Every statement is
-- additive and idempotent (IF NOT EXISTS / DO blocks), so older app builds and
-- the studio path keep working unchanged:
--   * no existing column changes type or default meaning
--   * new columns on clip_requests / render_tasks default to today's behaviour
--     (intake_channel='studio', render_lane NULL = old routing)
--
-- ID conventions follow the existing schema:
--   users.id            UUID   → FK with REFERENCES users(id)
--   clip_requests.id    TEXT   → stored as TEXT, NO FK (same as 041 studio_events,
--                                because ids are uuid-as-text in some rows)
--
-- Apply: node scripts/apply-migration.js src/db/migrations/048_review_core.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. review_item_types — registry (extensible without a migration per type)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_item_types (
  key                      TEXT        PRIMARY KEY
                           CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label_th                 TEXT        NOT NULL,
  label_en                 TEXT        NOT NULL,
  enabled                  BOOLEAN     NOT NULL DEFAULT TRUE,
  -- TRUE = every item of this type is reviewed (no auto-approve, no threshold)
  always_review            BOOLEAN     NOT NULL DEFAULT FALSE,
  -- default when no rule matched: 'review' | 'auto'
  default_outcome          TEXT        NOT NULL DEFAULT 'review'
                           CHECK (default_outcome IN ('review', 'auto')),
  confidence_threshold     NUMERIC(4,3) NOT NULL DEFAULT 0.800
                           CHECK (confidence_threshold BETWEEN 0 AND 1),
  -- SLA (minutes)
  customer_notice_after_min INTEGER    NOT NULL DEFAULT 15,
  remind_after_min         INTEGER     NOT NULL DEFAULT 30,
  remind_every_min         INTEGER     NOT NULL DEFAULT 120,
  max_reminders            SMALLINT    NOT NULL DEFAULT 5,
  due_after_min            INTEGER     NOT NULL DEFAULT 1440,   -- 24 h
  expire_after_min         INTEGER     NOT NULL DEFAULT 4320,   -- 72 h
  quiet_hours_exempt       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO review_item_types
  (key, label_th, label_en, always_review, customer_notice_after_min, quiet_hours_exempt)
VALUES
  ('video',          'วิดีโอ',                   'Video',               FALSE, 15, FALSE),
  ('tts',            'เสียงพากย์',               'Voice-over (TTS)',    FALSE, 15, FALSE),
  ('script',         'สคริปต์และสตอรีบอร์ด',      'Script & storyboard', FALSE, 15, FALSE),
  ('caption',        'ซับ / แคปชัน',              'Subtitles / caption', FALSE, 15, FALSE),
  ('customer_reply', 'ข้อความตอบลูกค้า',          'Customer reply',      FALSE, 10, FALSE),
  ('out_of_package', 'งานนอกแพ็กเกจ',            'Out of package',      TRUE,  10, FALSE),
  ('complaint',      'เรื่องร้องเรียน / ขอคุยกับคน', 'Complaint / human',   TRUE,   5, TRUE),
  ('footage_qc',     'ฟุตเทจไม่ผ่าน QC',          'Footage QC',          FALSE, 15, FALSE)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. LINE intake: link LINE user → RClipper requester (users.role='requester')
--    Separate table instead of auth_identities because auth_identities.provider
--    has a CHECK constraint and is used by NextAuth sign-in; a LINE link is not
--    a sign-in method.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS line_accounts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  line_channel_id  TEXT        NOT NULL,          -- the new LINE OA
  line_user_id     TEXT        NOT NULL,          -- U + 32 hex
  display_name     TEXT,
  linked_via       TEXT        NOT NULL DEFAULT 'auto_created'
                   CHECK (linked_via IN ('auto_created', 'link_code', 'admin')),
  status           TEXT        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'blocked', 'unlinked')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (line_channel_id, line_user_id)
);
CREATE INDEX IF NOT EXISTS idx_line_accounts_user ON line_accounts(user_id);

-- One-time codes to attach a LINE chat to an EXISTING app account.
CREATE TABLE IF NOT EXISTS line_link_codes (
  code_hash        TEXT        PRIMARY KEY,       -- sha256(code + pepper)
  line_channel_id  TEXT        NOT NULL,
  line_user_id     TEXT        NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  used_by_user_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
  used_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 3. Service packages (RClipper keeps and counts — Joe, 31 Oct)
--    e.g. "2 clips, 200–500 THB, N revisions per clip"
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_packages (
  code                 TEXT        PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{2,40}$'),
  name_th              TEXT        NOT NULL,
  price_baht           NUMERIC(10,2) NOT NULL CHECK (price_baht >= 0),
  clips_included       SMALLINT    NOT NULL CHECK (clips_included > 0),
  revisions_per_clip   SMALLINT    NOT NULL DEFAULT 2 CHECK (revisions_per_clip >= 0),
  max_duration_seconds SMALLINT    NOT NULL DEFAULT 30,
  ratios_included      TEXT[]      NOT NULL DEFAULT ARRAY['9:16'],
  includes             JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- {"voice":true,"captions":["th","en"],...}
  valid_days           SMALLINT    NOT NULL DEFAULT 30,
  active               BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS package_orders (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_code       TEXT        NOT NULL REFERENCES service_packages(code),
  -- snapshot so later price/limit changes never rewrite a sold package
  clips_included     SMALLINT    NOT NULL,
  revisions_per_clip SMALLINT    NOT NULL,
  price_baht         NUMERIC(10,2) NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('pending_payment', 'active', 'used_up', 'expired', 'cancelled')),
  paid_reference     TEXT,                         -- how it was paid (set by admin/grokbot)
  starts_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_package_orders_user_status ON package_orders(user_id, status);

-- Append-only usage ledger (like credit_transactions: never UPDATE/DELETE).
CREATE TABLE IF NOT EXISTS package_usage (
  id                BIGSERIAL   PRIMARY KEY,
  package_order_id  UUID        NOT NULL REFERENCES package_orders(id) ON DELETE CASCADE,
  request_id        TEXT        NOT NULL,          -- clip_requests.id (no FK, see header)
  kind              TEXT        NOT NULL CHECK (kind IN ('clip', 'revision', 'extra', 'refund_clip', 'refund_revision')),
  units             SMALLINT    NOT NULL DEFAULT 1,
  review_item_id    UUID,                          -- set when an out_of_package approval created it
  extra_price_baht  NUMERIC(10,2),                 -- for kind='extra'
  note              TEXT,
  created_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_package_usage_order ON package_usage(package_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_package_usage_clip_per_request
  ON package_usage(request_id) WHERE kind = 'clip';

-- -----------------------------------------------------------------------------
-- 4. clip_requests / render_tasks: intake channel + render lane (additive)
-- -----------------------------------------------------------------------------
ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS intake_channel   TEXT NOT NULL DEFAULT 'studio';
ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS package_order_id UUID;
ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS external_ref     TEXT;     -- grokbot's job/conversation id
ALTER TABLE clip_requests
  ADD COLUMN IF NOT EXISTS render_lane      TEXT;     -- NULL = existing routing

DO $$ BEGIN
  ALTER TABLE clip_requests DROP CONSTRAINT IF EXISTS clip_requests_intake_channel_check;
  ALTER TABLE clip_requests ADD CONSTRAINT clip_requests_intake_channel_check
    CHECK (intake_channel IN ('studio', 'web', 'line'));
  ALTER TABLE clip_requests DROP CONSTRAINT IF EXISTS clip_requests_render_lane_check;
  ALTER TABLE clip_requests ADD CONSTRAINT clip_requests_render_lane_check
    CHECK (render_lane IS NULL OR render_lane IN ('mac_mini', 'device', 'operator_pc', 'operator_device'));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clip_requests_external_ref
  ON clip_requests(intake_channel, external_ref) WHERE external_ref IS NOT NULL;

-- Worker lane. claimNext() today filters device_only = FALSE; the operator_pc
-- worker adds "AND render_lane = 'operator_pc'", the Mac Mini adds
-- "AND render_lane IS DISTINCT FROM 'operator_pc'". NULL keeps old behaviour.
ALTER TABLE render_tasks ADD COLUMN IF NOT EXISTS render_lane TEXT;
CREATE INDEX IF NOT EXISTS idx_render_tasks_lane_queued
  ON render_tasks(render_lane, priority, created_at) WHERE state = 'queued';

-- -----------------------------------------------------------------------------
-- 5. escalation_rules
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escalation_rules (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key               TEXT        NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  kind              TEXT        NOT NULL CHECK (kind IN ('hard', 'threshold', 'sampling')),
  applies_to        TEXT[]      NOT NULL DEFAULT '{}',   -- review_item_types.key; {} = all
  condition         JSONB       NOT NULL,                -- DSL, validated by Zod on save
  threshold         NUMERIC(4,3) CHECK (threshold IS NULL OR threshold BETWEEN 0 AND 1),
  reason_th         TEXT        NOT NULL,
  reason_en         TEXT        NOT NULL,
  priority          SMALLINT    NOT NULL DEFAULT 100,    -- lower = shown first
  enabled           BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Only meaningful for kind='hard'. Code ALSO refuses bypass for the locked
  -- keys (wants_human, customer_unhappy, out_of_package) whatever this says.
  trust_can_bypass  BOOLEAN     NOT NULL DEFAULT FALSE,
  version           INTEGER     NOT NULL DEFAULT 1,      -- bumped on every edit
  updated_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO escalation_rules (key, kind, applies_to, condition, threshold, reason_th, reason_en, priority) VALUES
 ('wants_human', 'hard', '{}',
  '{"any":[{"signal":"intent","op":"eq","value":"human_handoff"},{"signal":"customer_text","op":"regex","value":"(ขอ)?คุยกับ(คน|แอดมิน|เจ้าหน้าที่)|ขอสายคน|human"}]}',
  NULL, 'ลูกค้าต้องการคุยกับคนจริง', 'Customer asked for a human', 1),
 ('customer_unhappy', 'hard', '{}',
  '{"any":[{"signal":"sentiment","op":"lte","value":-0.4},{"signal":"tags","op":"contains_any","value":["complaint","refund","angry"]}]}',
  NULL, 'ลูกค้าไม่พอใจ', 'Customer unhappy', 2),
 ('out_of_package', 'hard', '{}',
  '{"any":[{"signal":"package.over_clips","op":"eq","value":true},{"signal":"package.over_revisions","op":"eq","value":true},{"signal":"request_scope","op":"eq","value":"extra"}]}',
  NULL, 'คำขอนอกแพ็กเกจ', 'Out-of-package request', 3),
 ('footage_qc_failed', 'hard', '{footage_qc,video}',
  '{"all":[{"signal":"qc.passed","op":"eq","value":false}]}',
  NULL, 'ฟุตเทจไม่ผ่าน QC', 'Footage failed QC', 5),
 ('menu_price_promo', 'hard', '{video,script,caption,tts,customer_reply}',
  '{"any":[{"signal":"tags","op":"contains_any","value":["price","promotion","menu_name"]},{"signal":"text","op":"regex","value":"(\\d[\\d,]*\\s*(บาท|฿|THB|baht))|ลด\\s*\\d+\\s*%|โปร(โมชั่?น)?|ซื้อ\\s*\\d+\\s*แถม|ฟรี"}]}',
  NULL, 'คลิปมีชื่อเมนู ราคา หรือโปรโมชัน', 'Mentions menu name, price or promotion', 10),
 ('first_jobs_of_shop', 'hard', '{video,script,tts,caption}',
  '{"all":[{"signal":"shop.completed_jobs","op":"lt","value":3}]}',
  NULL, 'ร้านใหม่ (3 งานแรก)', 'New shop (first 3 jobs)', 20),
 ('low_confidence', 'threshold', '{}',
  '{"all":[{"signal":"confidence","op":"exists","value":true}]}',
  0.800, 'AI ไม่มั่นใจ', 'Low AI confidence', 50),
 ('sampling', 'sampling', '{}', '{"all":[]}',
  NULL, 'สุ่มตรวจคุณภาพ', 'Random quality sample', 90)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. review_trust_policies — auto-approve per shop (later phase)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_trust_policies (
  user_id           UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled           BOOLEAN     NOT NULL DEFAULT FALSE,
  allowed_types     TEXT[]      NOT NULL DEFAULT ARRAY['video','tts','script','caption'],
  min_confidence    NUMERIC(4,3) NOT NULL DEFAULT 0.900 CHECK (min_confidence BETWEEN 0 AND 1),
  sample_rate       NUMERIC(4,3) NOT NULL DEFAULT 0.200 CHECK (sample_rate BETWEEN 0 AND 1),
  max_auto_per_day  SMALLINT    NOT NULL DEFAULT 20,
  reason            TEXT,
  granted_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
  granted_at        TIMESTAMPTZ,
  disabled_reason   TEXT,                           -- e.g. 'circuit_breaker'
  disabled_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 7. review_items
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_items (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code         TEXT        NOT NULL UNIQUE,   -- 6 chars for chat replies, e.g. "K7Q2MD"
  type_key           TEXT        NOT NULL REFERENCES review_item_types(key),
  status             TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected', 'edited', 'expired')),
  resolution         TEXT
                     CHECK (resolution IS NULL OR resolution IN
                       ('approved', 'auto_approved', 'approved_with_edits', 'rejected',
                        'manual_reply', 'handoff_taken', 'superseded', 'timed_out', 'cancelled')),
  render_state       TEXT        NOT NULL DEFAULT 'none'
                     CHECK (render_state IN ('none', 'queued', 'rendering', 'done', 'failed')),
  version            INTEGER     NOT NULL DEFAULT 1,
  supersedes_id      UUID        REFERENCES review_items(id) ON DELETE SET NULL,

  -- who / what
  shop_user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id         TEXT,                          -- clip_requests.id (no FK)
  job_id             TEXT,                          -- video_generation_jobs.id
  gate_step          TEXT,                          -- VideoGenerationStep at creation
  package_order_id   UUID        REFERENCES package_orders(id) ON DELETE SET NULL,
  external_ref       TEXT,                          -- grokbot conversation / message id

  -- content
  title              TEXT        NOT NULL,          -- one line for the card
  payload            JSONB       NOT NULL,          -- type-specific, Zod-validated (draft text, asset ids, ...)
  original_payload   JSONB,                         -- first AI draft, never changed (for diffs)
  asset_refs         JSONB       NOT NULL DEFAULT '[]'::jsonb, -- [{role:'preview'|'source'|'voice', asset_id, storage_key, mime}]

  -- why
  decision_mode      TEXT        NOT NULL           -- how it got here
                     CHECK (decision_mode IN ('review', 'auto', 'sampled')),
  matched_rules      JSONB       NOT NULL DEFAULT '[]'::jsonb, -- [{key, kind, version, reason_th}]
  rule_snapshot      JSONB,                         -- full evaluation trace (signals in, rules out)
  signals            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  confidence         NUMERIC(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  producer           JSONB       NOT NULL DEFAULT '{}'::jsonb, -- {agent, provider, model, prompt_version}
  priority           SMALLINT    NOT NULL DEFAULT 100,

  -- decision
  decided_by         UUID        REFERENCES users(id) ON DELETE SET NULL,  -- NULL when auto
  decided_via        TEXT        CHECK (decided_via IS NULL OR decided_via IN ('grokbot_app', 'web', 'auto', 'system')),
  decision_note      TEXT,
  final_payload      JSONB,                         -- what was actually sent/applied

  -- SLA timers
  customer_noticed_at TIMESTAMPTZ,                  -- "กำลังตรวจงาน" sent to shop
  next_reminder_at   TIMESTAMPTZ,
  reminder_count     SMALLINT    NOT NULL DEFAULT 0,
  due_at             TIMESTAMPTZ NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  eta_told_shop      TIMESTAMPTZ,

  -- review-time measurement
  notified_at        TIMESTAMPTZ,
  first_opened_at    TIMESTAMPTZ,
  decided_at         TIMESTAMPTZ,
  decision_seconds   INTEGER GENERATED ALWAYS AS
                     (CASE WHEN decided_at IS NOT NULL AND first_opened_at IS NOT NULL
                           THEN GREATEST(0, EXTRACT(EPOCH FROM (decided_at - first_opened_at)))::INTEGER END) STORED,
  wait_seconds       INTEGER GENERATED ALWAYS AS
                     (CASE WHEN first_opened_at IS NOT NULL
                           THEN GREATEST(0, EXTRACT(EPOCH FROM (first_opened_at - created_at)))::INTEGER END) STORED,

  idempotency_key    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Queue: pending first, nearest SLA first
CREATE INDEX IF NOT EXISTS idx_review_items_queue
  ON review_items(status, due_at) WHERE status IN ('pending', 'edited');
CREATE INDEX IF NOT EXISTS idx_review_items_reminder
  ON review_items(next_reminder_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_review_items_shop_created
  ON review_items(shop_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_items_request
  ON review_items(request_id) WHERE request_id IS NOT NULL;
-- At most ONE open item per (job, gate): a re-trigger of the same gate must not
-- create a duplicate card.
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_items_open_gate
  ON review_items(job_id, gate_step)
  WHERE status IN ('pending', 'edited') AND job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_items_idem
  ON review_items(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 8. review_actions — append-only log (never UPDATE/DELETE)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_actions (
  id               BIGSERIAL   PRIMARY KEY,
  review_item_id   UUID        NOT NULL REFERENCES review_items(id) ON DELETE CASCADE,
  item_version     INTEGER     NOT NULL,
  action           TEXT        NOT NULL CHECK (action IN (
                     'created', 'auto_approved', 'sampled', 'notified', 'opened',
                     'approved', 'rejected', 'edited', 'manual_reply', 'handoff_taken',
                     'rerender_requested', 'rerender_done', 'rerender_failed',
                     'reminder_sent', 'customer_noticed', 'overdue', 'expired',
                     'superseded', 'comment', 'applied', 'apply_failed')),
  actor_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  actor_via        TEXT        NOT NULL CHECK (actor_via IN ('grokbot_app', 'web', 'auto', 'system', 'grokbot')),
  from_status      TEXT,
  to_status        TEXT,
  -- edit reasons, kept for prompt tuning
  reason_code      TEXT        CHECK (reason_code IS NULL OR reason_code IN (
                     'wrong_price', 'wrong_menu_name', 'wrong_shop_info', 'hallucinated_claim',
                     'tone_too_salesy', 'tone_off_brand', 'thai_spelling', 'grammar',
                     'caption_too_long', 'caption_timing', 'wrong_shot_order', 'bad_framing',
                     'voice_mispronounce', 'voice_style', 'music', 'footage_unusable',
                     'policy_risk', 'customer_context', 'other')),
  reason_text      TEXT,
  diff             JSONB,       -- [{field, before, after}]
  detail           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  client_elapsed_ms INTEGER,    -- time on screen reported by the page/app (sanity check for decision_seconds)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_actions_item ON review_actions(review_item_id, id);
CREATE INDEX IF NOT EXISTS idx_review_actions_reason
  ON review_actions(reason_code, created_at DESC) WHERE reason_code IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 9. review_outbox — notifications / webhooks (transactional outbox)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_outbox (
  id               BIGSERIAL   PRIMARY KEY,
  event_id         UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),  -- X-RC-Event-Id
  event_type       TEXT        NOT NULL,  -- review.created | review.updated | review.reminder | review.decided |
                                          -- review.expired | shop.notice_in_review | shop.notice_overdue |
                                          -- delivery.ready | rerender.requested
  channel          TEXT        NOT NULL DEFAULT 'grokbot_app'
                   CHECK (channel IN ('grokbot_app', 'web_push', 'line_notify', 'telegram', 'email')),
  review_item_id   UUID        REFERENCES review_items(id) ON DELETE CASCADE,
  dedupe_key       TEXT,                   -- e.g. "<item>:customer_noticed"
  payload          JSONB       NOT NULL,
  state            TEXT        NOT NULL DEFAULT 'queued'
                   CHECK (state IN ('queued', 'sending', 'sent', 'failed', 'dead')),
  attempts         SMALLINT    NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error       TEXT,
  last_status_code SMALLINT,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_outbox_due
  ON review_outbox(next_attempt_at) WHERE state IN ('queued', 'failed');
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_outbox_dedupe
  ON review_outbox(channel, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 10. Integration plumbing
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_idempotency_keys (
  client           TEXT        NOT NULL,           -- 'grokbot'
  idem_key         TEXT        NOT NULL,
  route            TEXT        NOT NULL,
  body_sha256      TEXT        NOT NULL,
  response_status  SMALLINT,
  response_body    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_integration_idem_created ON integration_idempotency_keys(created_at);
-- Swept daily: DELETE ... WHERE created_at < NOW() - INTERVAL '24 hours'

-- Maps the reviewer identity grokbot sends (actor.admin_ref) to an admin user.
CREATE TABLE IF NOT EXISTS integration_admin_actors (
  client           TEXT        NOT NULL,
  admin_ref        TEXT        NOT NULL,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client, admin_ref)
);

-- Revocable preview tokens (jti deny-list; rows only for revoked tokens)
CREATE TABLE IF NOT EXISTS review_preview_revocations (
  jti              TEXT        PRIMARY KEY,
  review_item_id   UUID        REFERENCES review_items(id) ON DELETE CASCADE,
  revoked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL
);

-- -----------------------------------------------------------------------------
-- 11. Prompt-tuning export
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW review_feedback_export AS
SELECT
  a.id                         AS action_id,
  a.created_at,
  i.type_key,
  i.id                         AS review_item_id,
  i.version,
  i.producer->>'provider'      AS provider,
  i.producer->>'model'         AS model,
  i.producer->>'prompt_version' AS prompt_version,
  i.confidence,
  i.matched_rules,
  a.action,
  a.reason_code,
  a.reason_text,
  a.diff,
  i.original_payload,
  i.final_payload
FROM review_actions a
JOIN review_items i ON i.id = a.review_item_id
WHERE a.action IN ('edited', 'rejected', 'manual_reply');

COMMIT;

-- -----------------------------------------------------------------------------
-- Rollback (manual; only if nothing depends on it yet)
-- -----------------------------------------------------------------------------
-- DROP VIEW IF EXISTS review_feedback_export;
-- DROP TABLE IF EXISTS review_preview_revocations, integration_admin_actors,
--   integration_idempotency_keys, review_outbox, review_actions, review_items,
--   review_trust_policies, escalation_rules, package_usage, package_orders,
--   service_packages, line_link_codes, line_accounts, review_item_types;
-- ALTER TABLE render_tasks  DROP COLUMN IF EXISTS render_lane;
-- ALTER TABLE clip_requests DROP COLUMN IF EXISTS render_lane,
--   DROP COLUMN IF EXISTS external_ref, DROP COLUMN IF EXISTS package_order_id,
--   DROP COLUMN IF EXISTS intake_channel;
