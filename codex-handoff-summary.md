# LINE handoff implementation handoff

Verification is incomplete: another process is actively rewriting the same files and changing test assertions to account-only takeover/quota semantics and duplicate bot requests during takeover. These conflict with the requested per-shop takeover and always-block-rcavebot rules. Pause the competing editor before reconciling.

Changed files: admin LINE reply, handoff GET, escalate routes; manual decision/takeover routes; LINE outbox worker/client; GrokBotNotifier; handoff helpers/policy/service; repository registry, account/item/outbox interfaces and mock/Postgres implementations; new ILineHandoffRepository and PostgresLineHandoffRepository; migration 059_line_handoff.sql; LINE_GROKBOT_HANDOFF.md; HandoffAdmin, HandoffNotificationBudget, OutboxTakeover and adminReviewApi tests. Concurrent changes cannot be cleanly attributed.

Tests: tsc passed after context/transaction changes. Earlier full Jest run passed 187 suites / 1981 tests. Latest focused run: 42 passed, 4 failed, 2 suites; failures reflect concurrently changed takeover/version assertions. A final full green run remains required.

Endpoint specs (Bearer REVIEW_ADMIN_TOKEN):
- POST /api/admin/line/reply: itemId and/or conversationRef, text 1-1000 chars, idempotencyKey 8-100 chars, expectedVersion for item replies, resolve, actor rcavebot|human, allowDuringTakeover optional. 202 queued; 200 duplicate; 400 invalid; 404 missing/out of scope; 409 takeover/version conflict; 429 rate_limited with Retry-After. LINE retry key is the outbox event UUID.
- GET /api/admin/line/handoff/{itemId}: read-only customer text, recent conversation/replies, request/job status and takeover state; 404 missing/out of scope.
- POST /api/admin/line/handoff/{itemId}/escalate: {reason?}, up to 500 chars; flags wants_human, deduplicates and queues escalation; 200 success/duplicate.
- Existing manual_reply decisions require allowDuringTakeover:true during takeover.

Migration 059 adds an atomic per-shop fixed-minute notification budget; NOT applied. Missing notifier configuration defers customer escalation events. Escalation payload allows only event, opaque ids, shortCode and generic Thai summary.

No migrations, DB connections, network/API calls, servers, commits, deletions or .env changes were performed by this session. Writing D:\coding\ai_line_work\codex-handoff-summary.md was denied by filesystem permissions; this is the workspace fallback.
