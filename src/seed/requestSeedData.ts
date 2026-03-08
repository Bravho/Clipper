/**
 * Seed data for Phase 2B — Requester Portal.
 *
 * Provides realistic mock data covering all request statuses so the
 * full requester portal can be explored without a live database.
 *
 * Seed requester: user@example.com (id: "user-requester-001")
 *
 * Credit accounting for seed requester:
 *   +30  signup bonus
 *   +70  admin credit grant (for dev/testing richness)
 *   -10  req-002 (submitted)
 *   -10  req-003 (accepted for production)
 *   -10  req-004 (editing)
 *   -10  req-005 (published)
 *   -10  req-006 (delivered)
 *   -10  req-007 (on hold)
 *   -10  req-008 (rejected)
 *   -10  req-009 (submitted)
 *   = 20 credits remaining
 *
 * TODO: Remove / replace this file when PostgreSQL is connected.
 *   Seed data will live in database migration scripts instead.
 */

import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Platform } from "@/domain/enums/Platform";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { TransactionType } from "@/domain/enums/TransactionType";
import type { ClipRequest } from "@/domain/models/ClipRequest";
import type { RequestStatusHistory } from "@/domain/models/RequestStatusHistory";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import type { PublishingLink } from "@/domain/models/PublishingLink";
import type { CreditTransaction } from "@/domain/models/CreditTransaction";
import type { CreditWallet } from "@/domain/models/CreditWallet";

const REQUESTER_ID = "user-requester-001";

// Reference dates (relative to 2026-03-08 "today")
const d = (iso: string) => new Date(iso);

// ─── Wallets override ───────────────────────────────────────────────────────
// The base seed wallet has 30 credits. We override to 20 to reflect
// the request charges below. This is imported and merged in mockData.ts.
export const SEED_REQUESTER_WALLET_OVERRIDE: Partial<CreditWallet> & {
  userId: string;
} = {
  userId: REQUESTER_ID,
  balance: 20,
  updatedAt: d("2026-03-07T10:00:00Z"),
};

// ─── Additional credit transactions ────────────────────────────────────────
export const SEED_REQUEST_TRANSACTIONS: CreditTransaction[] = [
  {
    id: "txn-admin-credit-001",
    userId: REQUESTER_ID,
    amount: 70,
    type: TransactionType.AdminCredit,
    description: "Development credit grant for testing purposes.",
    referenceId: null,
    createdAt: d("2026-01-10T09:00:00Z"),
  },
  {
    id: "txn-req-002",
    userId: REQUESTER_ID,
    amount: -10,
    type: TransactionType.RequestCharge,
    description: "Clip request: Brand Awareness Clip",
    referenceId: "req-002",
    createdAt: d("2026-02-20T11:00:00Z"),
  },
  {
    id: "txn-req-003",
    userId: REQUESTER_ID,
    amount: -10,
    type: TransactionType.RequestCharge,
    description: "Clip request: Summer Sale Promo",
    referenceId: "req-003",
    createdAt: d("2026-02-25T14:00:00Z"),
  },
  {
    id: "txn-req-004",
    userId: REQUESTER_ID,
    amount: -10,
    type: TransactionType.RequestCharge,
    description: "Clip request: Monthly Newsletter Highlight",
    referenceId: "req-004",
    createdAt: d("2026-02-18T09:30:00Z"),
  },
  {
    id: "txn-req-005",
    userId: REQUESTER_ID,
    amount: -10,
    type: TransactionType.RequestCharge,
    description: "Clip request: Q1 Campaign Teaser",
    referenceId: "req-005",
    createdAt: d("2026-01-28T16:00:00Z"),
  },
  {
    id: "txn-req-006",
    userId: REQUESTER_ID,
    amount: -10,
    type: TransactionType.RequestCharge,
    description: "Clip request: Holiday Special Recap",
    referenceId: "req-006",
    createdAt: d("2026-01-12T10:00:00Z"),
  },
  {
    id: "txn-req-007",
    userId: REQUESTER_ID,
    amount: -10,
    type: TransactionType.RequestCharge,
    description: "Clip request: Special Project Intro",
    referenceId: "req-007",
    createdAt: d("2026-03-01T13:00:00Z"),
  },
  {
    id: "txn-req-008",
    userId: REQUESTER_ID,
    amount: -10,
    type: TransactionType.RequestCharge,
    description: "Clip request: Quick Ad Spot",
    referenceId: "req-008",
    createdAt: d("2026-02-08T08:00:00Z"),
  },
  {
    id: "txn-req-009",
    userId: REQUESTER_ID,
    amount: -10,
    type: TransactionType.RequestCharge,
    description: "Clip request: New Product Demo",
    referenceId: "req-009",
    createdAt: d("2026-03-05T15:00:00Z"),
  },
];

