import { LineIntakeService } from '@/services/line/LineIntakeService';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { MockUserRepository } from '@/repositories/mock/MockUserRepository';
import { MockServicePackageRepository } from '@/repositories/mock/MockServicePackageRepository';
import { MockClipRequestRepository } from '@/repositories/mock/MockClipRequestRepository';
import { MockUploadedAssetRepository } from '@/repositories/mock/MockUploadedAssetRepository';
const enqueue = jest.fn(async () => {});
jest.mock('@/repositories', () => ({ assetVisualAnalysisRepository: { enqueue: (...args: unknown[]) => enqueue(...args as []) } }));
const original = process.env;
afterEach(() => { process.env = original; });
test.each([true,false])('LINE asset registration queues once only when visual flags enabled=%s', async enabled => {
  process.env = { ...original,STORYBOARD_AI_PRECHECK_ENABLED: 'true',STORYBOARD_VISUAL_PRECHECK_ENABLED: String(enabled) }; enqueue.mockClear();
  const accounts = new MockLineAccountRepository(new Map());
  const packages = new MockServicePackageRepository();
  const requests = new MockClipRequestRepository(new Map()), assets = new MockUploadedAssetRepository(new Map());
  const intake = new LineIntakeService('c',accounts,new MockUserRepository(new Map()),packages,requests,assets);
  const choice = await intake.choosePackage('u','trial');
  await packages.updateOrderStatus(choice.orderId,'active');
  const context = { intakeId: 'visual-intake',orderId: choice.orderId,files: ['line_uploads/c/u/photo.jpg'],brief: 'product' };
  const submitted = await intake.submit('u',context); await intake.submit('u',context);
  const saved = await assets.findByRequestId(submitted.requestId);
  expect(saved).toHaveLength(1);
  if (enabled) { expect(enqueue).toHaveBeenCalledTimes(1); expect(enqueue).toHaveBeenCalledWith(saved[0].id,'1'); }
  else expect(enqueue).not.toHaveBeenCalled();
});
