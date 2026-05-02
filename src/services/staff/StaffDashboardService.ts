import { RequestStatus } from "@/domain/enums/RequestStatus";
import { ClipRequest } from "@/domain/models/ClipRequest";
import { clipRequestRepository } from "@/repositories";

/**
 * StaffDashboardService — aggregates operational summary data for the staff dashboard home.
 *
 * Provides queue counts, at-risk indicators, and workload snapshots.
 * Does NOT contain business rules — it aggregates data for display.
 *
 * TODO: PostgreSQL — replace all in-memory queries with efficient SQL.
 *   Many of these can be single GROUP BY queries rather than multiple round-trips.
 *   Example:
 *     SELECT status, COUNT(*) FROM clip_requests GROUP BY status;
 *
 * TODO: Admin Portal — admins get a superset of this dashboard with
 *   per-staff workload breakdown, SLA tracking, and full system metrics.
 */

export interface StaffDashboardSummary {
  newRequestsCount: number;       // Submitted — awaiting acceptance
  editingCount: number;           // Editing — active in CapCut
  productionReviewCount: number;  // ScheduledForPublishing — awaiting admin review
  publishingCount: number;        // Published — approved, being delivered
  onHoldCount: number;
  deliveredRecentCount: number;   // Delivered in last 14 days
  overdueCount: number;           // Past confirmed due date, still active
  recentActivity: ClipRequest[];  // Last 10 updated requests (any status)
}

export class StaffDashboardService {
  async getSummary(): Promise<StaffDashboardSummary> {
    const [counts, overdue, recent] = await Promise.all([
      clipRequestRepository.countByStatus(),
      clipRequestRepository.findOverdue(),
      clipRequestRepository.findAll(10),
    ]);

    const newRequestsCount = counts[RequestStatus.Submitted] ?? 0;
    const editingCount = counts[RequestStatus.Editing] ?? 0;
    const productionReviewCount = counts[RequestStatus.ScheduledForPublishing] ?? 0;
    const publishingCount = counts[RequestStatus.Published] ?? 0;
    const onHoldCount = counts[RequestStatus.OnHold] ?? 0;

    // Count delivered requests updated in the last 14 days
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const allDelivered = await clipRequestRepository.findByStatus([RequestStatus.Delivered]);
    const deliveredRecentCount = allDelivered.filter(
      (r) => r.updatedAt >= fourteenDaysAgo
    ).length;

    return {
      newRequestsCount,
      editingCount,
      productionReviewCount,
      publishingCount,
      onHoldCount,
      deliveredRecentCount,
      overdueCount: overdue.length,
      recentActivity: recent,
    };
  }

  async getWorkloadSummary(): Promise<{
    counts: Partial<Record<RequestStatus, number>>;
    overdue: ClipRequest[];
    byStatus: Record<string, ClipRequest[]>;
  }> {
    const [counts, overdue] = await Promise.all([
      clipRequestRepository.countByStatus(),
      clipRequestRepository.findOverdue(),
    ]);

    // Load all active requests for grouping
    const activeStatuses = [
      RequestStatus.Submitted,
      RequestStatus.Editing,
      RequestStatus.ScheduledForPublishing,
      RequestStatus.Published,
      RequestStatus.OnHold,
    ];
    const activeRequests = await clipRequestRepository.findByStatus(activeStatuses);

    const byStatus: Record<string, ClipRequest[]> = {};
    for (const req of activeRequests) {
      if (!byStatus[req.status]) byStatus[req.status] = [];
      byStatus[req.status].push(req);
    }

    return { counts, overdue, byStatus };
  }
}

// Singleton instance
export const staffDashboardService = new StaffDashboardService();
