import { RequestStatus, ACTIVE_STATUSES } from "@/domain/enums/RequestStatus";
import { ProductionReviewStatus } from "@/domain/enums/ProductionReviewStatus";
import { ClipRequest } from "@/domain/models/ClipRequest";
import {
  clipRequestRepository,
  productionReviewRepository,
} from "@/repositories";

/**
 * AdminDashboardService — aggregates operational summary data for the admin dashboard.
 *
 * Provides queue counts, SLA indicators, production review status, and
 * delivery readiness. Broader than the StaffDashboardService.
 *
 * Does NOT contain business rules — it aggregates data for display only.
 *
 * TODO: PostgreSQL — replace all in-memory queries with efficient SQL.
 *   Most aggregations can be single GROUP BY queries.
 */

export interface AdminDashboardSummary {
  // Request counts by status
  submittedCount: number;
  underReviewCount: number;
  acceptedCount: number;
  editingCount: number;
  productionReviewCount: number;  // ScheduledForPublishing
  publishedCount: number;
  deliveredCount: number;
  onHoldCount: number;
  rejectedCount: number;

  // Operational alerts
  pendingAdminReviewCount: number; // ProductionReviews with Pending status
  overdueCount: number;
  deliveredRecentCount: number;    // Delivered in last 14 days

  // Recent activity
  recentActivity: ClipRequest[];
}

export interface AdminQueueSnapshot {
  submittedRequests: ClipRequest[];
  underReviewRequests: ClipRequest[];
  editingRequests: ClipRequest[];
  productionReviewRequests: ClipRequest[];
  publishedRequests: ClipRequest[];
  onHoldRequests: ClipRequest[];
  overdueRequests: ClipRequest[];
}

export class AdminDashboardService {
  async getSummary(): Promise<AdminDashboardSummary> {
    const [counts, overdue, recent, pendingReviews] = await Promise.all([
      clipRequestRepository.countByStatus(),
      clipRequestRepository.findOverdue(),
      clipRequestRepository.findAll(15),
      productionReviewRepository.findByStatus(ProductionReviewStatus.Pending),
    ]);

    const submittedCount = counts[RequestStatus.Submitted] ?? 0;
    const underReviewCount = counts[RequestStatus.UnderReview] ?? 0;
    const acceptedCount = counts[RequestStatus.AcceptedForProduction] ?? 0;
    const editingCount = counts[RequestStatus.Editing] ?? 0;
    const productionReviewCount = counts[RequestStatus.ScheduledForPublishing] ?? 0;
    const publishedCount = counts[RequestStatus.Published] ?? 0;
    const deliveredCount = counts[RequestStatus.Delivered] ?? 0;
    const onHoldCount = counts[RequestStatus.OnHold] ?? 0;
    const rejectedCount = counts[RequestStatus.Rejected] ?? 0;

    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const allDelivered = await clipRequestRepository.findByStatus([RequestStatus.Delivered]);
    const deliveredRecentCount = allDelivered.filter(
      (r) => r.updatedAt >= fourteenDaysAgo
    ).length;

    return {
      submittedCount,
      underReviewCount,
      acceptedCount,
      editingCount,
      productionReviewCount,
      publishedCount,
      deliveredCount,
      onHoldCount,
      rejectedCount,
      pendingAdminReviewCount: pendingReviews.length,
      overdueCount: overdue.length,
      deliveredRecentCount,
      recentActivity: recent,
    };
  }

  async getQueueSnapshot(): Promise<AdminQueueSnapshot> {
    const [submitted, underReview, editing, productionReview, published, onHold, overdue] =
      await Promise.all([
        clipRequestRepository.findByStatus([RequestStatus.Submitted]),
        clipRequestRepository.findByStatus([RequestStatus.UnderReview, RequestStatus.AcceptedForProduction]),
        clipRequestRepository.findByStatus([RequestStatus.Editing]),
        clipRequestRepository.findByStatus([RequestStatus.ScheduledForPublishing]),
        clipRequestRepository.findByStatus([RequestStatus.Published]),
        clipRequestRepository.findByStatus([RequestStatus.OnHold]),
        clipRequestRepository.findOverdue(),
      ]);

    return {
      submittedRequests: submitted,
      underReviewRequests: underReview,
      editingRequests: editing,
      productionReviewRequests: productionReview,
      publishedRequests: published,
      onHoldRequests: onHold,
      overdueRequests: overdue,
    };
  }

