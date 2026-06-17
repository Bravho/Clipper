import { IEditorProfileRepository } from "@/repositories/interfaces/IEditorProfileRepository";
import {
  EditorProfile,
  CreateEditorProfileInput,
  UpdateEditorProfileInput,
} from "@/domain/models/EditorProfile";

declare global {
  // eslint-disable-next-line no-var
  var __mockEditorProfileStore: Map<string, EditorProfile> | undefined;
}

function getStore(): Map<string, EditorProfile> {
  if (!global.__mockEditorProfileStore) {
    global.__mockEditorProfileStore = new Map();
  }
  return global.__mockEditorProfileStore;
}

export class MockEditorProfileRepository implements IEditorProfileRepository {
  private store: Map<string, EditorProfile>;

  constructor(store?: Map<string, EditorProfile>) {
    this.store = store ?? getStore();
  }

  async findById(id: string): Promise<EditorProfile | null> {
    const profile = this.store.get(id);
    return profile ? { ...profile } : null;
  }

  async findByUserId(userId: string): Promise<EditorProfile | null> {
    const profile = [...this.store.values()].find((p) => p.userId === userId);
    return profile ? { ...profile } : null;
  }

  async findAll(): Promise<EditorProfile[]> {
    return [...this.store.values()]
      .filter((p) => p.isActive && p.isApproved)
      .sort((a, b) => {
        // AI Editor always first, then by rating desc
        if (a.isAI) return -1;
        if (b.isAI) return 1;
        return b.avgRating - a.avgRating;
      });
  }

  async findAIEditor(): Promise<EditorProfile | null> {
    const profile = [...this.store.values()].find((p) => p.isAI && p.isActive);
    return profile ? { ...profile } : null;
  }

  async findAllForAdmin(): Promise<EditorProfile[]> {
    return [...this.store.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  async create(input: CreateEditorProfileInput): Promise<EditorProfile> {
    const profile: EditorProfile = {
      ...input,
      id: crypto.randomUUID(),
      avgRating: input.avgRating ?? 0,
      totalReviews: input.totalReviews ?? 0,
      totalCompleted: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.set(profile.id, profile);
    return { ...profile };
  }

  async update(id: string, input: UpdateEditorProfileInput): Promise<EditorProfile> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`EditorProfile not found: ${id}`);
    const updated: EditorProfile = {
      ...existing,
      ...input,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return { ...updated };
  }
}
