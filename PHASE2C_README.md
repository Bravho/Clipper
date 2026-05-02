# Phase 2C — Staff Portal Module

## Overview

Phase 2C implements the **RClipper Staff Portal** — the internal operational interface for managing clip request production, review, due dates, editing, publishing, and delivery.

Staff use this portal to:
- Review new submissions and check uploaded materials
- Classify effort and confirm due dates
- Track CapCut editing progress
- Record publishing links
- Mark requests as Published and Delivered
- Add internal notes visible only to staff

The staff portal plugs into the Phase 2A (Auth/Account) and Phase 2B (Requester Portal) foundations without rebuilding them.

---

## Architecture

### Folder Additions (Phase 2C)

```
src/
├── domain/
│   ├── enums/
│   │   └── EffortClass.ts              # Simple | Standard | Complex
│   └── models/
│       ├── ClipRequest.ts              # Extended with staff fields (effortClass, capCutProjectRef, etc.)
│       └── InternalNote.ts             # Staff-only notes per request
│
├── repositories/
│   ├── interfaces/
│   │   ├── IClipRequestRepository.ts   # Extended: findByStatus(), findAll(), countByStatus(), findOverdue(), findPendingDueDateConfirmation(), updateStaffFields()
│   │   └── IInternalNoteRepository.ts  # New: CRUD for internal notes
│   └── mock/
│       ├── MockClipRequestRepository.ts   # Updated: implements new interface methods + staff field initialization
│       └── MockInternalNoteRepository.ts  # New: in-memory internal notes
│
├── services/
│   └── staff/
│       ├── StaffWorkflowService.ts             # Status transitions with validation
│       ├── DueDateConfirmationService.ts       # Due date estimation and confirmation
│       ├── InternalNoteService.ts              # Staff note creation and retrieval
│       ├── PublishingService.ts                # Publishing link recording + delivery
│       ├── StaffDashboardService.ts            # Dashboard summary aggregation
│       └── StaffRequestPresentationService.ts  # Staff-facing view model builder
│
├── features/
│   └── staff/
│       ├── components/
│       │   ├── StaffStatusBadge.tsx       # Status badge with staff labels
│       │   ├── StaffRequestTable.tsx      # Reusable request list table
│       │   ├── StaffActionButtons.tsx     # Client component: all workflow action buttons + modals
│       │   ├── InternalNotesPanel.tsx     # Client component: note list + add form
│       │   └── CapCutWorkflowPanel.tsx    # Client component: CapCut workflow fields
│       └── validation/
│           └── staffActionSchemas.ts      # Zod schemas for all staff API inputs
│
├── seed/
│   ├── requestSeedData.ts    # Updated: added staff fields to relevant requests
│   └── staffSeedData.ts      # New: SEED_INTERNAL_NOTES for Phase 2C
│
└── app/
    ├── (auth)/staff/
    │   ├── layout.tsx              # Staff portal layout with top nav
    │   ├── page.tsx                # Staff dashboard home
    │   ├── review/page.tsx         # Review queue (Submitted + UnderReview)
    │   ├── production/page.tsx     # Production queue (AcceptedForProduction)
    │   ├── due-dates/page.tsx      # Due date confirmation queue
    │   ├── editing/page.tsx        # Editing queue with CapCut context
    │   ├── publishing/page.tsx     # Publishing + delivery queue
    │   ├── on-hold/page.tsx        # On Hold requests
    │   ├── rejected/page.tsx       # Rejected requests
    │   ├── workload/page.tsx       # Operational workload summary
    │   └── requests/[id]/page.tsx  # Staff request detail page
    └── api/staff/
        ├── requests/[id]/
        │   ├── review/route.ts     # POST → mark Under Review
        │   ├── accept/route.ts     # POST → accept for production
        │   ├── hold/route.ts       # POST → put on hold (with reason)
        │   ├── reject/route.ts     # POST → reject (with reason)
        │   ├── resume/route.ts     # POST → resume from hold
        │   ├── due-date/route.ts   # POST → confirm due date | PATCH → update effort class
        │   ├── editing/route.ts    # POST → move to editing | PATCH → update CapCut fields
        │   ├── schedule/route.ts   # POST → schedule for publishing
        │   ├── publish/route.ts    # POST → mark published | PUT → add publishing link
        │   └── deliver/route.ts    # POST → mark delivered
        └── notes/[requestId]/
            └── route.ts            # GET → list notes | POST → add note
```

---

## Staff Workflow

### Status Transition Map

