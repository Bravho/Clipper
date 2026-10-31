import { processLineEvent } from '@/services/line/LineWebhookService';
import { LineIntakeService } from '@/services/line/LineIntakeService';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { MockUserRepository } from '@/repositories/mock/MockUserRepository';
import { MockServicePackageRepository } from '@/repositories/mock/MockServicePackageRepository';
import { MockClipRequestRepository } from '@/repositories/mock/MockClipRequestRepository';
import { MockUploadedAssetRepository } from '@/repositories/mock/MockUploadedAssetRepository';
jest.mock('@/lib/line/lineStorage', () => ({ uploadLineAsset: jest.fn() }));
import { uploadLineAsset } from '@/lib/line/lineStorage';
import { RequestStatus } from '@/domain/enums/RequestStatus';

test('real state machine blocks unpaid checkout, collects preferences and privately stores media', async () => {
  const accounts = new MockLineAccountRepository();
  const packages = new MockServicePackageRepository();
  const requests = new MockClipRequestRepository(new Map());
  const intake = new LineIntakeService('c', accounts, new MockUserRepository(new Map()), packages,
    requests, new MockUploadedAssetRepository(new Map()));
  const reply = jest.fn();
  const push = jest.fn();
  const escalation = jest.fn();
  const opts = { lineChannelId: 'c', lineAccountRepo: accounts, lineClient: { reply, push },
    choosePackage: (user: string, code: string) => intake.choosePackage(user, code),
    isPaid: (order: string, user: string) => intake.isPaid(order, user),
    submitClipRequest: ({ lineUserId, context }: { lineUserId: string; context: Record<string, unknown> }) => intake.submit(lineUserId, context),
    fetchMediaContent: async () => ({ buffer: Buffer.from('image'), contentType: 'image/jpeg' }),
    createReviewItem: escalation };
  const send = (text: string) => processLineEvent({ type: 'message', source: { userId: 'u' }, replyToken: 'r', message: { type: 'text', text } }, opts);
  await accounts.upsertConversationState('c','u','awaiting_package_choice', { intakeId: 'intake-1' });
  await send('Trial');
  const state = await accounts.getConversationState('c','u');
  expect(reply.mock.calls.at(-1)?.[1][0].text).toContain('client_reference_id=');
  expect((await send('continue')).intent).toBe('payment_pending');
  await packages.updateOrderStatus(String(state!.context.orderId), 'active');
  await send('continue');
  await send('A restaurant serving noodles');
  await send('yes'); await send('no');
  await processLineEvent({ type: 'message', source: { userId: 'u' }, replyToken: 'r', message: { type: 'image', id: 'm' } }, opts);
  expect(uploadLineAsset).toHaveBeenCalledWith(expect.objectContaining({ key: 'line_uploads/c/u/m.jpg' }));
  expect((await send('ok')).intent).toBe('job_submitted');
  const account = await accounts.findByLineUser('c','u');
  const [request] = await requests.findByUserId(account!.userId);
  expect(request.status).toBe(RequestStatus.Submitted);
  expect(request.intakeChannel).toBe('line');
  expect(push).not.toHaveBeenCalled();
  await send('human');
  expect(escalation).toHaveBeenCalledWith(expect.objectContaining({ intent: 'wants_human' }));
});
