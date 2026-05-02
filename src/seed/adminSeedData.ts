/**
 * Seed data for Phase 2D — Admin Portal.
 *
 * Adds:
 *   - req-010: ScheduledForPublishing (pending admin production review)
 *   - req-011: Editing, overdue (from a second requester context)
 *   - req-012: Submitted (fresh, awaiting review)
 *   - ProductionReview records for req-010, req-005, req-006
 *   - Additional internal notes for req-010
 *
 * These supplement the Phase 2B requestSeedData.ts entries.
 * Request IDs req-001 through req-009 are defined in requestSeedData.ts.
 *
 * TODO: Remove / replace this file when PostgreSQL is connected.
 *   Seed data will live in database migration scripts instead.
 */

import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Platform } from "@/domain/enums/Platform";
import { EffortClass } from "@/domain/enums/EffortClass";
import { ProductionReviewStatus } from "@/domain/enums/ProductionReviewStatus";
import type { ClipRequest } from "@/domain/models/ClipRequest";
import type { ProductionReview } from "@/domain/models/ProductionReview";
import type { RequestStatusHistory } from "@/domain/models/RequestStatusHistory";
import type { InternalNote } from "@/domain/models/InternalNote";

const REQUESTER_ID = "user-requester-001";
const STAFF_ID = "user-staff-001";
const ADMIN_ID = "user-admin-001";

const d = (iso: string) => new Date(iso);

// ─── Additional Clip Requests ────────────────────────────────────────────────

export const ADMIN_SEED_CLIP_REQUESTS: ClipRequest[] = [
  // ── req-010: ScheduledForPublishing — pending admin production review ──────
  // This is the primary demo request for the admin production review workflow.
  {
    id: "req-010",
    userId: REQUESTER_ID,
    title: "Fitness Tracker Launch Clip",
    description:
      "A punchy launch clip for our new fitness tracker app. Focus on the activity dashboard, sleep tracking, and premium design. Max 25 seconds.",
    targetAudience: "Health-conscious adults aged 22–40, gym-goers and runners",
    targetPlatforms: [Platform.TikTok, Platform.Instagram, Platform.YouTube],
    preferredStyle: "Dynamic / Energetic",
    preferredLanguage: "English",
    status: RequestStatus.ScheduledForPublishing,
    estimatedDueDate: d("2026-03-08T00:00:00Z"),
    confirmedDueDate: d("2026-03-09T00:00:00Z"),
    dueDateConfirmed: true,
    holdReason: null,
    rejectionReason: null,
    queuePosition: null,
    creditConfirmed: true,
    rightsConfirmed: true,
    creditsCost: 10,
    submittedAt: d("2026-03-01T10:00:00Z"),
    createdAt: d("2026-03-01T09:00:00Z"),
    updatedAt: d("2026-03-09T11:00:00Z"),
    effortClass: EffortClass.Standard,
    assignedStaffId: STAFF_ID,
  },

  // ── req-011: Editing — second active editing request (different staff) ─────
  {
    id: "req-011",
    userId: REQUESTER_ID,
    title: "Team Culture Highlight Reel",
    description:
      "A short reel showcasing our company culture, team events, and workspace. Warm and authentic feel.",
    targetAudience: "Potential hires and existing employees",
    targetPlatforms: [Platform.YouTube, Platform.Facebook],
    preferredStyle: "Calm / Informative",
    preferredLanguage: "English",
    status: RequestStatus.Editing,
    estimatedDueDate: d("2026-03-07T00:00:00Z"),
    confirmedDueDate: d("2026-03-07T00:00:00Z"),
    dueDateConfirmed: true,
    holdReason: null,
    rejectionReason: null,
    queuePosition: null,
    creditConfirmed: true,
    rightsConfirmed: true,
    creditsCost: 10,
    submittedAt: d("2026-03-02T09:00:00Z"),
    createdAt: d("2026-03-02T08:00:00Z"),
    // Overdue — confirmed date was 7 March, now 10 March
    updatedAt: d("2026-03-05T14:00:00Z"),
    effortClass: EffortClass.Complex,
    assignedStaffId: "user-staff-002",
  },

  // ── req-012: Submitted — fresh, awaiting staff review ────────────────────
  {
    id: "req-012",
    userId: REQUESTER_ID,
    title: "Customer Success Story",
    description:
      "We want to showcase a recent customer success story with before/after context, short interview snippet overlay, and key metrics.",
    targetAudience: "Prospects and existing customers",
    targetPlatforms: [Platform.YouTube, Platform.TikTok],
    preferredStyle: "Professional / Corporate",
    preferredLanguage: "English",
    status: RequestStatus.Submitted,
    estimatedDueDate: null,
    confirmedDueDate: null,
    dueDateConfirmed: false,
    holdReason: null,
    rejectionReason: null,
    queuePosition: 6,
    creditConfirmed: true,
    rightsConfirmed: true,
    creditsCost: 10,
    submittedAt: d("2026-03-09T15:00:00Z"),
    createdAt: d("2026-03-09T14:30:00Z"),
    updatedAt: d("2026-03-09T15:00:00Z"),
    effortClass: null,
    assignedStaffId: null,
  },
];

// ─── Production Review Records ───────────────────────────────────────────────
// One record per production review cycle. A request with multiple cycles
// (returned and resubmitted) will have multiple records.

