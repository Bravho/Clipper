/**
 * Tests for AdminWorkflowService — admin production review workflow.
 *
 * These tests use mock repository instances with fresh in-memory stores
 * so they are isolated from the globalThis singleton and seed data.
 */

import { AdminWorkflowService } from "@/services/admin/AdminWorkflowService";
import { MockClipRequestRepository } from "@/repositories/mock/MockClipRequestRepository";
import { MockRequestStatusHistoryRepository } from "@/repositories/mock/MockRequestStatusHistoryRepository";
import { MockProductionReviewRepository } from "@/repositories/mock/MockProductionReviewRepository";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { ProductionReviewStatus } from "@/domain/enums/ProductionReviewStatus";
import { EffortClass } from "@/domain/enums/EffortClass";
import { Platform } from "@/domain/enums/Platform";

// Manually wire fresh instances (bypasses globalThis singleton for isolation)
// Override the singleton imports used by the service
jest.mock("@/repositories", () => ({
  clipRequestRepository: new (require("@/repositories/mock/MockClipRequestRepository").MockClipRequestRepository)(new Map()),
  requestStatusHistoryRepository: new (require("@/repositories/mock/MockRequestStatusHistoryRepository").MockRequestStatusHistoryRepository)(new Map()),
  productionReviewRepository: new (require("@/repositories/mock/MockProductionReviewRepository").MockProductionReviewRepository)(new Map()),
}));

const {
  clipRequestRepository: mockClipRepo,
  requestStatusHistoryRepository: mockHistoryRepo,
  productionReviewRepository: mockReviewRepo,
} = jest.requireMock("@/repositories") as {
  clipRequestRepository: MockClipRequestRepository;
  requestStatusHistoryRepository: MockRequestStatusHistoryRepository;
  productionReviewRepository: MockProductionReviewRepository;
};

const adminService = new AdminWorkflowService();

const ADMIN_ID = "user-admin-001";

async function createScheduledRequest(id = "req-test") {
  const request = await mockClipRepo.create({
    userId: "user-001",
    title: "Test Clip",
    description: "Test",
    targetAudience: "All",
    targetPlatforms: [Platform.TikTok],
    preferredStyle: "Dynamic",
    preferredLanguage: "English",
    durationSeconds: 15,
  });

  await mockClipRepo.updateStatus(request.id, RequestStatus.Submitted, {
    submittedAt: new Date(),
    creditConfirmed: true,
    rightsConfirmed: true,
  });

  await mockClipRepo.updateStaffFields(request.id, { effortClass: EffortClass.Standard });

  await mockClipRepo.updateStatus(request.id, RequestStatus.Editing, {
    confirmedDueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    dueDateConfirmed: true,
    assignedStaffId: "user-staff-001",
  });

  const scheduled = await mockClipRepo.updateStatus(
    request.id,
    RequestStatus.ScheduledForPublishing
  );

  // Create a production review for it
  await mockReviewRepo.create({ requestId: request.id, submittedAt: new Date() });

  return scheduled;
}