// ─── Clip Requests ──────────────────────────────────────────────────────────
export const SEED_CLIP_REQUESTS: ClipRequest[] = [
  // ── req-001: Draft (not yet submitted) ────────────────────────────────────
  {
    id: "req-001",
    userId: REQUESTER_ID,
    title: "Product Launch Teaser",
    description:
      "A short teaser for our upcoming product launch highlighting the key features and call to action.",
    targetAudience: "Young professionals aged 25–35 interested in productivity tools",
    targetPlatforms: [Platform.TikTok, Platform.Instagram],
    preferredStyle: "Dynamic / Energetic",
    preferredLanguage: "English",
    status: RequestStatus.Draft,
    estimatedDueDate: null,
    confirmedDueDate: null,
    dueDateConfirmed: false,
    holdReason: null,
    rejectionReason: null,
    queuePosition: null,
    creditConfirmed: false,
    rightsConfirmed: false,
    creditsCost: 10,
    submittedAt: null,
    createdAt: d("2026-03-07T09:00:00Z"),
    updatedAt: d("2026-03-07T09:45:00Z"),
  },

  // ── req-002: Under Review (no confirmed due date yet) ─────────────────────
  {
    id: "req-002",
    userId: REQUESTER_ID,
    title: "Brand Awareness Clip",
    description:
      "A clip to increase brand recognition targeting our core audience on Facebook and TikTok.",
    targetAudience: "Adults 28–45 interested in lifestyle and wellness",
    targetPlatforms: [Platform.Facebook, Platform.TikTok],
    preferredStyle: "Calm / Informative",
    preferredLanguage: "English",
    status: RequestStatus.UnderReview,
    estimatedDueDate: d("2026-03-12T00:00:00Z"),
    confirmedDueDate: null,
    dueDateConfirmed: false,
    holdReason: null,
    rejectionReason: null,
    queuePosition: 3,
    creditConfirmed: true,
    rightsConfirmed: true,
    creditsCost: 10,
    submittedAt: d("2026-02-20T11:05:00Z"),
    createdAt: d("2026-02-19T14:00:00Z"),
    updatedAt: d("2026-02-20T11:05:00Z"),
  },

  // ── req-003: Accepted for Production (confirmed due date) ─────────────────
  {
    id: "req-003",
    userId: REQUESTER_ID,
    title: "Summer Sale Promo",
    description:
      "Promote our summer sale with attention-grabbing visuals and a discount code overlay.",
    targetAudience: "Shoppers aged 18–40 interested in deals and fashion",
    targetPlatforms: [Platform.Instagram, Platform.YouTube, Platform.Facebook],
    preferredStyle: "Fun / Playful",
    preferredLanguage: "English",
    status: RequestStatus.AcceptedForProduction,
    estimatedDueDate: d("2026-03-10T00:00:00Z"),
    confirmedDueDate: d("2026-03-10T00:00:00Z"),
    dueDateConfirmed: true,
    holdReason: null,
    rejectionReason: null,
    queuePosition: 1,
    creditConfirmed: true,
    rightsConfirmed: true,
    creditsCost: 10,
    submittedAt: d("2026-02-25T14:10:00Z"),
    createdAt: d("2026-02-24T10:00:00Z"),
    updatedAt: d("2026-03-02T09:00:00Z"),
  },

  // ── req-004: Editing (in production, confirmed date) ──────────────────────
  {
    id: "req-004",
    userId: REQUESTER_ID,
    title: "Monthly Newsletter Highlight",
    description:
      "A clip version of our monthly newsletter highlights — key stats and community updates.",
    targetAudience: "Existing customers and newsletter subscribers",
    targetPlatforms: [Platform.YouTube, Platform.TventApp],
    preferredStyle: "Professional / Corporate",
    preferredLanguage: "English",
    status: RequestStatus.Editing,
    estimatedDueDate: d("2026-03-07T00:00:00Z"),
    confirmedDueDate: d("2026-03-08T00:00:00Z"),
    dueDateConfirmed: true,
    holdReason: null,
    rejectionReason: null,
    queuePosition: null,
    creditConfirmed: true,
    rightsConfirmed: true,
    creditsCost: 10,
    submittedAt: d("2026-02-18T09:35:00Z"),
    createdAt: d("2026-02-17T16:00:00Z"),
    updatedAt: d("2026-02-28T13:00:00Z"),
  },

  // ── req-005: Published (posted to channels) ───────────────────────────────
  {
    id: "req-005",
    userId: REQUESTER_ID,
    title: "Q1 Campaign Teaser",
    description:
      "A teaser clip for our Q1 marketing campaign to build anticipation before launch.",
    targetAudience: "General audience across all social platforms",
    targetPlatforms: [Platform.TikTok, Platform.Instagram, Platform.YouTube],
    preferredStyle: "Cinematic / Dramatic",
    preferredLanguage: "English",
    status: RequestStatus.Published,
    estimatedDueDate: d("2026-02-07T00:00:00Z"),
    confirmedDueDate: d("2026-02-06T00:00:00Z"),
    dueDateConfirmed: true,
    holdReason: null,
    rejectionReason: null,
    queuePosition: null,
    creditConfirmed: true,
    rightsConfirmed: true,
    creditsCost: 10,
    submittedAt: d("2026-01-28T16:05:00Z"),
    createdAt: d("2026-01-27T11:00:00Z"),
    updatedAt: d("2026-02-08T12:00:00Z"),
  },

  // ── req-006: Delivered (all links available) ──────────────────────────────
  {
    id: "req-006",
    userId: REQUESTER_ID,
    title: "Holiday Special Recap",
    description:
      "A warm recap of our holiday season highlights and a thank-you message to customers.",
    targetAudience: "Existing customers and brand community",
    targetPlatforms: [Platform.Facebook, Platform.Instagram, Platform.CDN],
    preferredStyle: "Calm / Informative",
    preferredLanguage: "English",
    status: RequestStatus.Delivered,
    estimatedDueDate: d("2026-01-20T00:00:00Z"),
    confirmedDueDate: d("2026-01-19T00:00:00Z"),
    dueDateConfirmed: true,
    holdReason: null,
    rejectionReason: null,
    queuePosition: null,
    creditConfirmed: true,
    rightsConfirmed: true,
    creditsCost: 10,
    submittedAt: d("2026-01-12T10:05:00Z"),
    createdAt: d("2026-01-11T09:00:00Z"),
    updatedAt: d("2026-01-22T14:00:00Z"),
  },

  // ── req-007: On Hold (with reason) ────────────────────────────────────────
  {
    id: "req-007",
    userId: REQUESTER_ID,
    title: "Special Project Intro",
    description:
      "An intro clip for a special product collaboration we are announcing soon.",
    targetAudience: "Industry professionals and partners",
    targetPlatforms: [Platform.YouTube, Platform.CDN],
    preferredStyle: "Professional / Corporate",
    preferredLanguage: "English",
    status: RequestStatus.OnHold,
    estimatedDueDate: null,
    confirmedDueDate: null,
    dueDateConfirmed: false,
    holdReason:
      "The uploaded source video appears to be corrupt or unplayable. Please re-upload a working version of the video file so we can continue production.",
    rejectionReason: null,
    queuePosition: null,
    creditConfirmed: true,
    rightsConfirmed: true,
    creditsCost: 10,
    submittedAt: d("2026-03-01T13:05:00Z"),
    createdAt: d("2026-02-28T10:00:00Z"),
    updatedAt: d("2026-03-03T11:00:00Z"),
  },

  // ── req-008: Rejected (with reason) ──────────────────────────────────────
  {
    id: "req-008",
    userId: REQUESTER_ID,
    title: "Quick Ad Spot",
    description: "A quick ad requesting use of third-party copyrighted music.",
    targetAudience: "Wide general audience",
    targetPlatforms: [Platform.TikTok],
    preferredStyle: "Dynamic / Energetic",
    preferredLanguage: "English",
    status: RequestStatus.Rejected,
    estimatedDueDate: null,
    confirmedDueDate: null,
    dueDateConfirmed: false,
    holdReason: null,
    rejectionReason:
      "This request was rejected because the brief references copyrighted music that we are not licensed to use. Please resubmit with source material you own or have rights to use.",
    queuePosition: null,
    creditConfirmed: true,
    rightsConfirmed: true,
    creditsCost: 10,
    submittedAt: d("2026-02-08T08:05:00Z"),
    createdAt: d("2026-02-07T15:00:00Z"),
    updatedAt: d("2026-02-10T09:30:00Z"),
  },

  // ── req-009: Submitted (awaiting review, no confirmed date) ───────────────
  {
    id: "req-009",
    userId: REQUESTER_ID,
    title: "New Product Demo",
    description:
      "A concise demo clip showing our new product in action with a clear value proposition.",
    targetAudience: "Tech-savvy users aged 22–38",
    targetPlatforms: [Platform.YouTube, Platform.TikTok, Platform.Instagram],
    preferredStyle: "Minimalist / Clean",
    preferredLanguage: "English",
    status: RequestStatus.Submitted,
    estimatedDueDate: null,
    confirmedDueDate: null,
    dueDateConfirmed: false,
    holdReason: null,
    rejectionReason: null,
    queuePosition: 5,
    creditConfirmed: true,
    rightsConfirmed: true,
    creditsCost: 10,
    submittedAt: d("2026-03-05T15:05:00Z"),
    createdAt: d("2026-03-05T14:00:00Z"),
    updatedAt: d("2026-03-05T15:05:00Z"),
  },
];

