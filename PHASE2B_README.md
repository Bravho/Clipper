# Phase 2B — Requester Portal Module

## Overview

Phase 2B builds the full requester-facing portal on top of the Phase 2A
auth and account foundation. Requesters can submit clip requests, track
their status, view queue and due date information, manage credits, and
review the platform's legal policies.

---

## What Was Built

### Pages

| Route | Description |
|---|---|
| `/dashboard` | Requester home — credits, active requests, delivery summary |
| `/dashboard/requests` | My Requests — filterable list of all submissions |
| `/dashboard/requests/new` | New Request — full clip brief form with upload zone |
| `/dashboard/requests/[id]` | Request Detail — status, timeline, brief, files, links |
| `/dashboard/credits` | Credits — balance, transaction history, pricing info |
| `/dashboard/legal` | Legal & Policy — ToS, ownership, privacy, storage |

### API Routes

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/requests` | Create a draft clip request |
| `PUT` | `/api/requests/[id]` | Update a draft |
| `DELETE` | `/api/requests/[id]` | Delete a draft |
| `POST` | `/api/requests/[id]/submit` | Submit a draft (charges credits) |
| `POST` | `/api/uploads/[requestId]` | Mock file upload |

### Domain Layer (new in 2B)

```
src/domain/enums/
  RequestStatus.ts     — 10 lifecycle statuses
  Platform.ts          — 6 publishing platforms
  AssetType.ts         — Video/Image, upload limits

src/domain/models/
  ClipRequest.ts       — Core request entity
  RequestStatusHistory.ts — Status change log
  UploadedAsset.ts     — Source file metadata
  PublishingLink.ts    — Delivery links per platform
```

### Repository Layer (new in 2B — mock only)

```
src/repositories/interfaces/
  IClipRequestRepository.ts
  IRequestStatusHistoryRepository.ts
  IUploadedAssetRepository.ts
  IPublishingLinkRepository.ts

src/repositories/mock/
  MockClipRequestRepository.ts
  MockRequestStatusHistoryRepository.ts
  MockUploadedAssetRepository.ts
  MockPublishingLinkRepository.ts
```

### Service Layer (new in 2B)

```
src/services/
  ClipRequestService.ts          — Request lifecycle (create, update, submit, delete)
  RequestPresentationService.ts  — Requester-facing view models
  RequesterDashboardService.ts   — Dashboard aggregation
  UploadService.ts               — File upload (mock + placeholder for DO Spaces)
```

### Validation

```
src/features/requests/validation/clipRequestSchema.ts
  — clipRequestFormSchema (form fields)
  — submitClipRequestSchema (form + legal confirmations)
  — STYLE_OPTIONS, LANGUAGE_OPTIONS
  — validateUploadCount()
```

### UI Components (new in 2B)

```
src/components/ui/
  Select.tsx
  Textarea.tsx

src/features/requests/components/
  NewRequestForm.tsx      — Full request creation form (client component)
  RequestStatusBadge.tsx  — Colour-coded status badge
  DueDateDisplay.tsx      — Requester-facing due date area
  QueueDisplay.tsx        — (via service, inline in pages)
  RequestTimeline.tsx     — Chronological status history
  DeliveryLinks.tsx       — Published/delivered link list
```

### Seed Data

```
src/seed/requestSeedData.ts
  — 9 requests covering all statuses
  — Status history for each request
  — Sample uploaded assets
  — Publishing links for delivered requests
  — Credit transactions (signup bonus, admin grant, request charges)