describe("AdminWorkflowService", () => {
  beforeEach(async () => {
    // Clear stores between tests
    (mockClipRepo as any).store.clear();
    (mockHistoryRepo as any).store.clear();
    (mockReviewRepo as any).store.clear();
  });

  describe("approveForPublishing", () => {
    it("transitions ScheduledForPublishing → Published", async () => {
      const request = await createScheduledRequest();
      const { request: updated, review } = await adminService.approveForPublishing(
        request.id,
        ADMIN_ID,
        "Looks great!"
      );

      expect(updated.status).toBe(RequestStatus.Published);
      expect(review.status).toBe(ProductionReviewStatus.Approved);
      expect(review.reviewedBy).toBe(ADMIN_ID);
      expect(review.reviewNote).toBe("Looks great!");
      expect(review.reviewedAt).not.toBeNull();
    });

    it("creates a history entry", async () => {
      const request = await createScheduledRequest();
      await adminService.approveForPublishing(request.id, ADMIN_ID);
      const history = await mockHistoryRepo.findByRequestId(request.id);
      const lastEntry = history.sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())[0];
      expect(lastEntry.status).toBe(RequestStatus.Published);
    });

    it("throws if request is not in ScheduledForPublishing status", async () => {
      const request = await mockClipRepo.create({
        userId: "u",
        title: "T",
        description: "D",
        targetAudience: "A",
        targetPlatforms: [Platform.TikTok],
        preferredStyle: "S",
        preferredLanguage: "EN",
        durationSeconds: 15,
      });
      // request is in Draft
      await expect(
        adminService.approveForPublishing(request.id, ADMIN_ID)
      ).rejects.toThrow(/scheduled_for_publishing/);
    });

    it("creates a production review lazily if none exists", async () => {
      const request = await createScheduledRequest();
      // Clear the review so there is none
      (mockReviewRepo as any).store.clear();

      const { review } = await adminService.approveForPublishing(request.id, ADMIN_ID);
      expect(review.status).toBe(ProductionReviewStatus.Approved);
    });
  });

  describe("returnToEditing", () => {
    it("transitions ScheduledForPublishing → Editing with revision note", async () => {
      const request = await createScheduledRequest();
      const revisionNote = "Audio levels are off. Please fix and resubmit.";

      const { request: updated, review } = await adminService.returnToEditing(
        request.id,
        ADMIN_ID,
        revisionNote
      );

      expect(updated.status).toBe(RequestStatus.Editing);
      expect(review.status).toBe(ProductionReviewStatus.ReturnedToEditing);
      expect(review.reviewNote).toBe(revisionNote);
    });

    it("throws if revision note is empty", async () => {
      const request = await createScheduledRequest();
      await expect(
        adminService.returnToEditing(request.id, ADMIN_ID, "")
      ).rejects.toThrow(/revision note/i);
    });

    it("throws if revision note is only whitespace", async () => {
      const request = await createScheduledRequest();
      await expect(
        adminService.returnToEditing(request.id, ADMIN_ID, "   ")
      ).rejects.toThrow(/revision note/i);
    });
  });

  describe("holdDuringReview", () => {
    it("transitions ScheduledForPublishing → OnHold and sets hold reason", async () => {
      const request = await createScheduledRequest();
      const holdReason = "Missing required footage from requester.";

      const { request: updated, review } = await adminService.holdDuringReview(
        request.id,
        ADMIN_ID,
        holdReason
      );

      expect(updated.status).toBe(RequestStatus.OnHold);
      expect(updated.holdReason).toBe(holdReason);
      expect(review.status).toBe(ProductionReviewStatus.OnHold);
    });

    it("throws if hold reason is empty", async () => {
      const request = await createScheduledRequest();
      await expect(
        adminService.holdDuringReview(request.id, ADMIN_ID, "")
      ).rejects.toThrow(/hold reason/i);
    });
  });

  describe("rejectFromReview", () => {
    it("transitions ScheduledForPublishing → Rejected and sets rejection reason", async () => {
      const request = await createScheduledRequest();
      const rejectionReason = "Content violates platform policy.";

      const { request: updated, review } = await adminService.rejectFromReview(
        request.id,
        ADMIN_ID,
        rejectionReason,
        "Internal note: policy section 3.2"
      );

      expect(updated.status).toBe(RequestStatus.Rejected);
      expect(updated.rejectionReason).toBe(rejectionReason);
      expect(updated.assignedStaffId).toBeNull();
      expect(review.status).toBe(ProductionReviewStatus.Rejected);
    });

    it("throws if rejection reason is empty", async () => {
      const request = await createScheduledRequest();
      await expect(
        adminService.rejectFromReview(request.id, ADMIN_ID, "")
      ).rejects.toThrow(/rejection reason/i);
    });

    it("clears the assignedStaffId on rejection", async () => {
      const request = await createScheduledRequest();
      expect(request.assignedStaffId).toBe("user-staff-001");

      const { request: updated } = await adminService.rejectFromReview(
        request.id,
        ADMIN_ID,
        "Rejected due to content issues."
      );
      expect(updated.assignedStaffId).toBeNull();
    });
  });
});
