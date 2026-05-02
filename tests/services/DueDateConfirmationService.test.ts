/**
 * Tests for DueDateConfirmationService.
 *
 * Covers:
 * - estimateDueDate skips weekends correctly
 * - updateEffortClass resets due date confirmation
 * - confirmDueDate sets dueDateConfirmed = true
 * - confirmDueDate rejects invalid statuses
 * - getDueDateStatus returns correct overdue flags
 */

import { DueDateConfirmationService } from "@/services/staff/DueDateConfirmationService";
import { EffortClass } from "@/domain/enums/EffortClass";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { ClipRequest } from "@/domain/models/ClipRequest";
import { Platform } from "@/domain/enums/Platform";

function makeRequest(overrides: Partial<ClipRequest> = {}): ClipRequest {
  return {
    id: "req-test",
    userId: "user-001",
    title: "Test",
    description: "Test",
    targetAudience: "Test",
    targetPlatforms: [Platform.TikTok],
    preferredStyle: "Test",
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
    ...overrides,
  };
}

describe("DueDateConfirmationService — estimateDueDate", () => {
  const svc = new DueDateConfirmationService();

  it("Simple effort = +1 working day", () => {
    // Use a known Monday
    const monday = new Date("2026-03-09T00:00:00Z"); // Monday
    const estimate = svc.estimateDueDate(EffortClass.Simple, monday);
    const day = estimate.getUTCDay();
    // +1 working day from Monday = Tuesday
    expect(day).toBe(2); // 2 = Tuesday
  });

  it("Standard effort = +2 working days", () => {
    const monday = new Date("2026-03-09T00:00:00Z");
    const estimate = svc.estimateDueDate(EffortClass.Standard, monday);
    const day = estimate.getUTCDay();
    // Mon + 2 working days = Wednesday
    expect(day).toBe(3); // 3 = Wednesday
  });

  it("Complex effort = +3 working days", () => {
    const monday = new Date("2026-03-09T00:00:00Z");
    const estimate = svc.estimateDueDate(EffortClass.Complex, monday);
    const day = estimate.getUTCDay();
    // Mon + 3 = Thursday
    expect(day).toBe(4); // 4 = Thursday
  });

  it("skips Saturday and Sunday", () => {
    // Friday
    const friday = new Date("2026-03-13T00:00:00Z");
    const estimate = svc.estimateDueDate(EffortClass.Simple, friday);
    // +1 working day from Friday = Monday (skipping Sat + Sun)
    const day = estimate.getUTCDay();
    expect(day).toBe(1); // 1 = Monday
  });

  it("Standard effort from Thursday skips weekend", () => {
    const thursday = new Date("2026-03-12T00:00:00Z");
    const estimate = svc.estimateDueDate(EffortClass.Standard, thursday);
    // Thu + 1 = Fri, + 1 (skip Sat, Sun) = Mon
    const day = estimate.getUTCDay();
    expect(day).toBe(1); // Monday
  });
});

describe("DueDateConfirmationService — getDueDateStatus", () => {
  const svc = new DueDateConfirmationService();

  it("returns isConfirmed=false when not confirmed", () => {
    const req = makeRequest({ dueDateConfirmed: false, confirmedDueDate: null });
    const status = svc.getDueDateStatus(req);
    expect(status.isConfirmed).toBe(false);
    expect(status.confirmedDate).toBeNull();
  });

  it("returns isConfirmed=true with confirmed date", () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const req = makeRequest({
      dueDateConfirmed: true,
      confirmedDueDate: future,
    });
    const status = svc.getDueDateStatus(req);
    expect(status.isConfirmed).toBe(true);
    expect(status.confirmedDate).toEqual(future);
    expect(status.isOverdue).toBe(false);
  });

  it("detects overdue request", () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const req = makeRequest({
      dueDateConfirmed: true,
      confirmedDueDate: past,
    });
    const status = svc.getDueDateStatus(req);
    expect(status.isOverdue).toBe(true);
    expect(status.daysRemaining).toBeNull();
  });

  it("calculates daysRemaining for future dates", () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const req = makeRequest({
      dueDateConfirmed: true,
      confirmedDueDate: future,
    });
    const status = svc.getDueDateStatus(req);
    expect(status.daysRemaining).toBeGreaterThanOrEqual(4);
    expect(status.daysRemaining).toBeLessThanOrEqual(6);
  });
});

describe("DueDateConfirmationService — confirmDueDate (integration with seed data)", () => {
  const svc = new DueDateConfirmationService();

  it("confirms due date on an under-review request", async () => {
    // req-002 is UnderReview in seed data
    const future = new Date("2026-03-20T00:00:00Z");
    const result = await svc.confirmDueDate("req-002", future);
    expect(result.dueDateConfirmed).toBe(true);
    expect(result.confirmedDueDate?.toISOString()).toBe(future.toISOString());
  });

  it("rejects confirming due date for a Draft", async () => {
    // req-001 is Draft
    const future = new Date("2026-03-20T00:00:00Z");
    await expect(svc.confirmDueDate("req-001", future)).rejects.toThrow(
      /Cannot confirm due date/
    );
  });

  it("rejects invalid date input", async () => {
    await expect(
      svc.confirmDueDate("req-002", new Date("invalid"))
    ).rejects.toThrow(/Invalid confirmed due date/);
  });
});

describe("DueDateConfirmationService — updateEffortClass", () => {
  const svc = new DueDateConfirmationService();

  it("updates effort class and resets due date confirmation", async () => {
    // req-002 is UnderReview, currently Standard
    const result = await svc.updateEffortClass("req-002", EffortClass.Complex);
    expect(result.effortClass).toBe(EffortClass.Complex);
    // Due date should be reset
    expect(result.dueDateConfirmed).toBe(false);
  });

  it("throws for non-existent request", async () => {
    await expect(
      svc.updateEffortClass("non-existent", EffortClass.Simple)
    ).rejects.toThrow(/not found/i);
  });
});
