import { IRequestStatusHistoryRepository } from "@/repositories/interfaces/IRequestStatusHistoryRepository";
import {
  RequestStatusHistory,
  CreateStatusHistoryInput,
} from "@/domain/models/RequestStatusHistory";
import { SEED_STATUS_HISTORY } from "@/seed/requestSeedData";

// TODO: PostgreSQL — replace with PostgresRequestStatusHistoryRepository.
//   Status history is append-only. No updates or deletes.

declare global {
  // eslint-disable-next-line no-var
  var __mockStatusHistoryStore: Map<string, RequestStatusHistory> | undefined;
}

function getStore(): Map<string, RequestStatusHistory> {
  if (!global.__mockStatusHistoryStore) {
    global.__mockStatusHistoryStore = new Map();
    SEED_STATUS_HISTORY.forEach((h) =>
      global.__mockStatusHistoryStore!.set(h.id, { ...h })
    );
  }
  return global.__mockStatusHistoryStore;
}

export class MockRequestStatusHistoryRepository
  implements IRequestStatusHistoryRepository
{
  private store: Map<string, RequestStatusHistory>;

  constructor(store?: Map<string, RequestStatusHistory>) {
    this.store = store ?? getStore();
  }

  async findByRequestId(requestId: string): Promise<RequestStatusHistory[]> {
    return [...this.store.values()]
      .filter((h) => h.requestId === requestId)
      .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  }

  async create(input: CreateStatusHistoryInput): Promise<RequestStatusHistory> {
    const entry: RequestStatusHistory = {
      ...input,
      id: crypto.randomUUID(),
    };
    this.store.set(entry.id, entry);
    return { ...entry };
  }
}