  /**
   * Get full workload breakdown for admin workload page.
   * Returns status counts, active request counts, overdue list, and per-staff breakdown.
   */
  async getWorkloadBreakdown(): Promise<{
    counts: Partial<Record<RequestStatus, number>>;
    overdue: ClipRequest[];
    activeTotal: number;
    byStatus: Record<string, ClipRequest[]>;
    byStaff: Record<string, ClipRequest[]>;
    pendingAdminReviewCount: number;
  }> {
    const [counts, overdue, pendingReviews] = await Promise.all([
      clipRequestRepository.countByStatus(),
      clipRequestRepository.findOverdue(),
      productionReviewRepository.findByStatus(ProductionReviewStatus.Pending),
    ]);

    const activeRequests = await clipRequestRepository.findByStatus(ACTIVE_STATUSES);

    const byStatus: Record<string, ClipRequest[]> = {};
    const byStaff: Record<string, ClipRequest[]> = {};

    for (const req of activeRequests) {
      if (!byStatus[req.status]) byStatus[req.status] = [];
      byStatus[req.status].push(req);

      const staffKey = req.assignedStaffId ?? "unassigned";
      if (!byStaff[staffKey]) byStaff[staffKey] = [];
      byStaff[staffKey].push(req);
    }

    return {
      counts,
      overdue,
      activeTotal: activeRequests.length,
      byStatus,
      byStaff,
      pendingAdminReviewCount: pendingReviews.length,
    };
  }

  /**
   * Get SLA-focused data: overdue, due soon, and requests stalled at each stage.
   */
  async getSlaData(): Promise<{
    overdue: ClipRequest[];
    dueSoon: ClipRequest[];    // confirmed due date within next 1 working day (24h)
    pendingReviewStale: ClipRequest[];   // in ScheduledForPublishing > 24h
    publishedNotDelivered: ClipRequest[];
  }> {
    const [overdue, scheduledForPublishing, published] = await Promise.all([
      clipRequestRepository.findOverdue(),
      clipRequestRepository.findByStatus([RequestStatus.ScheduledForPublishing]),
      clipRequestRepository.findByStatus([RequestStatus.Published]),
    ]);

    const allActive = await clipRequestRepository.findByStatus(ACTIVE_STATUSES);
    const now = new Date();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Due soon = within 1 working day (next 24h), still in future
    const dueSoon = allActive.filter((r) => {
      if (!r.confirmedDueDate) return false;
      const timeLeft = r.confirmedDueDate.getTime() - now.getTime();
      return timeLeft > 0 && timeLeft <= oneDayMs;
    });

    const pendingReviewStale = scheduledForPublishing.filter((r) => {
      return now.getTime() - r.updatedAt.getTime() > oneDayMs;
    });

    return {
      overdue,
      dueSoon,
      pendingReviewStale,
      publishedNotDelivered: published,
    };
  }

