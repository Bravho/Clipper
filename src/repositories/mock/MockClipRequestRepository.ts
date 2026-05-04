import { IClipRequestRepository } from "@/repositories/interfaces/IClipRequestRepository";
import {
  ClipRequest,
  CreateClipRequestInput,
  UpdateClipRequestInput,
  UpdateStaffFieldsInput,
} from "@/domain/models/ClipRequest";
import { RequestStatus, ACTIVE_STATUSES } from "@/domain/enums/RequestStatus";
import { CREDITS_CONFIG } from "@/config/credits";

// TODO: PostgreSQL — replace this entire class with PostgresClipRequestRepository.
//   The interface contract (IClipRequestRepository) stays the same.
//   Remove the globalThis singleton pattern and use the db pool from @/lib/db instead.

declare global {
  // eslint-disable-next-line no-var
  var __mockClipRequestStore: Map<string, ClipRequest> | undefined;
}

function getStore(): Map<string, ClipRequest> {
  if (!global.__mockClipRequestStore) {
    global.__mockClipRequestStore = new Map();
  }
  return global.__mockClipRequestStore;
}

export class MockClipRequestRepository implements IClipRequestRepository {
  private store: Map<string, ClipRequest>;

  constructor(store?: Map<string, ClipRequest>) {
    this.store = store ?? getStore();
  }

  // ── Requester queries ───────────────────────────────────────────────────────

  async findById(id: string): Promise<ClipRequest | null> {
    const req = this.store.get(id);
    return req ? { ...req } : null;
  }

  async findByUserId(userId: string): Promise<ClipRequest[]> {
    return [...this.store.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findByUserIdAndStatus(
    userId: string,
    statuses: RequestStatus[]
  ): Promise<ClipRequest[]> {
    return [...this.store.values()]
      .filter((r) => r.userId === userId && statuses.includes(r.status))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  // ── Staff queries ───────────────────────────────────────────────────────────

  async findByStatus(statuses: RequestStatus[]): Promise<ClipRequest[]> {
    return [...this.store.values()]
      .filter((r) => statuses.includes(r.status))
      .sort((a, b) => {
        // Sort by submittedAt ascending (oldest first) for queue processing.
        // Fall back to createdAt if submittedAt is null.
        const aTime = (a.submittedAt ?? a.createdAt).getTime();
        const bTime = (b.submittedAt ?? b.createdAt).getTime();
        return aTime - bTime;
      });
  }

  async findAll(limit?: number): Promise<ClipRequest[]> {
    const all = [...this.store.values()].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );
    return limit ? all.slice(0, limit) : all;
  }

  async countByStatus(): Promise<Partial<Record<RequestStatus, number>>> {
    const counts: Partial<Record<RequestStatus, number>> = {};
    for (const request of this.store.values()) {
      counts[request.status] = (counts[request.status] ?? 0) + 1;
    }
    return counts;
  }

  async findOverdue(): Promise<ClipRequest[]> {
    const now = new Date();
    const nonTerminal = new Set([
      RequestStatus.Submitted,
      RequestStatus.UnderReview,
      RequestStatus.AcceptedForProduction,
      RequestStatus.Editing,
      RequestStatus.ScheduledForPublishing,
    ]);
    return [...this.store.values()].filter(
      (r) =>
        r.confirmedDueDate !== null &&
        r.confirmedDueDate < now &&
        nonTerminal.has(r.status)
    );
  }

  async findPendingDueDateConfirmation(): Promise<ClipRequest[]> {
    const needsConfirmation = new Set([
      RequestStatus.AcceptedForProduction,
      RequestStatus.Editing,
      RequestStatus.UnderReview,
    ]);
    return [...this.store.values()]
      .filter((r) => needsConfirmation.has(r.status) && !r.dueDateConfirmed)
      .sort((a, b) => {
        const aTime = (a.submittedAt ?? a.createdAt).getTime();
        const bTime = (b.submittedAt ?? b.createdAt).getTime();
        return aTime - bTime;
      });
  }

  // ── Mutations ───────────────────────────────────────────────────────────────

  async create(input: CreateClipRequestInput): Promise<ClipRequest> {
    const request: ClipRequest = {
      ...input,
      id: crypto.randomUUID(),
      status: RequestStatus.Draft,
      estimatedDueDate: null,
      confirmedDueDate: null,
      dueDateConfirmed: false,
      holdReason: null,
      rejectionReason: null,
      queuePosition: null,
      creditConfirmed: false,
      rightsConfirmed: false,
      creditsCost: CREDITS_CONFIG.REQUEST_COST_CREDITS,
      submittedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      // Staff fields — initialized to null
      effortClass: null,
    };
    this.store.set(request.id, request);
    return { ...request };
  }

  async update(id: string, input: UpdateClipRequestInput): Promise<ClipRequest> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`ClipRequest not found: ${id}`);
    const updated: ClipRequest = {
      ...existing,
      ...input,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return { ...updated };
  }

  async updateStaffFields(
    id: string,
    input: UpdateStaffFieldsInput
  ): Promise<ClipRequest> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`ClipRequest not found: ${id}`);
    const updated: ClipRequest = {
      ...existing,
      ...input,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return { ...updated };
  }

  async updateStatus(
    id: string,
    status: RequestStatus,
    extra?: Partial<
      Pick<
        ClipRequest,
        | "holdReason"
        | "rejectionReason"
        | "confirmedDueDate"
        | "dueDateConfirmed"
        | "estimatedDueDate"
        | "queuePosition"
        | "submittedAt"
        | "creditConfirmed"
        | "rightsConfirmed"
        | "assignedStaffId"
      >
    >
  ): Promise<ClipRequest> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`ClipRequest not found: ${id}`);
    const updated: ClipRequest = {
      ...existing,
      status,
      ...(extra ?? {}),
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