// ─── Status History ─────────────────────────────────────────────────────────
export const SEED_STATUS_HISTORY: RequestStatusHistory[] = [
  // req-002: Under Review
  { id: "sh-002-1", requestId: "req-002", status: RequestStatus.Submitted, note: null, changedAt: d("2026-02-20T11:05:00Z") },
  { id: "sh-002-2", requestId: "req-002", status: RequestStatus.UnderReview, note: null, changedAt: d("2026-02-21T09:00:00Z") },

  // req-003: Accepted for Production
  { id: "sh-003-1", requestId: "req-003", status: RequestStatus.Submitted, note: null, changedAt: d("2026-02-25T14:10:00Z") },
  { id: "sh-003-2", requestId: "req-003", status: RequestStatus.UnderReview, note: null, changedAt: d("2026-02-26T10:00:00Z") },
  { id: "sh-003-3", requestId: "req-003", status: RequestStatus.AcceptedForProduction, note: "Materials look great. Production confirmed for 10 March.", changedAt: d("2026-03-02T09:00:00Z") },

  // req-004: Editing
  { id: "sh-004-1", requestId: "req-004", status: RequestStatus.Submitted, note: null, changedAt: d("2026-02-18T09:35:00Z") },
  { id: "sh-004-2", requestId: "req-004", status: RequestStatus.UnderReview, note: null, changedAt: d("2026-02-19T10:00:00Z") },
  { id: "sh-004-3", requestId: "req-004", status: RequestStatus.AcceptedForProduction, note: null, changedAt: d("2026-02-22T11:00:00Z") },
  { id: "sh-004-4", requestId: "req-004", status: RequestStatus.Editing, note: null, changedAt: d("2026-02-28T13:00:00Z") },

  // req-005: Published
  { id: "sh-005-1", requestId: "req-005", status: RequestStatus.Submitted, note: null, changedAt: d("2026-01-28T16:05:00Z") },
  { id: "sh-005-2", requestId: "req-005", status: RequestStatus.UnderReview, note: null, changedAt: d("2026-01-29T09:00:00Z") },
  { id: "sh-005-3", requestId: "req-005", status: RequestStatus.AcceptedForProduction, note: null, changedAt: d("2026-01-30T10:00:00Z") },
  { id: "sh-005-4", requestId: "req-005", status: RequestStatus.Editing, note: null, changedAt: d("2026-02-03T11:00:00Z") },
  { id: "sh-005-5", requestId: "req-005", status: RequestStatus.ScheduledForPublishing, note: null, changedAt: d("2026-02-07T14:00:00Z") },
  { id: "sh-005-6", requestId: "req-005", status: RequestStatus.Published, note: null, changedAt: d("2026-02-08T12:00:00Z") },

  // req-006: Delivered
  { id: "sh-006-1", requestId: "req-006", status: RequestStatus.Submitted, note: null, changedAt: d("2026-01-12T10:05:00Z") },
  { id: "sh-006-2", requestId: "req-006", status: RequestStatus.UnderReview, note: null, changedAt: d("2026-01-13T09:00:00Z") },
  { id: "sh-006-3", requestId: "req-006", status: RequestStatus.AcceptedForProduction, note: null, changedAt: d("2026-01-14T10:00:00Z") },
  { id: "sh-006-4", requestId: "req-006", status: RequestStatus.Editing, note: null, changedAt: d("2026-01-16T09:00:00Z") },
  { id: "sh-006-5", requestId: "req-006", status: RequestStatus.ScheduledForPublishing, note: null, changedAt: d("2026-01-19T11:00:00Z") },
  { id: "sh-006-6", requestId: "req-006", status: RequestStatus.Published, note: null, changedAt: d("2026-01-20T14:00:00Z") },
  { id: "sh-006-7", requestId: "req-006", status: RequestStatus.Delivered, note: null, changedAt: d("2026-01-22T14:00:00Z") },

  // req-007: On Hold
  { id: "sh-007-1", requestId: "req-007", status: RequestStatus.Submitted, note: null, changedAt: d("2026-03-01T13:05:00Z") },
  { id: "sh-007-2", requestId: "req-007", status: RequestStatus.UnderReview, note: null, changedAt: d("2026-03-02T10:00:00Z") },
  { id: "sh-007-3", requestId: "req-007", status: RequestStatus.OnHold, note: "Source video file is corrupt. Awaiting re-upload.", changedAt: d("2026-03-03T11:00:00Z") },

  // req-008: Rejected
  { id: "sh-008-1", requestId: "req-008", status: RequestStatus.Submitted, note: null, changedAt: d("2026-02-08T08:05:00Z") },
  { id: "sh-008-2", requestId: "req-008", status: RequestStatus.UnderReview, note: null, changedAt: d("2026-02-09T10:00:00Z") },
  { id: "sh-008-3", requestId: "req-008", status: RequestStatus.Rejected, note: "Copyrighted music referenced — cannot proceed.", changedAt: d("2026-02-10T09:30:00Z") },

  // req-009: Submitted
  { id: "sh-009-1", requestId: "req-009", status: RequestStatus.Submitted, note: null, changedAt: d("2026-03-05T15:05:00Z") },
];

