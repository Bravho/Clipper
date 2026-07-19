import { IDeletedAccountRegistryRepository } from "@/repositories/interfaces/IDeletedAccountRegistryRepository";
import {
  DeletedAccountRecord,
  CreateDeletedAccountRecordInput,
} from "@/domain/models/DeletedAccountRecord";

declare global {
  // eslint-disable-next-line no-var
  var __mockDeletedAccountRegistryStore:
    | Map<string, DeletedAccountRecord>
    | undefined;
}

function getStore(): Map<string, DeletedAccountRecord> {
  if (!global.__mockDeletedAccountRegistryStore) {
    global.__mockDeletedAccountRegistryStore = new Map();
  }
  return global.__mockDeletedAccountRegistryStore;
}

export class MockDeletedAccountRegistryRepository
  implements IDeletedAccountRegistryRepository
{
  private store: Map<string, DeletedAccountRecord>;

  constructor(store?: Map<string, DeletedAccountRecord>) {
    this.store = store ?? getStore();
  }

  async create(
    input: CreateDeletedAccountRecordInput
  ): Promise<DeletedAccountRecord> {
    const record: DeletedAccountRecord = {
      ...input,
      id: crypto.randomUUID(),
      deletedAt: new Date(),
    };
    this.store.set(record.id, record);
    return { ...record };
  }

  async findByEmailHash(emailHash: string): Promise<DeletedAccountRecord[]> {
    return [...this.store.values()]
      .filter((r) => r.emailHash === emailHash)
      .map((r) => ({ ...r }));
  }

  async findByProviderAccountHash(
    providerAccountHash: string
  ): Promise<DeletedAccountRecord[]> {
    return [...this.store.values()]
      .filter((r) => r.providerAccountHash === providerAccountHash)
      .map((r) => ({ ...r }));
  }
}
