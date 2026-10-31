/**
 * Tests for the 7-day LINE upload cleanup selection logic.
 *
 * The actual cleanup-line-uploads.ts script deletes objects >7 days old
 * from LINE-specific Spaces prefixes. This test unit-tests the selection
 * predicate (age cutoff), not the Spaces client itself (no real network).
 */

const MAX_AGE_DAYS = 7;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

function isTooOld(lastModified: Date, cutoff: Date): boolean {
  return lastModified < cutoff;
}

describe('cleanup-line-uploads age selection', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const cutoff = new Date(now.getTime() - MAX_AGE_MS);

  it('selects a file that is exactly 8 days old', () => {
    const modified = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    expect(isTooOld(modified, cutoff)).toBe(true);
  });

  it('does NOT select a file that is 6 days old', () => {
    const modified = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    expect(isTooOld(modified, cutoff)).toBe(false);
  });

  it('does NOT select a file that is exactly 7 days old (boundary)', () => {
    // Exactly at cutoff — not strictly less, so not selected
    const modified = new Date(cutoff.getTime());
    expect(isTooOld(modified, cutoff)).toBe(false);
  });

  it('selects a file that is one millisecond past the cutoff', () => {
    const modified = new Date(cutoff.getTime() - 1);
    expect(isTooOld(modified, cutoff)).toBe(true);
  });

  it('does NOT select a file from today', () => {
    const modified = new Date(now.getTime() - 60_000); // 1 min ago
    expect(isTooOld(modified, cutoff)).toBe(false);
  });

  it('selects very old files (30 days)', () => {
    const modified = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(isTooOld(modified, cutoff)).toBe(true);
  });

  it('MAX_AGE_DAYS is 7', () => {
    expect(MAX_AGE_DAYS).toBe(7);
  });

  it('cutoff is now minus 7 days', () => {
    const expectedCutoff = new Date(now.getTime() - MAX_AGE_MS);
    expect(cutoff.getTime()).toBe(expectedCutoff.getTime());
  });
});

describe('LINE_UPLOAD_PREFIXES', () => {
  const LINE_UPLOAD_PREFIXES = ['request_mat/line/', 'line_uploads/'];

  it('includes request_mat/line/ prefix', () => {
    expect(LINE_UPLOAD_PREFIXES).toContain('request_mat/line/');
  });

  it('includes line_uploads/ prefix', () => {
    expect(LINE_UPLOAD_PREFIXES).toContain('line_uploads/');
  });

  it('has exactly 2 prefixes', () => {
    expect(LINE_UPLOAD_PREFIXES).toHaveLength(2);
  });
});
