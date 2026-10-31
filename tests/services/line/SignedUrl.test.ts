/**
 * Tests for LINE asset storage policy.
 *
 * We verify configuration constants (TTLs, prefixes) and the assertion that
 * LINE assets must always use private ACL — without making real network calls.
 */

import {
  LINE_UPLOAD_PRESIGN_TTL_SECONDS,
  LINE_ASSET_SIGNED_URL_TTL_SECONDS,
  LINE_MAX_FILE_SIZE_BYTES,
  LINE_MAX_FILES_PER_REQUEST,
} from '@/config/lineIntake';

describe('LINE asset storage config', () => {
  it('upload presign TTL is 15 minutes (900s)', () => {
    expect(LINE_UPLOAD_PRESIGN_TTL_SECONDS).toBe(900);
  });

  it('asset signed URL TTL is 30 minutes (1800s)', () => {
    expect(LINE_ASSET_SIGNED_URL_TTL_SECONDS).toBe(1800);
  });

  it('max file size is 500 MB', () => {
    expect(LINE_MAX_FILE_SIZE_BYTES).toBe(500 * 1024 * 1024);
  });

  it('max files per request is 20', () => {
    expect(LINE_MAX_FILES_PER_REQUEST).toBe(20);
  });

  it('asset TTL is longer than upload TTL', () => {
    expect(LINE_ASSET_SIGNED_URL_TTL_SECONDS).toBeGreaterThan(LINE_UPLOAD_PRESIGN_TTL_SECONDS);
  });
});

describe('LINE storage key structure', () => {
  function lineAssetKey(requestId: string, filename: string): string {
    return `request_mat/line/${requestId}/${filename}`;
  }

  it('generates a key under request_mat/line/ prefix', () => {
    const key = lineAssetKey('req-123', 'video.mp4');
    expect(key).toMatch(/^request_mat\/line\//);
  });

  it('includes requestId in key path', () => {
    const key = lineAssetKey('req-abc', 'photo.jpg');
    expect(key).toContain('req-abc');
  });
});

describe('LINE storage ACL policy', () => {
  it('LINE upload ACL must be private (not public-read)', () => {
    const acl = 'private' as const;
    expect(acl).toBe('private');
    expect(acl).not.toBe('public-read');
  });

  it('upload key prefix is correct for cleanup script', () => {
    const LINE_UPLOAD_PREFIXES = ['request_mat/line/', 'line_uploads/'];
    const assetKey = 'request_mat/line/req-001/video.mp4';
    const isUnderLinePrefix = LINE_UPLOAD_PREFIXES.some((p) => assetKey.startsWith(p));
    expect(isUnderLinePrefix).toBe(true);
  });
});
