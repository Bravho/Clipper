import { RequestStatus, ACTIVE_STATUSES } from "@/domain/enums/RequestStatus";
import { ClipRequest } from "@/domain/models/ClipRequest";
import {
  clipRequestRepository,
  publishingLinkRepository,
} from "@/repositories";
import { creditService } from "@/services/CreditService";
import {
  requestPresentationService,
  DueDateDisplay,
  QueueDisplay,
  StatusPresentation,
} from "@/services/RequestPresentationService";

/**
 * RequesterDashboardService — aggregates all data needed for the requester
 * dashboard home page in a single fetch, minimising round trips.
 *
 * TODO: PostgreSQL — when live, consider a single JOIN query instead of
 *   multiple round trips for performance on the dashboard load.
 */

export interface DashboardSummary {
  creditBalance: number;
  activeRequestCount: number;
  draftCount: number;
  recentRequests: DashboardRequestRow[];
  activeRequests: DashboardRequestRow[];
  recentlyDelivered: DashboardDeliveredRow[];
}

export interface DashboardRequestRow {
  id: string;
  title: string;
  status: RequestStatus;
  statusPresentation: StatusPresentation;
  dueDateDisplay: DueDateDisplay;
  queueDisplay: QueueDisplay;
  submittedAt: Date | null;
  updatedAt: Date;
}

export interface DashboardDeliveredRow {
  id: string;
  title: string;
  deliveredAt: Date;
  linkCount: number;
}

export class RequesterDashboardService {
  async getDashboardSummary(userId: string): Promise<DashboardSummary> {
    const [balance, allRequests] = await Promise.all([
      creditService.getBalance(userId),
      clipRequestRepository.findByUserId(userId),
    ]);

    const activeRequests = allRequests.filter((r) =>
      ACTIVE_STATUSES.includes(r.status)
    );
    const draftRequests = allRequests.filter(
      (r) => r.status === RequestStatus.Draft
    );
    const deliveredRequests = allRequests
      .filter((r) => r.status === RequestStatus.Delivered)
      .slice(0, 3);

    // Fetch publishing link counts for delivered requests
    const deliveredRows: DashboardDeliveredRow[] = await Promise.all(
      deliveredRequests.map(async (r) => {
        const links = await publishingLinkRepository.findByRequestId(r.id);
        return {
          id: r.id,
          title: r.title,
          deliveredAt: r.updatedAt,
          linkCount: links.length,
        };
      })
    );

    const recentRequests = allRequests
      .filter((r) => r.status !== RequestStatus.Draft)
      .slice(0, 5)
      .map((r) => this.toRow(r));

    const activeRows = activeRequests.slice(0, 5).map((r) => this.toRow(r));

    return {
      creditBalance: balance,
      activeRequestCount: activeRequests.length,
      draftCount: draftRequests.length,
      recentRequests,
      activeRequests: activeRows,
      recentlyDelivered: deliveredRows,
    };
  }

  private toRow(request: ClipRequest): DashboardRequestRow {
    return {
      id: request.id,
      title: request.title,
      status: request.status,
      statusPresentation: requestPresentationService.getStatusPresentation(
        request.status
      ),
      dueDateDisplay: requestPresentationService.getDueDateDisplay(request),
      queueDisplay: requestPresentationService.getQueueDisplay(request),
      submittedAt: request.submittedAt,
      updatedAt: request.updatedAt,
    };
  }
}

// Singleton instance
export const requesterDashboardService = new RequesterDashboardService();
