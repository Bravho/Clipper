import type { IVideoAllowanceWindowRepository } from "@/repositories/interfaces/IVideoAllowanceWindowRepository";
import {
  VideoAllowanceWindow,
  CreateVideoAllowanceWindowInput,
  isWindowSpendable,
} from "@/domain/models/VideoAllowanceWindow";
import { VideoAllowanceWindowStatus } from "@/domain/enums/VideoAllowanceStatus";

// TODO: PostgreSQL — this mock mirrors PostgresVideoAllowanceWindowRepository's
// SQL behaviour (replay-safe grant, FIFO spend, timestamp-decided spendability).

declare global {
  // eslint-disable-next-line no-var
  var __mockVideoAllowanceWindowStore:
    | Map<string, VideoAllowanceWindow>
    | undefined;
}

function getStore(): Map<string, VideoAllowanceWindow> {
  if (!global.__mockVideoAllowanceWindowStore) {
    global.__mockVideoAllowanceWindowStore = new Map();
  }
  return global.__mockVideoAllowanceWindowStore;
}

export class MockVideoAllowanceWindowRepository
  implements IVideoAllowanceWindowRepository
{
  private store: Map<string, VideoAllowanceWindow>;

  constructor(store?: Map<string, VideoAllowanceWindow>) {
    this.store = store ?? getStore();
  }

  async createOrGetByPurchase(input: {
    purchaseId: string;
    windows: CreateVideoAllowanceWindowInput[];
  }): Promise<{ windows: VideoAllowanceWindow[]; created: boolean }> {
    const existing = [...this.store.values()]
      .filter((w) => w.purchaseId === input.purchaseId)
      .sort((a, b) => a.sequence - b.sequence);
    if (existing.length > 0) {
      return { windows: existing.map((w) => ({ ...w })), created: false };
    }

    const now = new Date();
    const created = input.windows.map((spec) => {
      const window: VideoAllowanceWindow = {
        ...spec,
        id: crypto.randomUUID(),
        remaining: spec.totalAllowance,
        status: VideoAllowanceWindowStatus.Active,
        createdAt: now,
        updatedAt: now,
      };
      this.store.set(window.id, window);
      return { ...window };
    });

    return { windows: created, created: true };
  }

  async findById(id: string): Promise<VideoAllowanceWindow | null> {
    const w = this.store.get(id);
    return w ? { ...w } : null;
  }

  async findByUserId(userId: string): Promise<VideoAllowanceWindow[]> {
    return [...this.store.values()]
      .filter((w) => w.userId === userId)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((w) => ({ ...w }));
  }

  async findSpendable(
    userId: string,
    now: Date
  ): Promise<VideoAllowanceWindow | null> {
    const spendable = [...this.store.values()]
      .filter((w) => w.userId === userId && isWindowSpendable(w, now))
      // Oldest-expiring first, so the month closest to lapsing is used up first.
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
    return spendable[0] ? { ...spendable[0] } : null;
  }

  async latestExpiry(userId: string, now: Date): Promise<Date | null> {
    const live = [...this.store.values()].filter(
      (w) =>
        w.userId === userId &&
        w.status === VideoAllowanceWindowStatus.Active &&
        w.expiresAt.getTime() > now.getTime()
    );
    if (live.length === 0) return null;
    return new Date(Math.max(...live.map((w) => w.expiresAt.getTime())));
  }

  async consumeOne(userId: string, now: Date): Promise<string | null> {
    const target = await this.findSpendable(userId, now);
    if (!target) return null;
    const stored = this.store.get(target.id);
    // Re-check against the stored row, not the copy: this is the guard the SQL
    // does with `WHERE remaining > 0`.
    if (!stored || stored.remaining <= 0) return null;
    this.store.set(stored.id, {
      ...stored,
      remaining: stored.remaining - 1,
      updatedAt: new Date(),
    });
    return stored.id;
  }

  async refundOne(windowId: string): Promise<void> {
    const w = this.store.get(windowId);
    if (!w) return;
    // Never above the allowance, and never resurrect an elapsed month.
    if (w.remaining >= w.totalAllowance) return;
    if (w.status !== VideoAllowanceWindowStatus.Active) return;
    this.store.set(windowId, {
      ...w,
      remaining: w.remaining + 1,
      updatedAt: new Date(),
    });
  }

  async markElapsedExpired(now: Date): Promise<number> {
    let count = 0;
    for (const [id, w] of this.store) {
      if (
        w.status === VideoAllowanceWindowStatus.Active &&
        w.expiresAt.getTime() <= now.getTime()
      ) {
        this.store.set(id, {
          ...w,
          status: VideoAllowanceWindowStatus.Expired,
          updatedAt: new Date(),
        });
        count++;
      }
    }
    return count;
  }
}