```

---

## Architecture Decisions

### Repository Pattern

All database access goes through repository interfaces. Services never
import a concrete repository class directly — only the interfaces.
The singleton instances in `src/repositories/index.ts` are the only
place where the concrete implementation choice is made.

This means swapping from mock to PostgreSQL requires changing **one line**
per repository in `index.ts`, nothing else.

### Service Layer

Business logic (credit checks, status transitions, legal confirmation
validation) lives in services, not in pages or API routes. Pages are
thin — they call services and pass results to components.

### Presentation Service

`RequestPresentationService` is a dedicated class that converts domain
models into requester-friendly view models. It owns all "what should
the requester see?" logic:
- Status badge labels and colours
- Due date display (pending vs. confirmed)
- Queue messages

This keeps the logic testable and consistent across all pages.

### Due Date Business Rule

**Requesters only see the confirmed due date after staff explicitly confirms it.**

Before confirmation, the requester sees:
> "Your request is under review. An expected completion date will appear
> here once our team confirms production timing."

The internal `estimatedDueDate` is never exposed to the requester.

---

## Setup Instructions

Assuming Phase 2A is already installed and running:

```bash
# No additional packages required in Phase 2B
# (react-hook-form, @hookform/resolvers, zod already installed in 2A)

npm run dev
```

Log in as `user@example.com` / `password123` to explore the requester portal.

The seed data provides 9 requests in various states, publishing links,
uploaded assets, and a full credit transaction history.

---

## Running Tests

```bash
npm test
# or
npx jest tests/services/ClipRequestService.test.ts
npx jest tests/services/RequestPresentationService.test.ts
npx jest tests/validation/clipRequestSchema.test.ts
npx jest tests/services/UploadService.test.ts
```

---

## PostgreSQL Integration Guide

When you are ready to connect Phase 2B to PostgreSQL:

### 1. Database Schema

Run these SQL commands:

```sql
-- Request statuses enum
CREATE TYPE request_status AS ENUM (
  'draft', 'submitted', 'under_review', 'accepted_for_production',
  'editing', 'scheduled_for_publishing', 'published', 'delivered',
  'on_hold', 'rejected'
);

CREATE TYPE platform AS ENUM (
  'tiktok', 'facebook', 'instagram', 'youtube', 'tvent_app', 'cdn'
);

CREATE TABLE clip_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id),
  title               VARCHAR(100) NOT NULL,
  description         TEXT NOT NULL,
  target_audience     TEXT NOT NULL,
  target_platforms    TEXT[] NOT NULL,
  preferred_style     TEXT NOT NULL,
  preferred_language  TEXT NOT NULL,
  status              request_status NOT NULL DEFAULT 'draft',
  estimated_due_date  TIMESTAMPTZ,
  confirmed_due_date  TIMESTAMPTZ,
  due_date_confirmed  BOOLEAN NOT NULL DEFAULT false,
  hold_reason         TEXT,
  rejection_reason    TEXT,
  queue_position      INTEGER,
  credit_confirmed    BOOLEAN NOT NULL DEFAULT false,
  rights_confirmed    BOOLEAN NOT NULL DEFAULT false,
  credits_cost        INTEGER NOT NULL DEFAULT 10,
  submitted_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clip_requests_user_id ON clip_requests(user_id);
CREATE INDEX idx_clip_requests_status ON clip_requests(status);
CREATE INDEX idx_clip_requests_user_status ON clip_requests(user_id, status);

CREATE TABLE request_status_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES clip_requests(id) ON DELETE CASCADE,
  status      request_status NOT NULL,
  note        TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_status_history_request ON request_status_history(request_id);

CREATE TYPE asset_upload_status AS ENUM (
  'pending', 'uploading', 'uploaded', 'failed', 'deleted'
);

