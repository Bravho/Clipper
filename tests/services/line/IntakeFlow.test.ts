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
import { ReviewService, getDefaultTypeCfg } from '@/services/review/ReviewService';
import { MockReviewItemRepository } from '@/repositories/mock/MockReviewItemRepository';
import { MockReviewActionRepository } from '@/repositories/mock/MockReviewActionRepository';
import { MockEscalationRuleRepository } from '@/repositories/mock/MockEscalationRuleRepository';
import { MockReviewOutboxRepository } from '@/repositories/mock/MockReviewOutboxRepository';

test('real state machine blocks unpaid checkout, collects preferences and privately stores media', async () => {
  const accounts = new MockLineAccountRepository();
  const packages = new MockServicePackageRepository();
  const requests = new MockClipRequestRepository(new Map());
  const assets = new MockUploadedAssetRepository(new Map());
  const intake = new LineIntakeService('c', accounts, new MockUserRepository(new Map()), packages,
    requests, assets);
  const reply = jest.fn();
  const push = jest.fn();
  process.env.REVIEW_SYSTEM_ENABLED = 'true';
  const reviews = new MockReviewItemRepository(new Map());
  const reviewService = new ReviewService(reviews, new MockReviewActionRepository(new Map()),
    new MockEscalationRuleRepository(new Map()), new MockReviewOutboxRepository(new Map()));
  const escalation = jest.fn(async (input: { text: string; intent: string }) => {
    await reviewService.createItem({ typeKey: 'customer_reply', shopUserId: 'u', title: input.intent,
      payload: { text: input.text }, signals: {}, typeCfg: getDefaultTypeCfg('customer_reply') });
  });
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
  expect(reply.mock.calls.at(-1)?.[1][0].text).toBe('ต้องการตรวจสอบร่างโครงวิดีโอก่อนการตัดต่อจริงหรือไม่? yes / no');
  await send('โอเค');
  expect(reply.mock.calls.at(-1)?.[1][0].text).toBe('ต้องการตรวจสอบเสียงพากย์ก่อนการตัดต่อจริงหรือไม่? yes / no');
  await send('ไม่ใช่');
  await processLineEvent({ type: 'message', source: { userId: 'u' }, replyToken: 'r', message: { type: 'image', id: 'm' } }, opts);
  expect(uploadLineAsset).toHaveBeenCalledWith(expect.objectContaining({ key: 'line_uploads/c/u/m.jpg' }));
  await processLineEvent({ type: 'message', source: { userId: 'u' }, replyToken: 'r2', message: { type: 'video', id: 'm2' } }, opts);
  expect((await send('ok')).intent).toBe('job_submitted');
  const account = await accounts.findByLineUser('c','u');
  const [request] = await requests.findByUserId(account!.userId);
  expect(await assets.findByRequestId(request.id)).toEqual([expect.objectContaining({ storageKey: 'line_uploads/c/u/m.jpg', storageUrl: 'line_uploads/c/u/m.jpg', fileSizeBytes: 5 }), expect.objectContaining({ storageKey: 'line_uploads/c/u/m2.mp4', storageUrl: 'line_uploads/c/u/m2.mp4', fileSizeBytes: 5 })]);
  expect(request.status).toBe(RequestStatus.Submitted);
  expect(request.intakeChannel).toBe('line');
  expect(push).not.toHaveBeenCalled();
  await send('human');
  expect(escalation).toHaveBeenCalledWith(expect.objectContaining({ intent: 'wants_human' }));
  expect(await reviews.listPending()).toHaveLength(1);
});