// ─── Uploaded Assets ────────────────────────────────────────────────────────
const DELETION_DATE = d("2026-06-14T00:00:00Z"); // ~90 days from March 2026

export const SEED_UPLOADED_ASSETS: UploadedAsset[] = [
  // req-001: Draft — partial upload
  {
    id: "asset-001-1",
    requestId: "req-001",
    userId: REQUESTER_ID,
    fileName: "product-intro.mp4",
    assetType: AssetType.Video,
    fileSizeBytes: 45_000_000,
    mimeType: "video/mp4",
    storageKey: "request_mat/user-requester-001/2026-03-07/req-001/product-intro.mp4",
    storageUrl: "/mock-assets/product-intro.mp4",
    thumbnailKey: "thumbnails/user-requester-001/2026-03-07/req-001/product-intro.jpg",
    thumbnailUrl: "/mock-assets/product-intro-thumb.jpg",
    uploadStatus: AssetUploadStatus.Uploaded,
    scheduledDeletionAt: DELETION_DATE,
    createdAt: d("2026-03-07T09:20:00Z"),
    updatedAt: d("2026-03-07T09:22:00Z"),
  },

  // req-002: Under Review
  {
    id: "asset-002-1",
    requestId: "req-002",
    userId: REQUESTER_ID,
    fileName: "brand-footage-1.mp4",
    assetType: AssetType.Video,
    fileSizeBytes: 120_000_000,
    mimeType: "video/mp4",
    storageKey: "request_mat/user-requester-001/2026-02-20/req-002/brand-footage-1.mp4",
    storageUrl: "/mock-assets/brand-footage-1.mp4",
    thumbnailKey: "thumbnails/user-requester-001/2026-02-20/req-002/brand-footage-1.jpg",
    thumbnailUrl: "/mock-assets/brand-footage-1-thumb.jpg",
    uploadStatus: AssetUploadStatus.Uploaded,
    scheduledDeletionAt: d("2026-05-20T00:00:00Z"),
    createdAt: d("2026-02-20T11:00:00Z"),
    updatedAt: d("2026-02-20T11:01:00Z"),
  },
  {
    id: "asset-002-2",
    requestId: "req-002",
    userId: REQUESTER_ID,
    fileName: "brand-logo.png",
    assetType: AssetType.Image,
    fileSizeBytes: 450_000,
    mimeType: "image/png",
    storageKey: "request_mat/user-requester-001/2026-02-20/req-002/brand-logo.png",
    storageUrl: "/mock-assets/brand-logo.png",
    thumbnailKey: "thumbnails/user-requester-001/2026-02-20/req-002/brand-logo.jpg",
    thumbnailUrl: "/mock-assets/brand-logo-thumb.jpg",
    uploadStatus: AssetUploadStatus.Uploaded,
    scheduledDeletionAt: d("2026-05-20T00:00:00Z"),
    createdAt: d("2026-02-20T11:00:00Z"),
    updatedAt: d("2026-02-20T11:00:30Z"),
  },

  // req-006: Delivered — assets retained
  {
    id: "asset-006-1",
    requestId: "req-006",
    userId: REQUESTER_ID,
    fileName: "holiday-raw-footage.mp4",
    assetType: AssetType.Video,
    fileSizeBytes: 200_000_000,
    mimeType: "video/mp4",
    storageKey: "request_mat/user-requester-001/2026-01-12/req-006/holiday-raw-footage.mp4",
    storageUrl: "/mock-assets/holiday-raw-footage.mp4",
    thumbnailKey: "thumbnails/user-requester-001/2026-01-12/req-006/holiday-raw-footage.jpg",
    thumbnailUrl: "/mock-assets/holiday-raw-footage-thumb.jpg",
    uploadStatus: AssetUploadStatus.Uploaded,
    scheduledDeletionAt: d("2026-04-12T00:00:00Z"),
    createdAt: d("2026-01-12T10:00:00Z"),
    updatedAt: d("2026-01-12T10:02:00Z"),
  },
];

