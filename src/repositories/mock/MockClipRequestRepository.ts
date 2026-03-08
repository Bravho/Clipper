import { IClipRequestRepository } from "@/repositories/interfaces/IClipRequestRepository";
import {
  ClipRequest,
  CreateClipRequestInput,
  UpdateClipRequestInput,
} from "@/domain/models/ClipRequest";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { CREDITS_CONFIG } from "@/config/credits";
import { SEED_CLIP_REQUESTS } from "@/seed/requestSeedData";

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
    SEED_CLIP_REQUESTS.forEach((r) =>
      global.__mockClipRequestStore!.set(r.id, { ...r })
    );
  }
  return global.__mockClipRequestStore;
}

export class MockClipRequestRepository implements IClipRequestRepository {
  private store: Map<string, ClipRequest>;

  constructor(store?: Map<string, ClipRequest>) {
    this.store = store ?? getStore();
  }

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
