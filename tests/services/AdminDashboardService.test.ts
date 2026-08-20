/**
 * Tests for AdminDashboardService — admin dashboard aggregation.
 */

import { AdminDashboardService } from "@/services/admin/AdminDashboardService";
import { MockClipRequestRepository } from "@/repositories/mock/MockClipRequestRepository";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Platform } from "@/domain/enums/Platform";

jest.mock("@/repositories", () => ({
  clipRequestRepository: new (require("@/repositories/mock/MockClipRequestRepository").MockClipRequestRepository)(new Map()),
}));

const { clipRequestRepository: mockClipRepo } = jest.requireMock("@/repositories") as {
  clipRequestRepository: MockClipRequestRepository;
};

const service = new AdminDashboardService();

async function createRequest(overrides: Partial<{
  status: RequestStatus;
  confirmedDueDate: Date | null;
  dueDateConfirmed: boolean;
  assignedStaffId: string | null;
}> = {}) {
  const request = await mockClipRepo.create({
    userId: "user-001",
    title: "Test",
    description: "Desc",
    targetAudience: "All",
    targetPlatforms: [Platform.TikTok],
    preferredStyle: "Dynamic",
    preferredLanguage: "English",
    durationSeconds: 15,
  });

  const {
    status = RequestStatus.Submitted,
    confirmedDueDate = null,
    dueDateConfirmed = false,
    assignedStaffId = null,
  } = overrides;

  return mockClipRepo.updateStatus(request.id, status, {
    submittedAt: new Date(),
    confirmedDueDate,
    dueDateConfirmed,
    assignedStaffId,
    creditConfirmed: true,
    rightsConfirmed: true,
  });
}

describe("AdminDashboardService", () => {
  beforeEach(() => {
    (mockClipRepo as any).store.clear();
  });

  describe("getSummary", () => {
    it("returns zero counts with empty store", async () => {
      const summary = await service.getSummary();
      expect(summary.submittedCount).toBe(0);
      expect(summary.editingCount).toBe(0);
      expect(summary.overdueCount).toBe(0);
    });

    it("counts requests by status correctly", async () => {
      await createRequest({ status: RequestStatus.Submitted });
      await createRequest({ status: RequestStatus.Submitted });
      await createRequest({ status: RequestStatus.Editing });
      await createRequest({ status: RequestStatus.Published });

      const summary = await service.getSummary();
      expect(summary.submittedCount).toBe(2);
      expect(summary.editingCount).toBe(1);
      expect(summary.publishedCount).toBe(1);
    });

    it("counts overdue requests correctly", async () => {
      const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

      await createRequest({
        status: RequestStatus.Editing,
        confirmedDueDate: pastDate,
        dueDateConfirmed: true,
      });
      await createRequest({
        status: RequestStatus.Editing,
        confirmedDueDate: futureDate,
        dueDateConfirmed: true,
      });

      const summary = await service.getSummary();
      expect(summary.overdueCount).toBe(1);
    });
  });

  describe("getQueueSnapshot", () => {
    it("separates requests into the correct queues", async () => {
      await createRequest({ status: RequestStatus.Submitted });
      await createRequest({ status: RequestStatus.Editing });
      await createRequest({ status: RequestStatus.UnderReview });
      await createRequest({ status: RequestStatus.Published });
      await createRequest({ status: RequestStatus.OnHold });

      const snapshot = await service.getQueueSnapshot();
      expect(snapshot.submittedRequests).toHaveLength(1);
      expect(snapshot.editingRequests).toHaveLength(1);
      expect(snapshot.underReviewRequests).toHaveLength(1);
      expect(snapshot.publishedRequests).toHaveLength(1);
      expect(snapshot.onHoldRequests).toHaveLength(1);
    });
  });
});
