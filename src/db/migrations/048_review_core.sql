-- =============================================================================
-- Migration 048: Review core tables
-- Review item registry, escalation rules, trust policies, review items/actions,
-- outbox, integration plumbing, and prompt-tuning export view.
-- Excludes LINE intake columns and service packages (see 049, 050).
--
-- Additive and idempotent (IF NOT EXISTS / DO blocks).
-- Apply: node scripts/apply-migration.js src/db/migrations/048_review_core.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. review_item_types — extensible registry (no migration per new type)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_item_types (
  key                      TEXT        PRIMARY KEY
                           CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label_th                 TEXT        NOT NULL,
  label_en                 TEXT        NOT NULL,
  enabled                  BOOLEAN     NOT NULL DEFAULT TRUE,
  always_review            BOOLEAN     NOT NULL DEFAULT FALSE,
  default_outcome          TEXT        NOT NULL DEFAULT 'review'
                           CHECK (default_outcome IN ('review', 'auto')),
  confidence_threshold     NUMERIC(4,3) NOT NULL DEFAULT 0.800
                           CHECK (confidence_threshold BETWEEN 0 AND 1),
  customer_notice_after_min INTEGER    NOT NULL DEFAULT 15,
  remind_after_min         INTEGER     NOT NULL DEFAULT 30,
  remind_every_min         INTEGER     NOT NULL DEFAULT 120,
  max_reminders            SMALLINT    NOT NULL DEFAULT 5,
  due_after_min            INTEGER     NOT NULL DEFAULT 1440,
  expire_after_min         INTEGER     NOT NULL DEFAULT 4320,
  quiet_hours_exempt       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO review_item_types
  (key, label_th, label_en, always_review, customer_notice_after_min, quiet_hours_exempt)
VALUES
  ('video',          'วิดีโอ',                       'Video',               FALSE, 15, FALSE),
  ('tts',            'เสียงพากย์',                   'Voice-over (TTS)',    FALSE, 15, FALSE),
  ('script',         'สคริปต์และสตอรีบอร์ด',          'Script & storyboard', FALSE, 15, FALSE),
  ('caption',        'ซับ / แคปชัน',                  'Subtitles / caption', FALSE, 15, FALSE),
  ('customer_reply', 'ข้อความตอบลูกค้า',              'Customer reply',      FALSE, 10, FALSE),
  ('out_of_package', 'งานนอกแพ็กเกจ',                'Out of package',      TRUE,  10, FALSE),
  ('complaint',      'เรื่องร้องเรียน / ขอคุยกับคน', 'Complaint / human',   TRUE,   5, TRUE),
  ('footage_qc',     'ฟุตเทจไม่ผ่าน QC',              'Footage QC',          FALSE, 15, FALSE)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. escalation_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escalation_rules (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key               TEXT        NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  kind              TEXT        NOT NULL CHECK (kind IN ('hard', 'threshold', 'sampling')),
  applies_to        TEXT[]      NOT NULL DEFAULT '{}',
  condition         JSONB       NOT NULL,
  threshold         NUMERIC(4,3) CHECK (threshold IS NULL OR threshold BETWEEN 0 AND 1),
  reason_th         TEXT        NOT NULL,
  reason_en         TEXT        NOT NULL,
  priority          SMALLINT    NOT NULL DEFAULT 100,
  enabled           BOOLEAN     NOT NULL DEFAULT TRUE,
  trust_can_bypass  BOOLEAN     NOT NULL DEFAULT FALSE,
  version           INTEGER     NOT NULL DEFAULT 1,
  updated_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO escalation_rules
  (key, kind, applies_to, condition, threshold, reason_th, reason_en, priority)
VALUES
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

-- ---------------------------------------------------------------------------
-- 3. review_trust_policies
-- ---------------------------------------------------------------------------
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
  disabled_reason   TEXT,
  disabled_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. review_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_items (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code         TEXT        NOT NULL UNIQUE,
  type_key           TEXT        NOT NULL REFERENCES review_item_types(key),
  status             TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected', 'edited', 'expired')),
  resolution         TEXT
                     CHECK (resolution IS NULL OR resolution IN (
                       'approved', 'auto_approved', 'approved_with_edits', 'rejected',
                       'manual_reply', 'handoff_taken', 'superseded', 'timed_out', 'cancelled')),
  render_state       TEXT        NOT NULL DEFAULT 'none'
                     CHECK (render_state IN ('none', 'queued', 'rendering', 'done', 'failed')),
  version            INTEGER     NOT NULL DEFAULT 1,
  supersedes_id      UUID        REFERENCES review_items(id) ON DELETE SET NULL,

  shop_user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id         TEXT,
  job_id             TEXT,
  gate_step          TEXT,
  package_order_id   UUID,
  external_ref       TEXT,

  title              TEXT        NOT NULL,
  payload            JSONB       NOT NULL,
  original_payload   JSONB,
  asset_refs         JSONB       NOT NULL DEFAULT '[]'::jsonb,

  decision_mode      TEXT        NOT NULL
                     CHECK (decision_mode IN ('review', 'auto', 'sampled')),
  matched_rules      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  rule_snapshot      JSONB,
  signals            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  confidence         NUMERIC(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  producer           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  priority           SMALLINT    NOT NULL DEFAULT 100,

  decided_by         UUID        REFERENCES users(id) ON DELETE SET NULL,
  decided_via        TEXT        CHECK (decided_via IS NULL OR decided_via IN
                                   ('grokbot_app', 'web', 'auto', 'system')),
  decision_note      TEXT,
  final_payload      JSONB,

  customer_noticed_at TIMESTAMPTZ,
  next_reminder_at   TIMESTAMPTZ,
  reminder_count     SMALLINT    NOT NULL DEFAULT 0,
  due_at             TIMESTAMPTZ NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  eta_told_shop      TIMESTAMPTZ,

  notified_at        TIMESTAMPTZ,
  first_opened_at    TIMESTAMPTZ,
  decided_at         TIMESTAMPTZ,
  decision_seconds   INTEGER GENERATED ALWAYS AS
                     (CASE WHEN decided_at IS NOT NULL AND first_opened_at IS NOT NULL
                           THEN GREATEST(0, EXTRACT(EPOCH FROM (decided_at - first_opened_at))::INTEGER) END) STORED,
  wait_seconds       INTEGER GENERATED ALWAYS AS
                     (CASE WHEN first_opened_at IS NOT NULL
                           THEN GREATEST(0, EXTRACT(EPOCH FROM (first_opened_at - created_at))::INTEGER) END) STORED,

  idempotency_key    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_items_queue
  ON review_items(status, due_at) WHERE status IN ('pending', 'edited');
CREATE INDEX IF NOT EXISTS idx_review_items_reminder
  ON review_items(next_reminder_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_review_items_shop_created
  ON review_items(shop_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_items_request
  ON review_items(request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_items_open_gate
  ON review_items(job_id, gate_step)
  WHERE status IN ('pending', 'edited') AND job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_items_idem
  ON review_items(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. review_actions — append-only log
-- ---------------------------------------------------------------------------
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
  actor_via        TEXT        NOT NULL CHECK (actor_via IN
                     ('grokbot_app', 'web', 'auto', 'system', 'grokbot')),
  from_status      TEXT,
  to_status        TEXT,
  reason_code      TEXT        CHECK (reason_code IS NULL OR reason_code IN (
                     'wrong_price', 'wrong_menu_name', 'wrong_shop_info', 'hallucinated_claim',
                     'tone_too_salesy', 'tone_off_brand', 'thai_spelling', 'grammar',
                     'caption_too_long', 'caption_timing', 'wrong_shot_order', 'bad_framing',
                     'voice_mispronounce', 'voice_style', 'music', 'footage_unusable',
                     'policy_risk', 'customer_context', 'other')),
  reason_text      TEXT,
  diff             JSONB,
  detail           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  client_elapsed_ms INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_actions_item ON review_actions(review_item_id, id);
CREATE INDEX IF NOT EXISTS idx_review_actions_reason
  ON review_actions(reason_code, created_at DESC) WHERE reason_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. review_outbox — transactional outbox
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_outbox (
  id               BIGSERIAL   PRIMARY KEY,
  event_id         UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  event_type       TEXT        NOT NULL,
  channel          TEXT        NOT NULL DEFAULT 'grokbot_app'
                   CHECK (channel IN ('grokbot_app', 'web_push', 'line_notify', 'telegram', 'email')),
  review_item_id   UUID        REFERENCES review_items(id) ON DELETE CASCADE,
  dedupe_key       TEXT,
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

-- ---------------------------------------------------------------------------
-- 7. Integration plumbing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_idempotency_keys (
  client           TEXT        NOT NULL,
  idem_key         TEXT        NOT NULL,
  route            TEXT        NOT NULL,
  body_sha256      TEXT        NOT NULL,
  response_status  SMALLINT,
  response_body    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_integration_idem_created
  ON integration_idempotency_keys(created_at);

CREATE TABLE IF NOT EXISTS integration_admin_actors (
  client           TEXT        NOT NULL,
  admin_ref        TEXT        NOT NULL,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client, admin_ref)
);

CREATE TABLE IF NOT EXISTS review_preview_revocations (
  jti              TEXT        PRIMARY KEY,
  review_item_id   UUID        REFERENCES review_items(id) ON DELETE CASCADE,
  revoked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- 8. Prompt-tuning export view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW review_feedback_export AS
SELECT
  a.id                          AS action_id,
  a.created_at,
  i.type_key,
  i.id                          AS review_item_id,
  i.version,
  i.producer->>'provider'       AS provider,
  i.producer->>'model'          AS model,
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
