jest.mock('@/repositories', () => ({ storyboardVersionRepository: {
 get: jest.fn(), latest: jest.fn(), append: jest.fn(),
} }));
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/line/storyboard/route';
import { storyboardVersionRepository as repo } from '@/repositories';
import { processLineEvent } from '@/services/line/LineWebhookService';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { MockLineClient } from '@/lib/line/MockLineClient';
const id = '00000000-0000-4000-8000-000000000001';
const old = '00000000-0000-4000-8000-000000000002';
const current = '00000000-0000-4000-8000-000000000003';
beforeEach(() => { jest.clearAllMocks(); process.env.LINE_SCENE_EDIT_ENABLED = 'true'; process.env.REVIEW_ADMIN_TOKEN = 'offline-admin'; });
afterEach(() => { delete process.env.LINE_SCENE_EDIT_ENABLED; delete process.env.REVIEW_ADMIN_TOKEN; });
const req = (token = 'offline-admin', body: unknown = { action: 'restore', requestId: id, versionId: old, expectedVersionId: current }) => new NextRequest('http://localhost/api/admin/line/storyboard', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
test('restore API authenticates and appends old content with current parent', async () => {
 (repo.get as jest.Mock).mockResolvedValue({ id: old, requestId: id, scenes: [{ summary: 'old' }], isTest: true });
 (repo.latest as jest.Mock).mockResolvedValue({ id: current, requestId: id, isTest: true });
 (repo.append as jest.Mock).mockResolvedValue({ id: 'new' });
 expect((await POST(req())).status).toBe(200);
 expect(repo.append).toHaveBeenCalledWith(expect.objectContaining({ parentVersionId: current, scenes: [{ summary: 'old' }], reason: 'restore:' + old, createdBy: 'admin', isTest: true }));
});
test('restore rejects cross-request versions', async () => {
 (repo.get as jest.Mock).mockResolvedValue({ id: old, requestId: 'other', isTest: true });
 (repo.latest as jest.Mock).mockResolvedValue({ id: current, requestId: id, isTest: true });
 expect((await POST(req())).status).toBe(404); expect(repo.append).not.toHaveBeenCalled();
});
test('restore rejects missing/wrong admin token and flag off', async () => {
 expect((await POST(req('wrong'))).status).toBe(401);
 delete process.env.REVIEW_ADMIN_TOKEN; expect((await POST(req())).status).toBe(503);
 process.env.REVIEW_ADMIN_TOKEN = 'offline-admin'; delete process.env.LINE_SCENE_EDIT_ENABLED;
 expect((await POST(req())).status).toBe(503); expect(repo.append).not.toHaveBeenCalled();
});
test('real webhook uses reply token for edit summary; takeover prevents callback', async () => {
 const accounts = new MockLineAccountRepository(new Map()); const client = new MockLineClient();
 const account = await accounts.create({ userId: 'u', lineUserId: 'line', lineChannelId: 'ch', displayName: null, linkedVia: 'auto_created', status: 'active' });
 const sceneEditMessages = jest.fn().mockResolvedValue([{ type: 'text', text: 'สรุปการแก้ไข' }]);
 const event = { type: 'message', message: { type: 'text', text: 'แก้ฉาก 1' }, replyToken: 'reply-token', source: { userId: 'line' } };
 const opts = { lineChannelId: 'ch', lineClient: client, lineAccountRepo: accounts, sceneEditMessages };
 expect((await processLineEvent(event, opts)).intent).toBe('scene_edit');
 expect(client.sent[0]).toEqual(expect.objectContaining({ kind: 'reply', replyToken: 'reply-token' }));
 await accounts.setTakeover(account.id, true, null); sceneEditMessages.mockClear(); client.reset();
 expect((await processLineEvent(event, opts)).intent).toBe('takeover'); expect(sceneEditMessages).not.toHaveBeenCalled(); expect(client.sent).toHaveLength(0);
});
test('real webhook does not invoke edit path with flag off', async () => {
 delete process.env.LINE_SCENE_EDIT_ENABLED;
 const sceneEditMessages = jest.fn();
 await processLineEvent({ type: 'message', message: { type: 'text', text: 'hello' }, replyToken: 'r', source: { userId: 'l' } }, { lineChannelId: 'c', lineClient: new MockLineClient(), lineAccountRepo: new MockLineAccountRepository(new Map()), sceneEditMessages });
 expect(sceneEditMessages).not.toHaveBeenCalled();
});
