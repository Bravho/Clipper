/**
 * Seed data for Phase 2C — Staff Portal.
 *
 * Provides realistic internal notes and staff-specific context
 * for all relevant seed requests so the full staff portal can be
 * explored without a live database.
 *
 * Staff seed users (from Phase 2A mockData.ts):
 *   - staff@clipper.internal  (id: "user-staff-001")
 *   - admin@clipper.internal  (id: "user-admin-001")
 *
 * Request IDs used here correspond to SEED_CLIP_REQUESTS in requestSeedData.ts.
 *
 * TODO: Remove / replace this file when PostgreSQL is connected.
 *   Internal notes will live in the `internal_notes` table.
 */

import type { InternalNote } from "@/domain/models/InternalNote";

const STAFF_ID = "user-staff-001";
const ADMIN_ID = "user-admin-001";
const STAFF_NAME = "Staff User";
const ADMIN_NAME = "Admin User";

const d = (iso: string) => new Date(iso);

// ─── Internal Notes ──────────────────────────────────────────────────────────
export const SEED_INTERNAL_NOTES: InternalNote[] = [
  // req-002: Under Review — review in progress
  {
    id: "note-002-1",
    requestId: "req-002",
    authorId: STAFF_ID,
    authorName: STAFF_NAME,
    content:
      "Reviewed uploaded assets. Brand footage quality is good. Logo is high-res. Brief is clear. Classifying as Standard effort — will confirm due date once queue is assessed.",
    createdAt: d("2026-02-21T09:30:00Z"),
    updatedAt: d("2026-02-21T09:30:00Z"),
  },

  // req-003: Accepted for Production — handoff note
  {
    id: "note-003-1",
    requestId: "req-003",
    authorId: STAFF_ID,
    authorName: STAFF_NAME,
    content:
      "Accepted. Materials look usable. Confirmed due date: 10 March. Simple effort classification — straightforward promo with text overlays.",
    createdAt: d("2026-03-02T09:15:00Z"),
    updatedAt: d("2026-03-02T09:15:00Z"),
  },

  // req-004: Editing — progress notes
  {
    id: "note-004-1",
    requestId: "req-004",
    authorId: STAFF_ID,
    authorName: STAFF_NAME,
    content:
      "Started editing in CapCut. Project: Newsletter-Mar2026. Rough cut assembled. Adding animated stat cards and lower thirds.",
    createdAt: d("2026-02-28T13:30:00Z"),
    updatedAt: d("2026-02-28T13:30:00Z"),
  },
  {
    id: "note-004-2",
    requestId: "req-004",
    authorId: STAFF_ID,
    authorName: STAFF_NAME,
    content:
      "Captions done. Working on outro. Confident for 8 March delivery. Will export v1 today for internal review.",
    createdAt: d("2026-03-06T10:00:00Z"),
    updatedAt: d("2026-03-06T10:00:00Z"),
  },

  // req-005: Published — notes from production through publishing
  {
    id: "note-005-1",
    requestId: "req-005",
    authorId: STAFF_ID,
    authorName: STAFF_NAME,
    content:
      "Complex effort — cinematic style required multi-layer comp. CapCut project: Q1-Campaign-Teaser-Final. First export ready 7 Feb.",
    createdAt: d("2026-02-07T14:30:00Z"),
    updatedAt: d("2026-02-07T14:30:00Z"),
  },
  {
    id: "note-005-2",
    requestId: "req-005",
    authorId: STAFF_ID,
    authorName: STAFF_NAME,
    content: "Published to TikTok and Instagram. YouTube upload still pending — requester targeted YouTube but link not added yet.",
    createdAt: d("2026-02-08T12:30:00Z"),
    updatedAt: d("2026-02-08T12:30:00Z"),
  },

  // req-006: Delivered — final delivery note
  {
    id: "note-006-1",
    requestId: "req-006",
    authorId: STAFF_ID,
    authorName: STAFF_NAME,
    content:
      "All three channels published. CDN link confirmed working. Marked delivered. Raw footage retained until April 2026 deletion date.",
    createdAt: d("2026-01-22T14:30:00Z"),
    updatedAt: d("2026-01-22T14:30:00Z"),
  },

  // req-007: On Hold — hold reason + internal context
  {
    id: "note-007-1",
    requestId: "req-007",
    authorId: STAFF_ID,
    authorName: STAFF_NAME,
    content:
      "Attempted to open uploaded video — file is unplayable (likely re-encoded incorrectly). Placed on hold. Requester notified via hold reason message. Awaiting re-upload.",
    createdAt: d("2026-03-03T11:30:00Z"),
    updatedAt: d("2026-03-03T11:30:00Z"),
  },

  // req-008: Rejected — rejection rationale
  {
    id: "note-008-1",
    requestId: "req-008",
    authorId: STAFF_ID,
    authorName: STAFF_NAME,
    content:
      "Brief explicitly requests a specific copyrighted track. We cannot license this. Policy violation — rejected. Requester can resubmit with original audio or royalty-free music.",
    createdAt: d("2026-02-10T09:45:00Z"),
    updatedAt: d("2026-02-10T09:45:00Z"),
  },

  // req-009: Submitted — initial triage note
  {
    id: "note-009-1",
    requestId: "req-009",
    authorId: ADMIN_ID,
    authorName: ADMIN_NAME,
    content:
      "New submission. Assigned to review queue. Brief looks clean — product demo with clear value prop. No uploads yet — check if requester will add files.",
    createdAt: d("2026-03-05T16:00:00Z"),
    updatedAt: d("2026-03-05T16:00:00Z"),
  },
];
