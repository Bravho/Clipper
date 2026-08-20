import { RequestStatus } from "@/domain/enums/RequestStatus";
import { ClipRequest } from "@/domain/models/ClipRequest";
import { RenderTask } from "@/domain/models/RenderTask";
import {
  clipRequestRepository,
  renderTaskRepository,
  videoGenerationJobRepository,
} from "@/repositories";
import { RENDER_QUEUE } from "@/config/renderQueue";

/**
 * AdminDashboardService — aggregates operational summary data for the admin dashboard.
 *
 * Provides queue counts, SLA indicators and render-worker liveness.
 *
 * Does NOT contain business rules — it aggregates data for display only.
 *
 * The former staff-workflow aggregations (`getWorkloadBreakdown`, `getSlaData`,
 * `getCapacityStats`) were removed with the pages that consumed them: they were
 * built around per-staff assignment and the `ScheduledForPublishing` production
 * review, neither of which exists now that `Role` is only Requester + Admin.
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
  publishedCount: number;
  deliveredCount: number;
  onHoldCount: number;
  rejectedCount: number;

  // Operational alerts
  overdueCount: number;
  deliveredRecentCount: number;    // Delivered in last 14 days

  // Recent activity
  recentActivity: ClipRequest[];
}

export interface AdminQueueSnapshot {
  submittedRequests: ClipRequest[];
  underReviewRequests: ClipRequest[];
  editingRequests: ClipRequest[];
  publishedRequests: ClipRequest[];
  onHoldRequests: ClipRequest[];
  overdueRequests: ClipRequest[];
}

/**
 * Live view of the Mac Mini render worker's FIFO line: whether a worker is
 * currently alive (fresh heartbeat), and the ordered active tasks (the claimed
 * one rendering now is at the front). Unlike the requester view, admins DO see
 * which requester + step each task is.
 */
export interface RenderQueueSnapshot {
  workerOnline: boolean;
  tasks: RenderTask[];
}

export class AdminDashboardService {
  async getSummary(): Promise<AdminDashboardSummary> {
    const [counts, overdue, recent] = await Promise.all([
      clipRequestRepository.countByStatus(),
      clipRequestRepository.findOverdue(),
      clipRequestRepository.findAll(15),
    ]);

    const submittedCount = counts[RequestStatus.Submitted] ?? 0;
    const underReviewCount = counts[RequestStatus.UnderReview] ?? 0;
    const acceptedCount = counts[RequestStatus.AcceptedForProduction] ?? 0;
    const editingCount = counts[RequestStatus.Editing] ?? 0;
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
      publishedCount,
      deliveredCount,
      onHoldCount,
      rejectedCount,
      overdueCount: overdue.length,
      deliveredRecentCount,
      recentActivity: recent,
    };
  }

  async getQueueSnapshot(): Promise<AdminQueueSnapshot> {
    const [submitted, underReview, editing, published, onHold, overdue] =
      await Promise.all([
        clipRequestRepository.findByStatus([RequestStatus.Submitted]),
        clipRequestRepository.findByStatus([RequestStatus.UnderReview, RequestStatus.AcceptedForProduction]),
        clipRequestRepository.findByStatus([RequestStatus.Editing]),
        clipRequestRepository.findByStatus([RequestStatus.Published]),
        clipRequestRepository.findByStatus([RequestStatus.OnHold]),
        clipRequestRepository.findOverdue(),
      ]);

    return {
      submittedRequests: submitted,
      underReviewRequests: underReview,
      editingRequests: editing,
      publishedRequests: published,
      onHoldRequests: onHold,
      overdueRequests: overdue,
    };
  }

  /**
   * Snapshot of the Mac Mini render-worker FIFO line for the admin monitor:
   * worker liveness + the ordered active tasks (rendering-now task at the front).
   */
  async getRenderQueueSnapshot(): Promise<RenderQueueSnapshot> {
    const [workerOnline, tasks] = await Promise.all([
      videoGenerationJobRepository.isRenderWorkerAlive(RENDER_QUEUE.workerFreshSeconds),
      renderTaskRepository.listActive(),
    ]);
    return { workerOnline, tasks };
  }
}

export const adminDashboardService = new AdminDashboardService();