  /**
   * Calculate per-staff output history and platform-wide capacity projections.
   *
   * Per-staff stats are derived from Published + Delivered requests (historical output).
   * Capacity projection estimates days to clear the current active queue and how
   * many additional staff/clippers are needed to meet a target completion window.
   *
   * Assumptions:
   *   - A "working day" is any calendar day Mon–Fri.
   *   - Staff output history = requests they were assigned to that are now
   *     Published or Delivered (they completed the editing work).
   *   - "Capacity needed per day" for the projection is based on the platform
   *     SLA target of 2 working days per request.
   *
   * TODO: PostgreSQL — replace in-memory calculations with efficient SQL queries.
   *   SELECT assigned_staff_id, DATE(updated_at), COUNT(*) FROM clip_requests
   *   WHERE status IN ('published','delivered') AND assigned_staff_id IS NOT NULL
   *   GROUP BY 1, 2
   */
  async getCapacityStats(): Promise<CapacityStats> {
    const completedStatuses = [RequestStatus.Published, RequestStatus.Delivered];
    const [completedRequests, activeRequests] = await Promise.all([
      clipRequestRepository.findByStatus(completedStatuses),
      clipRequestRepository.findByStatus(ACTIVE_STATUSES),
    ]);

    // ── Per-staff historical output ──────────────────────────────────────────

    // Group completed requests by assignedStaffId
    const byStaff = new Map<string, ClipRequest[]>();
    for (const req of completedRequests) {
      if (!req.assignedStaffId) continue;
      if (!byStaff.has(req.assignedStaffId)) byStaff.set(req.assignedStaffId, []);
      byStaff.get(req.assignedStaffId)!.push(req);
    }

    const staffStats: StaffCapacityStat[] = [];
    for (const [staffId, reqs] of byStaff.entries()) {
      const sorted = [...reqs].sort(
        (a, b) => a.updatedAt.getTime() - b.updatedAt.getTime()
      );

      // Group completions by calendar date (YYYY-MM-DD)
      const byDate = new Map<string, number>();
      for (const req of sorted) {
        const dateKey = req.updatedAt.toISOString().slice(0, 10);
        byDate.set(dateKey, (byDate.get(dateKey) ?? 0) + 1);
      }

      const maxPerDay = Math.max(...byDate.values(), 0);

      // Count working days between first and last completion
      const firstDate = sorted[0].updatedAt;
      const lastDate = sorted[sorted.length - 1].updatedAt;
      const workingDays = Math.max(1, countWorkingDays(firstDate, lastDate));

      const avgPerDay = parseFloat((reqs.length / workingDays).toFixed(2));

      staffStats.push({
        staffId,
        completedRequests: reqs.length,
        maxPerDay,
        avgPerDay,
        workingDaysActive: workingDays,
      });
    }

    // ── Capacity projection ──────────────────────────────────────────────────

    // Active requests that are unassigned (not yet picked up by staff)
    const unassignedRequests = activeRequests.filter((r) => !r.assignedStaffId);
    // Active requests currently assigned (in progress)
    const assignedActiveRequests = activeRequests.filter((r) => r.assignedStaffId);

    // Current daily capacity = sum of each active staff member's avgPerDay
    // "Active staff" = those who currently have assigned requests OR appear in history
    const staffIdsWithLoad = new Set([
      ...assignedActiveRequests.map((r) => r.assignedStaffId!),
      ...staffStats.map((s) => s.staffId),
    ]);

    // Use the historical avg if available; otherwise assume platform default (0.5 req/day)
    const DEFAULT_DAILY_OUTPUT = 0.5; // conservative default: 1 request per 2 days
    let totalDailyCapacity = 0;
    for (const staffId of staffIdsWithLoad) {
      const stat = staffStats.find((s) => s.staffId === staffId);
      totalDailyCapacity += stat?.avgPerDay ?? DEFAULT_DAILY_OUTPUT;
    }

    const activeStaffCount = staffIdsWithLoad.size;

    // Days to clear ALL active requests (assigned + unassigned) at current capacity
    const daysToCompleteAll =
      totalDailyCapacity > 0
        ? parseFloat((activeRequests.length / totalDailyCapacity).toFixed(1))
        : null;

    // Days to clear only unassigned requests at current capacity
    const daysToCompleteUnassigned =
      totalDailyCapacity > 0
        ? parseFloat((unassignedRequests.length / totalDailyCapacity).toFixed(1))
        : null;

    // Target: complete all active work within TARGET_DAYS working days
    const TARGET_DAYS = 5;
    const requiredDailyCapacity = activeRequests.length / TARGET_DAYS;
    const additionalCapacityNeeded = Math.max(
      0,
      requiredDailyCapacity - totalDailyCapacity
    );

    // Per-staff avg or default for new hire projection
    const avgOutputPerNewStaff =
      staffStats.length > 0
        ? staffStats.reduce((sum, s) => sum + s.avgPerDay, 0) / staffStats.length
        : DEFAULT_DAILY_OUTPUT;

    const additionalStaffNeeded =
      additionalCapacityNeeded > 0
        ? Math.ceil(additionalCapacityNeeded / avgOutputPerNewStaff)
        : 0;

    return {
      staffStats,
      activeStaffCount,
      totalDailyCapacity: parseFloat(totalDailyCapacity.toFixed(2)),
      unassignedRequestCount: unassignedRequests.length,
      assignedActiveRequestCount: assignedActiveRequests.length,
      totalActiveRequestCount: activeRequests.length,
      daysToCompleteAll,
      daysToCompleteUnassigned,
      additionalStaffNeeded,
      targetDays: TARGET_DAYS,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Count working days (Mon–Fri) between two dates, inclusive of both endpoints.
 * Returns at least 1 to avoid division by zero.
 */
function countWorkingDays(from: Date, to: Date): number {
  let count = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++; // skip Sunday (0) and Saturday (6)
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.max(1, count);
}

// ── Exported types ────────────────────────────────────────────────────────────

export interface StaffCapacityStat {
  staffId: string;
  completedRequests: number;
  maxPerDay: number;        // highest single-day output ever recorded
  avgPerDay: number;        // avg completions per working day over active period
  workingDaysActive: number;
}

export interface CapacityStats {
  staffStats: StaffCapacityStat[];
  activeStaffCount: number;
  totalDailyCapacity: number;       // sum of all staff avgPerDay
  unassignedRequestCount: number;
  assignedActiveRequestCount: number;
  totalActiveRequestCount: number;
  daysToCompleteAll: number | null;          // days at current capacity to clear active queue
  daysToCompleteUnassigned: number | null;   // days to clear unassigned items only
  additionalStaffNeeded: number;             // extra staff to hit TARGET_DAYS
  targetDays: number;                        // the planning target window (default 5)
}

export const adminDashboardService = new AdminDashboardService();
