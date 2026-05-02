/**
 * Tests for StaffRequestPresentationService.
 *
 * Covers:
 * - getStatusPresentation returns correct badge variant for each status
 * - nextActions are correct per status
 * - buildRequestView computes isOverdue correctly
 * - buildRequestView exposes staff-specific fields
 * - daysRemaining calculation
 */

import { StaffRequestPresentationService } from "@/services/staff/StaffRequestPresentationService";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Platform } from "@/domain/enums/Platform";
import { EffortClass } from "@/domain/enums/EffortClass";
import { ClipRequest } from "@/domain/models/ClipRequest";

const svc = new StaffRequestPresentationService();

function makeRequest(overrides: Partial<ClipRequest> = {}): ClipRequest {
  return {
    id: "req-test",
    userId: "user-001",
    title: "Test Request",
    description: "Test",
    targetAudience: "Testers",
    targetPlatforms: [Platform.TikTok],
    preferredStyle: "Clean",
    preferredLanguage: "English",
    status: RequestStatus.UnderReview,
    estimatedDueDate: null,
    confirmedDueDate: null,
    dueDateConfirmed: false,
    holdReason: null,
    rejectionReason: null,
    queuePosition: null,
    creditConfirmed: true,
    rightsConfirmed: true,
    creditsCost: 10,
    submittedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    effortClass: null,
    capCutProjectRef: null,
    editingProgressNote: null,
    exportReady: false,
    latestExportNote: null,
    ...overrides,
  };
}

describe("StaffRequestPresentationService — getStatusPresentation", () => {
  it.each([
    [RequestStatus.Draft, "slate"],
    [RequestStatus.Submitted, "blue"],
    [RequestStatus.UnderReview, "blue"],
    [RequestStatus.AcceptedForProduction, "green"],
    [RequestStatus.Editing, "green"],
    [RequestStatus.ScheduledForPublishing, "green"],
    [RequestStatus.Published, "green"],
    [RequestStatus.Delivered, "green"],
    [RequestStatus.OnHold, "yellow"],
    [RequestStatus.Rejected, "red"],
  ])(
    "returns correct badge variant for %s",
    (status, expectedVariant) => {
      const presentation = svc.getStatusPresentation(status as RequestStatus);
      expect(presentation.badgeVariant).toBe(expectedVariant);
    }
  );

  it("includes nextActions for actionable statuses", () => {
    const submitted = svc.getStatusPresentation(RequestStatus.Submitted);
    const labels = submitted.nextActions.map((a) => a.action);
    expect(labels).toContain("mark_under_review");
    expect(labels).toContain("put_on_hold");
    expect(labels).toContain("reject");
  });

  it("returns empty nextActions for Delivered", () => {
    const delivered = svc.getStatusPresentation(RequestStatus.Delivered);
    expect(delivered.nextActions).toHaveLength(0);
  });

  it("returns empty nextActions for Rejected", () => {
    const rejected = svc.getStatusPresentation(RequestStatus.Rejected);
    expect(rejected.nextActions).toHaveLength(0);
  });

  it("Confirm Due Date is available from UnderReview", () => {
    const underReview = svc.getStatusPresentation(RequestStatus.UnderReview);
    const actions = underReview.nextActions.map((a) => a.action);
    expect(actions).toContain("confirm_due_date");
  });
});

describe("StaffRequestPresentationService — buildRequestView", () => {
  it("exposes staff-specific fields in view", () => {
    const req = makeRequest({
      effortClass: EffortClass.Complex,
      capCutProjectRef: "TestProject",
      editingProgressNote: "50% done",
      exportReady: true,
      latestExportNote: "v2.mp4",
    });
    const view = svc.buildRequestView(req, [], [], [], []);
    expect(view.effortClass).toBe(EffortClass.Complex);
    expect(view.capCutProjectRef).toBe("TestProject");
    expect(view.editingProgressNote).toBe("50% done");
    expect(view.exportReady).toBe(true);
    expect(view.latestExportNote).toBe("v2.mp4");
  });

  it("marks isOverdue=true when past due date and status is active", () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const req = makeRequest({
      status: RequestStatus.Editing,
      confirmedDueDate: past,
      dueDateConfirmed: true,
    });
    const view = svc.buildRequestView(req, [], [], [], []);
    expect(view.isOverdue).toBe(true);
    expect(view.daysRemaining).toBeNull();
  });

  it("does not mark isOverdue for Delivered even if past due date", () => {
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const req = makeRequest({
      status: RequestStatus.Delivered,
      confirmedDueDate: past,
      dueDateConfirmed: true,
    });
    const view = svc.buildRequestView(req, [], [], [], []);
    expect(view.isOverdue).toBe(false);
  });

  it("calculates positive daysRemaining for future due date", () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const req = makeRequest({
      status: RequestStatus.Editing,
      confirmedDueDate: future,
      dueDateConfirmed: true,
    });
    const view = svc.buildRequestView(req, [], [], [], []);
    expect(view.isOverdue).toBe(false);
    expect(view.daysRemaining).toBeGreaterThanOrEqual(4);
  });

  it("sorts status history newest first", () => {
    const req = makeRequest();
    const history = [
      { id: "h1", requestId: "req-test", status: RequestStatus.Submitted, note: null, changedAt: new Date("2026-01-01") },
      { id: "h2", requestId: "req-test", status: RequestStatus.UnderReview, note: null, changedAt: new Date("2026-01-03") },
    ];
    const view = svc.buildRequestView(req, [], [], history, []);
    expect(view.statusHistory[0].id).toBe("h2"); // newest first
    expect(view.statusHistory[1].id).toBe("h1");
  });

  it("humanizes target platforms", () => {
    const req = makeRequest({ targetPlatforms: [Platform.TikTok, Platform.YouTube] });
    const view = svc.buildRequestView(req, [], [], [], []);
    expect(view.targetPlatforms).toContain("TikTok");
    expect(view.targetPlatforms).toContain("YouTube");
  });
});

describe("StaffRequestPresentationService — formatDate / formatRelativeDate", () => {
  it("formats date in en-GB format", () => {
    const date = new Date("2026-03-15T00:00:00Z");
    const formatted = svc.formatDate(date);
    expect(formatted).toContain("Mar");
    expect(formatted).toContain("2026");
  });

  it("formatRelativeDate returns Today for today", () => {
    const now = new Date();
    const result = svc.formatRelativeDate(now);
    expect(result).toBe("Today");
  });
});
