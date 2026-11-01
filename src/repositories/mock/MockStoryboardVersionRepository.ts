import { randomUUID } from 'crypto';
import type { IStoryboardVersionRepository } from '../interfaces/IStoryboardVersionRepository';
import type { StoryboardVersion, NewStoryboardVersion } from '@/domain/models/StoryboardVersion';
export class MockStoryboardVersionRepository implements IStoryboardVersionRepository {
  constructor(private rows = new Map<string, StoryboardVersion>(), public revisions = new Map<string, number>(), public deliveries = new Map<string, string>()) {}
  async get(id: string) { const row = this.rows.get(id); return row ? structuredClone(row) : null; }
  async latest(requestId: string) { const row = [...this.rows.values()].filter(v => v.requestId === requestId).pop(); return row ? structuredClone(row) : null; }
  async append(input: NewStoryboardVersion, consumeRevision = false) {
    const latest = [...this.rows.values()].filter(v => v.requestId === input.requestId).pop();
    if ((latest?.id ?? null) !== input.parentVersionId) throw new Error('version_conflict');
    if (consumeRevision && (this.revisions.get(input.requestId) ?? 0) >= 2) throw new Error('max_revisions_exceeded');
    const row = { ...structuredClone(input), id: randomUUID(), createdAt: new Date().toISOString() };
    this.rows.set(row.id, row);
    if (consumeRevision) this.revisions.set(input.requestId, (this.revisions.get(input.requestId) ?? 0) + 1);
    return structuredClone(row);
  }
  async linkDelivery(requestId: string, versionId: string, assetIds: string[]) { this.deliveries.set(requestId, versionId); for (const id of assetIds) this.deliveries.set(id, versionId); }
}
