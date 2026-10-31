/**
 * Tests for review ordering and revision limit enforcement.
 *
 * MAX_REVISIONS_PER_CLIP: a requester may request at most 2 revisions per clip.
 * MAX_CLIP_DURATION_SECONDS: 90s maximum.
 */

import { MAX_REVISIONS_PER_CLIP, MAX_CLIP_DURATION_SECONDS } from '@/config/reviewSystem';

describe('reviewSystem constants', () => {
  it('MAX_REVISIONS_PER_CLIP is 2', () => {
    expect(MAX_REVISIONS_PER_CLIP).toBe(2);
  });

  it('MAX_CLIP_DURATION_SECONDS is 90', () => {
    expect(MAX_CLIP_DURATION_SECONDS).toBe(90);
  });
});

describe('revision limit enforcement (unit logic)', () => {
  function canRequestRevision(revisionCount: number): boolean {
    return revisionCount < MAX_REVISIONS_PER_CLIP;
  }

  it('allows first revision (revisionCount=0)', () => {
    expect(canRequestRevision(0)).toBe(true);
  });

  it('allows second revision (revisionCount=1)', () => {
    expect(canRequestRevision(1)).toBe(true);
  });

  it('blocks third revision (revisionCount=2)', () => {
    expect(canRequestRevision(2)).toBe(false);
  });

  it('blocks excessive revisions', () => {
    expect(canRequestRevision(5)).toBe(false);
  });
});

describe('clip duration enforcement (unit logic)', () => {
  function isDurationValid(seconds: number): boolean {
    return seconds > 0 && seconds <= MAX_CLIP_DURATION_SECONDS;
  }

  it('accepts 30 seconds', () => {
    expect(isDurationValid(30)).toBe(true);
  });

  it('accepts exactly 90 seconds', () => {
    expect(isDurationValid(90)).toBe(true);
  });

  it('rejects 91 seconds', () => {
    expect(isDurationValid(91)).toBe(false);
  });

  it('rejects 0 seconds', () => {
    expect(isDurationValid(0)).toBe(false);
  });

  it('rejects negative duration', () => {
    expect(isDurationValid(-5)).toBe(false);
  });
});

describe('review item priority ordering', () => {
  interface Item { id: string; priority: number; dueAt: Date }

  function sortByPriority(items: Item[]): Item[] {
    return [...items].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.dueAt.getTime() - b.dueAt.getTime();
    });
  }

  it('lower priority number sorts first (urgent)', () => {
    const items: Item[] = [
      { id: 'b', priority: 100, dueAt: new Date('2026-11-02') },
      { id: 'a', priority: 10, dueAt: new Date('2026-11-02') },
    ];
    const sorted = sortByPriority(items);
    expect(sorted[0].id).toBe('a');
  });

  it('breaks ties by dueAt (earlier first)', () => {
    const items: Item[] = [
      { id: 'b', priority: 100, dueAt: new Date('2026-11-05') },
      { id: 'a', priority: 100, dueAt: new Date('2026-11-03') },
    ];
    const sorted = sortByPriority(items);
    expect(sorted[0].id).toBe('a');
  });
});