CREATE TABLE uploaded_assets (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id              UUID NOT NULL REFERENCES clip_requests(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users(id),
  file_name               TEXT NOT NULL,
  asset_type              TEXT NOT NULL CHECK (asset_type IN ('video', 'image')),
  file_size_bytes         BIGINT NOT NULL,
  mime_type               TEXT NOT NULL,
  storage_key             TEXT NOT NULL DEFAULT '',
  storage_url             TEXT NOT NULL DEFAULT '',
  upload_status           asset_upload_status NOT NULL DEFAULT 'pending',
  scheduled_deletion_at   TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_uploaded_assets_request ON uploaded_assets(request_id);

CREATE TABLE publishing_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES clip_requests(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
  url           TEXT NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_publishing_links_request ON publishing_links(request_id);
```

### 2. Implement Postgres Repositories

Create these files (follow the pattern of existing Postgres repos):
- `src/repositories/postgres/PostgresClipRequestRepository.ts`
- `src/repositories/postgres/PostgresRequestStatusHistoryRepository.ts`
- `src/repositories/postgres/PostgresUploadedAssetRepository.ts`
- `src/repositories/postgres/PostgresPublishingLinkRepository.ts`

### 3. Update the Registry

In `src/repositories/index.ts`, replace the four Mock* imports with Postgres*:

```typescript
// Before
export const clipRequestRepository = new MockClipRequestRepository();

// After
export const clipRequestRepository = new PostgresClipRequestRepository();
```

### 4. Transaction Safety

When submitting a request (ClipRequestService.submitRequest), wrap
the credit deduction + status update in a PostgreSQL transaction:

```typescript
await db.query('BEGIN');
try {
  // deduct credits
  // update status
  // log history
  await db.query('COMMIT');
} catch (e) {
  await db.query('ROLLBACK');
  throw e;
}
```

Use `SELECT ... FOR UPDATE` on the credit wallet row to prevent
race conditions under concurrent submissions.

---

## DigitalOcean Spaces Integration Guide

### Architecture (when implemented)

Replace the mock upload in `UploadService.ts` with this flow:

```
1. Client submits file metadata → POST /api/uploads/[requestId]
2. Server creates pending UploadedAsset record
3. Server generates presigned PUT URL via DO Spaces SDK
4. Server returns { assetId, presignedUrl, storageKey }
5. Client PUTs file directly to presignedUrl (no server roundtrip for bytes)
6. Client calls POST /api/uploads/[requestId]/confirm { assetId }
7. Server marks asset as Uploaded in DB
```

### Required Environment Variables

```env
DO_SPACES_ENDPOINT=sgp1.digitaloceanspaces.com
DO_SPACES_BUCKET=rclipper-uploads
DO_SPACES_KEY=your-access-key
DO_SPACES_SECRET=your-secret-key
DO_SPACES_REGION=sgp1
DO_SPACES_CDN_ENDPOINT=https://rclipper-uploads.sgp1.cdn.digitaloceanspaces.com
```

### Storage Key Convention

```
uploads/{userId}/{requestId}/{uuid}/{filename}
```

### 90-Day Retention

Set `scheduled_deletion_at = uploaded_at + 90 days` on each record.
Implement a cron job or DO Spaces lifecycle policy to delete expired objects.

---

## Staff / Admin Integration Points

When building the staff and admin portals, they will plug into this module by:

1. **Reading clip requests** via `IClipRequestRepository.findById()` and
   listing via custom staff queries (all statuses, all users).

2. **Updating status** via `IClipRequestRepository.updateStatus()` —
   the same interface used here. Staff transitions like "accept for
   production" or "put on hold" use the same method.

3. **Confirming due dates** by calling `updateStatus()` with
   `extra.confirmedDueDate` and `extra.dueDateConfirmed = true`.
   Once confirmed, requesters will automatically see the date.

4. **Adding publishing links** via `IPublishingLinkRepository.create()`.
   Once links are added and status is set to Published/Delivered,
   requesters see them on the Request Detail page.

5. **Staff RequestPresentationService** (to be created) — build a parallel
   service that exposes internal details (raw estimated dates, queue depth,
   internal notes) that are intentionally hidden from `RequestPresentationService`.

---

## Future Integration Points

| Feature | Integration Point |
|---|---|
| Email notifications | Hook into `ClipRequestService.submitRequest()` and status update events |
| In-app notifications | Same hooks, different delivery channel |
| Publishing automation | `IPublishingLinkRepository.create()` called by webhook handlers |
| Payment / credit top-up | `CreditService.grantCredits()` + new `BillingService` |
| Admin analytics | New `AdminAnalyticsService` querying existing repositories |
| Requester messaging | New `MessageRepository` + thread model |
