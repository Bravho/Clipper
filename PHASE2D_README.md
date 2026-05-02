# Phase 2D — Admin Portal

## Overview

Phase 2D builds the admin-facing operational portal for RClipper.

Admins have oversight across the entire production workflow — from reviewing submitted clips to approving them for publishing. The admin portal is more powerful than the staff portal, with cross-system visibility, SLA monitoring, credit management, user management, and delivery oversight.

---

## What Was Built

### New Domain Models

| File | Description |
|------|-------------|
| `src/domain/enums/ProductionReviewStatus.ts` | Admin review status: Pending, Approved, ReturnedToEditing, OnHold, Rejected |
| `src/domain/models/ProductionReview.ts` | Internal admin review record per clip submission |

### New Repositories

| File | Description |
|------|-------------|
| `src/repositories/interfaces/IProductionReviewRepository.ts` | Repository contract |
| `src/repositories/mock/MockProductionReviewRepository.ts` | In-memory mock implementation |

### New Services

| File | Description |
|------|-------------|
| `src/services/admin/AdminWorkflowService.ts` | Admin production review transitions (approve, return, hold, reject) |
| `src/services/admin/AdminDashboardService.ts` | Dashboard summary, queue snapshot, SLA data, workload breakdown |
| `src/services/admin/AdminUserService.ts` | User listing with credit balance (reads from Postgres-backed repos) |
| `src/services/admin/AdminCreditService.ts` | Credit summaries, platform-wide stats |

### Admin Pages

| Route | Description |
|-------|-------------|
| `/admin` | Dashboard — pipeline overview, alerts, recent activity |
| `/admin/production-review` | **Main approval queue** — clips awaiting admin review |
| `/admin/queue` | Global queue monitor — all stages at a glance |
| `/admin/requests` | All requests table with status, review state, due date |
| `/admin/requests/[id]` | Admin request detail — brief, review record, notes, actions |
| `/admin/users` | User management — all roles, credit balances |
| `/admin/credits` | Credit management — balances, usage, platform stats |
| `/admin/workload` | Workload breakdown — stages, per-staff history (completed, max/day, avg/day), capacity projection chart |
| `/admin/sla` | SLA monitor — overdue, due soon (1 working day), stale reviews |
| `/admin/delivery` | Delivery monitor — publishing links, download readiness |
| `/admin/external-workforce-placeholder` | Placeholder for future RClipper Agent Service |

### Admin API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/admin/requests/[id]/approve` | POST | Approve clip for publishing |
| `/api/admin/requests/[id]/return` | POST | Return clip to editing |
| `/api/admin/requests/[id]/hold` | POST | Hold during production review |
| `/api/admin/requests/[id]/reject` | POST | Reject from production review |
| `/api/admin/requests/[id]/deliver` | POST | Mark published request as delivered |

### Feature Components

| File | Description |
|------|-------------|
| `src/features/admin/components/AdminStatusBadge.tsx` | Status badge with admin-specific labels |
| `src/features/admin/components/ProductionReviewBadge.tsx` | Production review status badge |
| `src/features/admin/components/AdminActionButtons.tsx` | Client component — approve/return/hold/reject actions |
| `src/features/admin/validation/adminActionSchemas.ts` | Zod schemas for admin API inputs |

### Updated Files

| File | Change |
|------|--------|
| `src/repositories/index.ts` | Added `productionReviewRepository` (Phase 2D mock) |
| `src/repositories/mock/MockClipRequestRepository.ts` | Merges `ADMIN_SEED_CLIP_REQUESTS` with base seed |
| `src/repositories/mock/MockInternalNoteRepository.ts` | Merges `ADMIN_SEED_INTERNAL_NOTES` with staff seed |
| `src/services/staff/StaffWorkflowService.ts` | `submitForProductionReview()` now creates a `ProductionReview` record; added `Rejected` to allowed transitions from `ScheduledForPublishing` |
| `src/seed/adminSeedData.ts` | req-010 (ScheduledForPublishing), req-011 (Editing/overdue), req-012 (Submitted), 3 production review records |

### Tests

| File | Coverage |
|------|----------|
| `tests/services/AdminWorkflowService.test.ts` | Approve, return, hold, reject — valid transitions, invalid state, missing reasons |
| `tests/services/AdminDashboardService.test.ts` | Summary counts, overdue, due-soon, workload breakdown, queue snapshot |

---

## Architecture

### Production Review Model

The admin production review is modelled as a separate `ProductionReview` entity rather than fields embedded in `ClipRequest`. This keeps the requester-facing status model clean.

**Workflow:**