export const SEED_PRODUCTION_REVIEWS: ProductionReview[] = [
  // req-005: Q1 Campaign Teaser — historical approved review
  {
    id: "pr-001",
    requestId: "req-005",
    status: ProductionReviewStatus.Approved,
    reviewedBy: ADMIN_ID,
    reviewNote: "Clip quality excellent. Cinematic style achieved. Approved for publishing.",
    submittedAt: d("2026-02-07T14:00:00Z"),
    reviewedAt: d("2026-02-07T16:30:00Z"),
    createdAt: d("2026-02-07T14:00:00Z"),
    updatedAt: d("2026-02-07T16:30:00Z"),
  },

  // req-006: Holiday Special Recap — historical approved review
  {
    id: "pr-002",
    requestId: "req-006",
    status: ProductionReviewStatus.Approved,
    reviewedBy: ADMIN_ID,
    reviewNote: "Warm and well-executed. All target platforms covered. Approved.",
    submittedAt: d("2026-01-19T11:00:00Z"),
    reviewedAt: d("2026-01-19T14:00:00Z"),
    createdAt: d("2026-01-19T11:00:00Z"),
    updatedAt: d("2026-01-19T14:00:00Z"),
  },

  // req-010: Fitness Tracker Launch Clip — PENDING (the active admin review item)
  {
    id: "pr-003",
    requestId: "req-010",
    status: ProductionReviewStatus.Pending,
    reviewedBy: null,
    reviewNote: null,
    submittedAt: d("2026-03-09T11:00:00Z"),
    reviewedAt: null,
    createdAt: d("2026-03-09T11:00:00Z"),
    updatedAt: d("2026-03-09T11:00:00Z"),
  },
];

// ─── Status History for Admin Seed Requests ──────────────────────────────────

export const ADMIN_SEED_STATUS_HISTORY: RequestStatusHistory[] = [
  // req-010: ScheduledForPublishing
  {
    id: "sh-010-1",
    requestId: "req-010",
    status: RequestStatus.Submitted,
    note: null,
    changedAt: d("2026-03-01T10:00:00Z"),
  },
  {
    id: "sh-010-2",
    requestId: "req-010",
    status: RequestStatus.UnderReview,
    note: null,
    changedAt: d("2026-03-02T09:00:00Z"),
  },
  {
    id: "sh-010-3",
    requestId: "req-010",
    status: RequestStatus.AcceptedForProduction,
    note: "Materials good. Confirmed due 9 March. Standard effort.",
    changedAt: d("2026-03-03T10:00:00Z"),
  },
  {
    id: "sh-010-4",
    requestId: "req-010",
    status: RequestStatus.Editing,
    note: null,
    changedAt: d("2026-03-05T09:00:00Z"),
  },
  {
    id: "sh-010-5",
    requestId: "req-010",
    status: RequestStatus.ScheduledForPublishing,
    note: "Editing complete. Final cut uploaded. Submitted for admin production review.",
    changedAt: d("2026-03-09T11:00:00Z"),
  },

  // req-011: Editing
  {
    id: "sh-011-1",
    requestId: "req-011",
    status: RequestStatus.Submitted,
    note: null,
    changedAt: d("2026-03-02T09:00:00Z"),
  },
  {
    id: "sh-011-2",
    requestId: "req-011",
    status: RequestStatus.UnderReview,
    note: null,
    changedAt: d("2026-03-03T09:00:00Z"),
  },
  {
    id: "sh-011-3",
    requestId: "req-011",
    status: RequestStatus.AcceptedForProduction,
    note: "Complex — multi-scene culture reel. Confirmed 7 March.",
    changedAt: d("2026-03-03T14:00:00Z"),
  },
  {
    id: "sh-011-4",
    requestId: "req-011",
    status: RequestStatus.Editing,
    note: null,
    changedAt: d("2026-03-05T09:00:00Z"),
  },

  // req-012: Submitted
  {
    id: "sh-012-1",
    requestId: "req-012",
    status: RequestStatus.Submitted,
    note: null,
    changedAt: d("2026-03-09T15:00:00Z"),
  },
];

// ─── Internal Notes for Admin Seed Requests ───────────────────────────────────

export const ADMIN_SEED_INTERNAL_NOTES: InternalNote[] = [
  // req-010: notes through editing and production review submission
  {
    id: "note-010-1",
    requestId: "req-010",
    authorId: STAFF_ID,
    authorName: "Staff User",
    content:
      "Accepted. Materials solid — clean app screenshots, good dynamic footage. Standard effort. Confirmed due 9 March.",
    createdAt: d("2026-03-03T10:15:00Z"),
    updatedAt: d("2026-03-03T10:15:00Z"),
  },
  {
    id: "note-010-2",
    requestId: "req-010",
    authorId: STAFF_ID,
    authorName: "Staff User",
    content:
      "Editing done. CapCut project: FitnessTracker-Launch-v2. Export: fitness-tracker-launch-final.mp4. Energy level matches brief — added beat sync on transitions. Submitted for admin review.",
    createdAt: d("2026-03-09T11:00:00Z"),
    updatedAt: d("2026-03-09T11:00:00Z"),
  },

  // req-011: editing note (overdue)
  {
    id: "note-011-1",
    requestId: "req-011",
    authorId: "user-staff-002",
    authorName: "Taylor Staff",
    content:
      "Complex culture reel — gathering multiple scene clips. Office, team event, and workspace segments. Running behind schedule due to footage volume. Will submit by 10 March.",
    createdAt: d("2026-03-06T16:00:00Z"),
    updatedAt: d("2026-03-06T16:00:00Z"),
  },

  // req-012: triage note
  {
    id: "note-012-1",
    requestId: "req-012",
    authorId: ADMIN_ID,
    authorName: "Admin User",
    content:
      "Fresh submission. Brief is clear and well-structured. No uploads noted yet — should check whether requester will add footage or if operator will source stock.",
    createdAt: d("2026-03-09T16:00:00Z"),
    updatedAt: d("2026-03-09T16:00:00Z"),
  },
];
