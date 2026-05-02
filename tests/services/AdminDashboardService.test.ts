/**
 * Tests for AdminDashboardService — admin dashboard aggregation.
 */

import { AdminDashboardService } from "@/services/admin/AdminDashboardService";
import { MockClipRequestRepository } from "@/repositories/mock/MockClipRequestRepository";
import { MockProductionReviewRepository } from "@/repositories/mock/MockProductionReviewRepository";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { ProductionReviewStatus } from "@/domain/enums/ProductionReviewStatus";
import { Platform } from "@/domain/enums/Platform";

const clipRepo = new MockClipRequestRepository(new Map());
const reviewRepo = new MockProductionReviewRepository(new Map());

jest.mock("@/repositories", () => ({
  clipRequestRepository: clipRepo,
  productionReviewRepository: reviewRepo,
}));

const service = new AdminDashboardService();

async function createRequest(overrides: Partial<{
  status: RequestStatus;
  confirmedDueDate: Date | null;
  dueDateConfirmed: boolean;
  assignedStaffId: string | null;
}> = {}) {
  const request = await clipRepo.create({
    userId: "user-001",
    title: "Test",
    description: "Desc",
    targetAudience: "All",
    targetPlatforms: [Platform.TikTok],
    preferredStyle: "Dynamic",
    preferredLanguage: "English",
  });

  const {
    status = RequestStatus.Submitted,
    confirmedDueDate = null,
    dueDateConfirmed = false,
    assignedStaffId = null,
  } = overrides;

  return clipRepo.updateStatus(request.id, status, {
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
    (clipRepo as any).store.clear();
    (reviewRepo as any).store.clear();
  });

  describe("getSummary", () => {
    it("returns zero counts with empty store", async () => {
      const summary = await service.getSummary();
      expect(summary.submittedCount).toBe(0);
      expect(summary.editingCount).toBe(0);
      expect(summary.overdueCount).toBe(0);
      expect(summary.pendingAdminReviewCount).toBe(0);
    });

    it("counts requests by status correctly", async () => {
      await createRequest({ status: RequestStatus.Submitted });
      await createRequest({ status: RequestStatus.Submitted });
      await createRequest({ status: RequestStatus.Editing });
      await createRequest({ status: RequestStatus.ScheduledForPublishing });

      const summary = await service.getSummary();
      expect(summary.submittedCount).toBe(2);
      expect(summary.editingCount).toBe(1);
      expect(summary.productionReviewCount).toBe(1);
    });

    it("counts pending admin review from production review records", async () => {
      const req1 = await createRequest({ status: RequestStatus.ScheduledForPublishing });
      const req2 = await createRequest({ status: RequestStatus.ScheduledForPublishing });

      await reviewRepo.create({ requestId: req1.id, submittedAt: new Date() });
      // req2 has no review record — should not affect pendingAdminReviewCount

      const summary = await service.getSummary();
      expect(summary.pendingAdminReviewCount).toBe(1);
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

  describe("getSlaData", () => {
    it("identifies overdue requests", async () => {
      const pastDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await createRequest({
        status: RequestStatus.Editing,
        confirmedDueDate: pastDate,
        dueDateConfirmed: true,
      });

      const sla = await service.getSlaData();
      expect(sla.overdue).toHaveLength(1);
    });

    it("identifies due-soon requests (within 1 working day / 24h)", async () => {
      const soon = new Date(Date.now() + 20 * 60 * 60 * 1000); // 20h from now — within 1 day
      await createRequest({
        status: RequestStatus.Editing,
        confirmedDueDate: soon,
        dueDateConfirmed: true,
      });

      const sla = await service.getSlaData();
      expect(sla.dueSoon).toHaveLength(1);
    });

    it("does not include delivered/rejected in overdue", async () => {
      const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await createRequest({
        status: RequestStatus.Delivered,
        confirmedDueDate: past,
        dueDateConfirmed: true,
      });
      await createRequest({
        status: RequestStatus.Rejected,
        confirmedDueDate: past,
        dueDateConfirmed: true,
      });

      const sla = await service.getSlaData();
      expect(sla.overdue).toHaveLength(0);
    });

    it("identifies published requests not yet delivered", async () => {
      await createRequest({ status: RequestStatus.Published });
      await createRequest({ status: RequestStatus.Published });

      const sla = await service.getSlaData();
      expect(sla.publishedNotDelivered).toHaveLength(2);
    });
  });

  describe("getWorkloadBreakdown", () => {
    it("groups requests by staff correctly", async () => {
      await createRequest({
        status: RequestStatus.Editing,
        assignedStaffId: "user-staff-001",
      });
      await createRequest({
        status: RequestStatus.Editing,
        assignedStaffId: "user-staff-001",
      });
      await createRequest({
        status: RequestStatus.Submitted,
        assignedStaffId: null,
      });

      const breakdown = await service.getWorkloadBreakdown();
      expect(breakdown.byStaff["user-staff-001"]).toHaveLength(2);
      expect(breakdown.byStaff["unassigned"]).toHaveLength(1);
    });

    it("includes all active statuses in activeTotal", async () => {
      await createRequest({ status: RequestStatus.Submitted });
      await createRequest({ status: RequestStatus.Editing });
      await createRequest({ status: RequestStatus.ScheduledForPublishing });
      // Draft and Delivered should not count as active
      await createRequest({ status: RequestStatus.Delivered });

      const breakdown = await service.getWorkloadBreakdown();
      // Submitted, Editing, ScheduledForPublishing = 3 active
      expect(breakdown.activeTotal).toBe(3);
    });
  });

  describe("getQueueSnapshot", () => {
    it("separates requests into the correct queues", async () => {
      await createRequest({ status: RequestStatus.Submitted });
      await createRequest({ status: RequestStatus.Editing });
      await createRequest({ status: RequestStatus.ScheduledForPublishing });
      await createRequest({ status: RequestStatus.Published });
      await createRequest({ status: RequestStatus.OnHold });

      const snapshot = await service.getQueueSnapshot();
      expect(snapshot.submittedRequests).toHaveLength(1);
      expect(snapshot.editingRequests).toHaveLength(1);
      expect(snapshot.productionReviewRequests).toHaveLength(1);
      expect(snapshot.publishedRequests).toHaveLength(1);
      expect(snapshot.onHoldRequests).toHaveLength(1);
    });
  });
});