// ─── Publishing Links ───────────────────────────────────────────────────────
export const SEED_PUBLISHING_LINKS: PublishingLink[] = [
  // req-005: Published — 2 channels
  {
    id: "link-005-1",
    requestId: "req-005",
    platform: Platform.TikTok,
    url: "https://www.tiktok.com/@example/video/7234567890123456789",
    publishedAt: d("2026-02-08T12:00:00Z"),
    createdAt: d("2026-02-08T12:05:00Z"),
  },
  {
    id: "link-005-2",
    requestId: "req-005",
    platform: Platform.Instagram,
    url: "https://www.instagram.com/reel/ABC123example/",
    publishedAt: d("2026-02-08T13:00:00Z"),
    createdAt: d("2026-02-08T13:05:00Z"),
  },

  // req-006: Delivered — 3 channels
  {
    id: "link-006-1",
    requestId: "req-006",
    platform: Platform.Facebook,
    url: "https://www.facebook.com/example/videos/123456789012345/",
    publishedAt: d("2026-01-20T14:00:00Z"),
    createdAt: d("2026-01-20T14:05:00Z"),
  },
  {
    id: "link-006-2",
    requestId: "req-006",
    platform: Platform.Instagram,
    url: "https://www.instagram.com/reel/XYZ789example/",
    publishedAt: d("2026-01-20T15:00:00Z"),
    createdAt: d("2026-01-20T15:05:00Z"),
  },
  {
    id: "link-006-3",
    requestId: "req-006",
    platform: Platform.CDN,
    url: "https://cdn.example.com/clips/holiday-special-recap-final.mp4",
    publishedAt: d("2026-01-22T10:00:00Z"),
    createdAt: d("2026-01-22T10:05:00Z"),
  },
];