```
Staff editing complete
         ↓
submitForProductionReview()
         ↓
ClipRequest status: ScheduledForPublishing
ProductionReview status: Pending
         ↓
Admin reviews on /admin/production-review
         ↓
    ┌────┴────┐
    │         │
  Approve   Return to Editing / Hold / Reject
    │         │
    ↓         ↓
Published  Editing / OnHold / Rejected
```

The requester sees only the canonical `RequestStatus` (they do not see `ProductionReview`).

A request that is returned to editing and resubmitted will have **multiple** `ProductionReview` records over its lifetime. The latest record is the active one.

### Allowed Transitions (Updated)

`ScheduledForPublishing` now supports:
- `→ Published` (admin approves)
- `→ Editing` (admin returns for revision)
- `→ OnHold` (admin holds during review)
- `→ Rejected` (admin rejects — **new in Phase 2D**)

---

## Authorization

- All `/admin/*` routes require `Role.Admin` via `requireRole(Role.Admin)` in the layout.
- All `/api/admin/*` routes require `Role.Admin` via `requireRole(Role.Admin)` in each handler.
- Middleware in `src/middleware.ts` enforces role-gating at the edge.

---

## Seed Data

Phase 2D adds to the mock seed:

**New requests (via `adminSeedData.ts`):**
- `req-010`: ScheduledForPublishing — assigned to staff-001, confirmed 9 March, **pending admin review**
- `req-011`: Editing — assigned to staff-002 (placeholder), confirmed 7 March, **overdue**
- `req-012`: Submitted — fresh submission, no confirmed date

**Production reviews:**
- `pr-001`: req-005 — Approved (historical)
- `pr-002`: req-006 — Approved (historical)
- `pr-003`: req-010 — **Pending** (the main interactive demo item)

---

## Where PostgreSQL Will Plug In

1. **`production_reviews` table**:
   Replace `MockProductionReviewRepository` with `PostgresProductionReviewRepository` in `src/repositories/index.ts`.
   ```sql
   CREATE TABLE production_reviews (
     id TEXT PRIMARY KEY,
     request_id TEXT NOT NULL REFERENCES clip_requests(id),
     status TEXT NOT NULL CHECK (status IN ('pending','approved','returned_to_editing','on_hold','rejected')),
     reviewed_by TEXT REFERENCES users(id),
     review_note TEXT,
     submitted_at TIMESTAMPTZ NOT NULL,
     reviewed_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   CREATE INDEX ON production_reviews(request_id);
   CREATE INDEX ON production_reviews(status);
   ```

2. **Atomic transitions**:
   `AdminWorkflowService` transitions should wrap `clipRequestRepository.updateStatus()` + `productionReviewRepository.update()` + `requestStatusHistoryRepository.create()` in a single DB transaction.

3. **Admin audit log**:
   A future `admin_audit_log` table should record every admin action (actor ID, action type, target, timestamp, IP) for compliance.

---

## Where DigitalOcean Spaces Will Plug In

1. **Final clip asset verification**: The `/admin/delivery` page has `TODO` placeholders where admin should verify the final edited clip exists at its Spaces storage key before marking delivery ready.

2. **Presigned download URLs**: The requester's download button will use a presigned URL from Spaces. Admin/staff verify the asset exists; the URL is generated on demand.

3. **Deletion policy**: Raw uploads are deleted after 90 days. Final clips are retained indefinitely (no deletion schedule).

---

## How Requester Download Visibility Works (Future)

1. Staff uploads final clip via `POST /api/staff/requests/[id]/clip-upload`.
2. The edited clip appears in `uploaded_assets` with `assetType = edited_clip`.
3. Admin approves → request moves to Published.
4. Publishing links are recorded.
5. Request is marked Delivered.
6. Requester portal shows a download button pointing to a presigned Spaces URL for the `edited_clip` asset.

The admin `/admin/delivery` page tracks this readiness state via the `hasEditedClip` check and `linkCount`.

---

## Where RClipper Agent Service Will Connect

The `/admin/external-workforce-placeholder` page documents the future integration points:

- External editor accounts with scoped portal access
- Task assignment from admin to external editors
- External editors submit via the same `submitForProductionReview()` path
- RClipper Agent Service API for AI-assisted production (separate service, HTTP API)

---

## Running Tests

```bash
npm test -- tests/services/AdminWorkflowService.test.ts
npm test -- tests/services/AdminDashboardService.test.ts
npm test                # run all tests
```

---

## TODO Markers

Search for `// TODO:` in admin service and page files for:
- `PostgreSQL` — database integration points
- `DigitalOcean Spaces` — file storage integration points
- `Admin Portal` — planned admin-only restrictions
- `RClipper Agent Service` — future external workforce API

---

## Dev Access

Sign in as admin:
- Email: `admin@clipper.internal`
- Password: `adminpass123`

Then navigate to `/admin`.
