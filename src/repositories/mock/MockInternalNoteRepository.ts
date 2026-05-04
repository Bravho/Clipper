import { IInternalNoteRepository } from "@/repositories/interfaces/IInternalNoteRepository";
import {
  InternalNote,
  CreateInternalNoteInput,
} from "@/domain/models/InternalNote";

// TODO: PostgreSQL — replace this entire class with PostgresInternalNoteRepository.
//   The interface contract (IInternalNoteRepository) stays the same.
//   Remove the globalThis singleton pattern and use the db pool from @/lib/db instead.
//   IMPORTANT: Ensure all queries are scoped to staff/admin — never expose via requester routes.

declare global {
  // eslint-disable-next-line no-var
  var __mockInternalNoteStore: Map<string, InternalNote> | undefined;
}

function getStore(): Map<string, InternalNote> {
  if (!global.__mockInternalNoteStore) {
    global.__mockInternalNoteStore = new Map();
  }
  return global.__mockInternalNoteStore;
}

export class MockInternalNoteRepository implements IInternalNoteRepository {
  private store: Map<string, InternalNote>;

  constructor(store?: Map<string, InternalNote>) {
    this.store = store ?? getStore();
  }

  async findByRequestId(requestId: string): Promise<InternalNote[]> {
    return [...this.store.values()]
      .filter((n) => n.requestId === requestId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findLatestByRequestId(requestId: string): Promise<InternalNote | null> {
    const notes = await this.findByRequestId(requestId);
    return notes[0] ?? null;
  }

  async findByAuthorId(authorId: string): Promise<InternalNote[]> {
    return [...this.store.values()]
      .filter((n) => n.authorId === authorId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async create(input: CreateInternalNoteInput): Promise<InternalNote> {
    const now = new Date();
    const note: InternalNote = {
      id: crypto.randomUUID(),
      requestId: input.requestId,
      authorId: input.authorId,
      authorName: input.authorName,
      content: input.content,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(note.id, note);
    return { ...note };
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
