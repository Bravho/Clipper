import { SignJWT } from 'jose';
jest.mock('@/lib/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('@/repositories', () => ({ reviewItemRepository: { findById: jest.fn() } }));
import { pool } from '@/lib/db';
import { reviewItemRepository } from '@/repositories';
import { issuePreviewToken, validatePreview } from '@/lib/review/previewToken';
beforeEach(() => {
  process.env.REVIEW_PREVIEW_JWT_SECRET = 'test-secret';
  (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  (reviewItemRepository.findById as jest.Mock).mockResolvedValue({ id: 'i', version: 1, typeKey: 'script', status: 'pending',
    expiresAt: new Date(Date.now()+86400000), assetRefs: [{ asset_id: 'a', storage_key: 'owned' }] });
});
test('issuance produces an expiring, item/version-bound token', async () => {
  const token = await issuePreviewToken({ itemId: 'i', version: 1, typeKey: 'script' });
  expect((await validatePreview(token)).item.id).toBe('i');
});
test('rejects tokens without exp, revoked tokens, stale versions and unrelated assets', async () => {
  const missing = await new SignJWT({ item_id:'i',version:1,type_key:'script',jti:'j' }).setProtectedHeader({ alg:'HS256' })
    .sign(new TextEncoder().encode('test-secret'));
  await expect(validatePreview(missing)).rejects.toThrow();
  const token = await issuePreviewToken({ itemId:'i',version:1,typeKey:'script' });
  (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{}] });
  await expect(validatePreview(token)).rejects.toThrow('revoked');
  await expect(validatePreview(await issuePreviewToken({ itemId:'i',version:2,typeKey:'script' }))).rejects.toThrow('invalid_preview');
  await expect(validatePreview(await issuePreviewToken({ itemId:'i',version:1,typeKey:'script',storageKey:'other' }))).rejects.toThrow('asset_mismatch');
  (pool.query as jest.Mock).mockRejectedValueOnce(new Error('database unavailable'));
  await expect(validatePreview(token)).rejects.toThrow('database unavailable');
});
