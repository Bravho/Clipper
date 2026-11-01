import { processLineEvent, ProcessWebhookOptions } from '@/services/line/LineWebhookService';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { PostgresLineAccountRepository } from '@/repositories/postgres/PostgresLineAccountRepository';
import { LineMessage } from '@/lib/line/ILineClient';
import { lineRequestStatus } from '@/services/line/lineRequestStatus';
jest.mock('@/lib/line/lineStorage', () => ({ uploadLineAsset: jest.fn(async () => {}) }));
jest.mock('@/lib/db', () => ({ pool: {} }));
const media = (id: string) => ({ type: 'message', source: { userId: 'u' }, replyToken: id, message: { type: 'video', id } });
const text = (value: string) => ({ type: 'message', source: { userId: 'u' }, replyToken: 'text', message: { type: 'text', text: value } });
function setup() {
  const repo = new MockLineAccountRepository(new Map(), new Map());
  const reply = jest.fn(async (_token: string, _messages: LineMessage[]) => {});
  const opts: ProcessWebhookOptions = { lineChannelId: 'c', lineAccountRepo: repo, lineClient: { reply, push: jest.fn() } };
  return { repo, reply, opts };
}
test('three concurrent uploads produce one total summary and confirm waits for every file', async () => {
  const { repo, reply, opts } = setup();
  await repo.upsertConversationState('c','u','awaiting_files',{ intakeId: 'draft' });
  const releases: (() => void)[] = [];
  opts.fetchMediaContent = async () => { await new Promise<void>(resolve => releases.push(resolve)); return { buffer: Buffer.from('video'), contentType: 'video/mp4' }; };
  opts.submitClipRequest = jest.fn(async () => ({ requestId: 'request' }));
  const uploads = ['1','2','3'].map(id => processLineEvent(media(id), opts));
  while (releases.length < 3) await new Promise(resolve => setTimeout(resolve, 0));
  const confirm = processLineEvent(text('ยืนยัน'), opts);
  releases[0](); releases[1]();
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(reply).not.toHaveBeenCalled(); expect(opts.submitClipRequest).not.toHaveBeenCalled();
  releases[2](); await Promise.all(uploads); await confirm;
  expect(reply.mock.calls.filter(call => call[0] !== 'text')).toHaveLength(1);
  expect(reply.mock.calls[0][1][0]).toEqual(expect.objectContaining({ text: expect.stringContaining('(3 ไฟล์)') }));
  expect(opts.submitClipRequest).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ files: ['1','2','3'].map(id => ({ storageKey: `line_uploads/c/u/${id}.mp4`, fileSizeBytes: 5 })) }) }));
  await processLineEvent(media('4'),opts);
  expect(releases).toHaveLength(3);
  expect(reply.mock.calls.at(-1)?.[1][0]).toEqual(expect.objectContaining({ text: expect.stringContaining('ส่งงานแล้ว') }));
});
test('pending uploads time out without submission', async () => {
  jest.useFakeTimers();
  try {
    const { repo, opts, reply } = setup();
    await repo.upsertConversationState('c','u','awaiting_files',{ pendingUploads: 1 });
    opts.submitClipRequest = jest.fn();
    const result = processLineEvent(text('ยืนยัน'),opts);
    await jest.advanceTimersByTimeAsync(26000);
    expect((await result).intent).toBe('uploads_pending');
    expect(opts.submitClipRequest).not.toHaveBeenCalled();
    expect(reply.mock.calls[0][1][0]).toEqual(expect.objectContaining({ text: expect.stringContaining('อีกครั้ง') }));
  } finally { jest.useRealTimers(); }
});
test('atomic cap, deduplication, nonnegative pending count and submission claim', async () => {
  const { repo } = setup();
  await repo.upsertConversationState('c','u','awaiting_files',{});
  await Promise.all(Array.from({ length: 22 }, () => repo.beginUpload('c','u')));
  await Promise.all(Array.from({ length: 22 }, (_, i) => repo.finishUpload('c','u',{ storageKey: String(i), fileSizeBytes: i })));
  expect(await repo.finishUpload('c','u',{ storageKey: '0', fileSizeBytes: 1 })).toEqual({ count: 20, pending: 0 });
  const claims = await Promise.all([repo.claimSubmission('c','u'),repo.claimSubmission('c','u')]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(await repo.beginUpload('c','u')).toBe(false);
  expect(await repo.finishUpload('c','u')).toBeNull();
});
test('failed download releases its pending slot', async () => {
  const { repo, opts } = setup();
  await repo.upsertConversationState('c','u','awaiting_files',{});
  opts.fetchMediaContent = async () => { throw new Error('download failed'); };
  const log = jest.spyOn(console,'error').mockImplementation(() => {});
  try { expect((await processLineEvent(media('bad'),opts)).intent).toBe('file_error'); }
  finally { log.mockRestore(); }
  expect((await repo.getConversationState('c','u'))?.context.pendingUploads).toBe(0);
});
test('Postgres append uses one guarded atomic UPDATE with SQL cap', async () => {
  const query = jest.fn(async () => ({ rows: [{ count: 3, pending: 0 }] }));
  const repo = new PostgresLineAccountRepository({ query } as never);
  expect(await repo.finishUpload('c','u',{ storageKey: 'key', fileSizeBytes: 5 })).toEqual({ count: 3, pending: 0 });
  expect(query).toHaveBeenCalledTimes(1);
  const sql = query.mock.calls[0] as unknown as [string];
  expect(sql[0]).toContain('jsonb_set'); expect(sql[0]).toContain('< 20');
  expect(sql[0]).toContain("state='awaiting_files'"); expect(sql[0]).toContain('GREATEST(0');
});
test('status falls back to real job text when no review exists', async () => {
  const { repo, opts, reply } = setup();
  await repo.upsertConversationState('c','u','in_progress',{ requestId: 'request' });
  opts.reviewMessages = async () => [];
  opts.requestStatus = jest.fn(async () => lineRequestStatus('editing',{ currentStep: 'failed', status: 'failed' }));
  await processLineEvent(text('สถานะ'),opts);
  expect(opts.requestStatus).toHaveBeenCalledWith('request','u');
  expect(reply.mock.calls[0][1][0]).toEqual(expect.objectContaining({ text: expect.stringContaining('ทีมงานจะตรวจสอบและติดต่อกลับ') }));
});
test.each([
  ['submitted',null,'ได้รับงาน'], ['under_review',null,'ตรวจสอบรายละเอียด'],
  ['editing','analyzing_content','วิเคราะห์'], ['editing','awaiting_content_approval','อนุมัติ'],
  ['editing','generating_base_video','เรนเดอร์'], ['delivered','complete','ส่งมอบ'],
  ['editing','generating_voice','เสียงพากย์'], ['on_hold',null,'พัก'],
  ['rejected',null,'ไม่ผ่าน'], ['scheduled_for_publishing','publishing','เผยแพร่'],
])('maps %s/%s to Thai status', (status,step,expected) => {
  expect(lineRequestStatus(status!,step ? { currentStep: step, status: 'processing' } : null)).toContain(expected);
});

test.each([['ใช่',true],['ไม่',false],['ไม่ใช่',false],['ok',true],['โอเค',true]])('accepts preference %s', async (answer,expected) => {
  const { repo, opts } = setup();
  await repo.upsertConversationState('c','u','awaiting_storyboard_preference',{});
  await processLineEvent(text(String(answer)),opts);
  expect((await repo.getConversationState('c','u'))?.context.reviewStoryboard).toBe(expected);
});
