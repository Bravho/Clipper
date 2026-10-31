jest.mock('@/lib/spaces', () => ({ spacesUpload: jest.fn(), spacesSignedUrl: jest.fn(async () => 'signed'), spacesClient: {}, SPACES_BUCKET: 'private-bucket' }));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn(async () => 'put-signed') }));
import { uploadLineAsset, getLineAssetSignedUrl, generateLineUploadPutUrl } from '@/lib/line/lineStorage';
import { spacesUpload, spacesSignedUrl } from '@/lib/spaces';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
test('real LINE storage helper sends private ACL and signs GET with expiry', async () => {
  await uploadLineAsset({ key: 'line_uploads/a', body: Buffer.from('x'), contentType: 'image/jpeg' });
  expect(spacesUpload).toHaveBeenCalledWith(expect.objectContaining({ acl: 'private' }));
  expect(await getLineAssetSignedUrl('line_uploads/a')).toBe('signed');
  expect(spacesSignedUrl).toHaveBeenCalledWith('line_uploads/a', 1800);
  await generateLineUploadPutUrl({ key: 'line_uploads/a', contentType: 'image/jpeg' });
  const call = (getSignedUrl as jest.Mock).mock.calls[0];
  expect(call[1].input).toMatchObject({ ACL: 'private', Key: 'line_uploads/a' });
  expect(call[2]).toEqual({ expiresIn: 900 });
});