```
Submitted ──────────────────────┐
                                 │
UnderReview ← Submitted         │ OnHold
AcceptedForProduction ← UnderReview │ Rejected (from any active)
Editing ← AcceptedForProduction │
ScheduledForPublishing ← Editing│
Published ← ScheduledForPublishing
Delivered ← Published

OnHold → UnderReview (resume)
```

Transitions are centralized in `StaffWorkflowService.ts` and enforced server-side.
No page component or API route can bypass the validation.

### Due Date Workflow

1. Staff classifies effort (Simple / Standard / Complex)
2. System estimates due date (+1 / +2 / +3 working days, skipping weekends)
3. Staff reviews the estimate and clicks **Confirm Due Date**
4. Requester sees the confirmed date — before this, they see a pending message

### CapCut Workflow

1. Staff accepts request and moves to Editing
2. Staff opens CapCut externally, edits the clip
3. Staff returns to the staff portal and updates:
   - CapCut project reference (their own reference)
   - Editing progress note
   - Export ready checkbox
   - Latest export filename note
4. When done, staff moves to Scheduled for Publishing

**There is no CapCut API integration.** The portal is the control layer; CapCut is the external tool.

### Publishing Workflow

1. Staff exports clip from CapCut
2. Staff manually uploads/posts to each social platform
3. Staff records the URL for each platform in the portal
4. Staff clicks **Mark Published**
5. Staff clicks **Mark Delivered** when all links are confirmed

---

## Running the Staff Portal

### Prerequisites

Same as Phase 2A/2B setup. See main README.

### Dev server

```bash
npm run dev
```

Navigate to `http://localhost:3000/staff` and sign in as:
- `staff@clipper.internal` / `staffpass123`
- `admin@clipper.internal` / `adminpass123`

### Seed data

The staff portal uses the existing Phase 2B seed requests, extended with:
- Effort class classifications
- CapCut project references and progress notes
- Export ready flags

Internal notes are loaded from `src/seed/staffSeedData.ts`.

All seed requests covering every status are available immediately without a database.

---

## Tests

```bash
npm test                     # Run all tests
npm test -- StaffWorkflow    # Run StaffWorkflowService tests only
npm test -- DueDate          # Run DueDateConfirmationService tests only
npm test -- InternalNote     # Run InternalNoteService tests only
npm test -- Publishing       # Run PublishingService tests only
```

New test files:
- `tests/services/StaffWorkflowService.test.ts`
- `tests/services/DueDateConfirmationService.test.ts`
- `tests/services/InternalNoteService.test.ts`
- `tests/services/PublishingService.test.ts`
- `tests/services/StaffRequestPresentationService.test.ts`

---

## PostgreSQL Replacement Notes

All Phase 2C repositories use mock implementations. To connect PostgreSQL:

### Step 1 — Implement Postgres repository classes

```
src/repositories/postgres/
  PostgresClipRequestRepository.ts     # Implements IClipRequestRepository (updated interface)
  PostgresRequestStatusHistoryRepository.ts
  PostgresUploadedAssetRepository.ts
  PostgresPublishingLinkRepository.ts
  PostgresInternalNoteRepository.ts    # NEW — Phase 2C
```

### Step 2 — New SQL columns needed

```sql
-- Add staff-specific columns to clip_requests table
ALTER TABLE clip_requests ADD COLUMN effort_class TEXT CHECK (effort_class IN ('simple', 'standard', 'complex')) DEFAULT NULL;
ALTER TABLE clip_requests ADD COLUMN capcut_project_ref TEXT DEFAULT NULL;
ALTER TABLE clip_requests ADD COLUMN editing_progress_note TEXT DEFAULT NULL;
ALTER TABLE clip_requests ADD COLUMN export_ready BOOLEAN DEFAULT false;
ALTER TABLE clip_requests ADD COLUMN latest_export_note TEXT DEFAULT NULL;
```

### Step 3 — New internal_notes table

```sql
CREATE TABLE internal_notes (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    TEXT NOT NULL REFERENCES clip_requests(id) ON DELETE CASCADE,
  author_id     TEXT NOT NULL REFERENCES users(id),
  author_name   TEXT NOT NULL,
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_internal_notes_request_id ON internal_notes (request_id, created_at DESC);
CREATE INDEX idx_internal_notes_author_id  ON internal_notes (author_id);
```

### Step 4 — New staff query indexes

```sql
CREATE INDEX idx_clip_requests_status ON clip_requests (status);
CREATE INDEX idx_clip_requests_status_submitted ON clip_requests (status, submitted_at ASC);
CREATE INDEX idx_clip_requests_due_date ON clip_requests (confirmed_due_date) WHERE confirmed_due_date IS NOT NULL;
```

### Step 5 — Update repositories/index.ts

Replace:
```typescript
// Phase 2B and 2C Mock imports
import { MockClipRequestRepository } from "./mock/MockClipRequestRepository";
import { MockInternalNoteRepository } from "./mock/MockInternalNoteRepository";
// ...

export const clipRequestRepository = new MockClipRequestRepository();
export const internalNoteRepository = new MockInternalNoteRepository();
```

With:
```typescript
import { PostgresClipRequestRepository } from "./postgres/PostgresClipRequestRepository";
import { PostgresInternalNoteRepository } from "./postgres/PostgresInternalNoteRepository";
// ...

export const clipRequestRepository = new PostgresClipRequestRepository();
export const internalNoteRepository = new PostgresInternalNoteRepository();
```

**No service or page changes required** — services only import via `repositories/index.ts`.

---

## DigitalOcean Spaces Integration Notes

The staff portal has two future Spaces integration points:

### 1. Staff access to raw uploaded files

Currently, asset `storageUrl` fields in the seed data are placeholder paths.
When Spaces is fully wired:
- Add a staff API route: `GET /api/staff/assets/[assetId]/download`
- This calls `UploadService.generatePresignedDownloadUrl(storageKey)` for the asset
- Staff click the link on the request detail page to download the raw material for editing

**Where to add:** `src/app/(auth)/staff/requests/[id]/page.tsx` — asset list section has a `[storage link]` placeholder.

### 2. Final clip upload and delivery

When staff finishes editing and exports from CapCut:
- Add a staff API route: `POST /api/staff/requests/[id]/clip-upload`
- Returns a presigned PUT URL to `clips/{userId}/{date}/{requestId}/{filename}`
- Staff upload the final clip directly to Spaces
- The clip URL is stored for delivery

**Where to add:** `src/features/staff/components/CapCutWorkflowPanel.tsx` — has a TODO comment at the upload button location.

---

## Admin Portal Integration Notes

The Admin Portal (future phase) connects at these points:

### Staff workflow override
- `StaffWorkflowService` intentionally prevents invalid transitions
- Admin Portal will add `adminOverrideTransition(requestId, toStatus, reason)` — bypasses normal checks
- This should NOT be in the staff service — create a separate `AdminWorkflowService`

### Systemwide visibility
- `StaffDashboardService.getSummary()` returns aggregate counts only
- Admin Portal will extend this to: per-staff workload, per-requester history, SLA tracking
- Add: `AdminDashboardService` with separate, more detailed queries

### Internal notes
- Staff can see all notes on their own portal
- Admin Portal should allow viewing ALL notes across all requests, and deleting any note
- `IInternalNoteRepository` will need `findAll(limit?)` and `deleteById(id)` added

### Credit adjustments
- Admin Portal will add `AdminCredit` / `AdminDebit` operations
- `CreditService` already supports these transaction types (see Phase 2A)

---

## Subcontractor / RClipper Agent Service Integration Notes

Future external editor / agent workflow connects at these points:

### Status updates
- Agents would update status via the existing API routes or a new dedicated Agent API
- `StaffWorkflowService` is the correct place to add agent-triggered transitions
- Suggest: add `agentTransition(requestId, agentId, toStatus, note)` with agent-specific guards

### CapCut fields
- Agents would update `capCutProjectRef`, `editingProgressNote`, `exportReady`, `latestExportNote`
- These are already stored via `PATCH /api/staff/requests/[id]/editing`
- Agents would need their own auth token with a new `agent` role, or staff-delegated access

### Assignment
- Future: add `assignedStaffId` / `assignedAgentId` to `ClipRequest` model
- `StaffRequestTable` has an "assigned staff placeholder" column available
- `IClipRequestRepository` would get `findByAssignedAgent(agentId)` method
- The staff UI would show a "Assign to Agent" button in `StaffActionButtons.tsx`

---

## Open Questions (carry forward from Phase 2B)

1. Should the staff portal send notifications (email, in-app) to requesters when status changes?
2. Should On Hold requests auto-reject after 14 days?
3. Should staff be able to re-assign requests between staff members?
4. Should there be a "Dispatch to Agent" queue for future subcontractor workflow?
5. Interface language: English only for Phase 1?
