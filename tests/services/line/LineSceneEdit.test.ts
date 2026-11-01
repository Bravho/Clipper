import { LineSceneEditService, applySceneEdit, buildSceneEditPrompt, editParseConfig, type PendingSceneEdit } from '@/services/line/LineSceneEditService';
import { MockStoryboardVersionRepository } from '@/repositories/mock/MockStoryboardVersionRepository';
import type { StoryboardVersion } from '@/domain/models/StoryboardVersion';
const asset = '00000000-0000-4000-8000-000000000001';
jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn(() => { throw new Error('Real Gemini prohibited'); }) }));
const edit = { ops: [{ type: 'timing', scene: 1, newDurationSec: 8 }] };
describe('post-delivery scene edits (offline)', () => {
 let repo: MockStoryboardVersionRepository;
 let base: StoryboardVersion;
 let pending: PendingSceneEdit | undefined;
 let parse: jest.Mock; let dispatch: jest.Mock; let escalate: jest.Mock;
 let service: LineSceneEditService;
 beforeEach(async () => {
  process.env.LINE_SCENE_EDIT_ENABLED = 'true'; repo = new MockStoryboardVersionRepository(new Map());
  base = await repo.append({ requestId: 'request', parentVersionId: null, scenes: [{ sceneNumber: 1, summary: 'ร้านอาหาร', assetIndexes: [0], assetIds: [asset], roughDurationHint: 5, onScreenText: 'ยินดีต้อนรับ', voiceScript: 'เชิญแวะมาลอง', visualCrop: { x: 0, y: 0, w: 1, h: 1, zoom: 1, pad: false } }], createdBy: 'system', reason: 'approved', isTest: true });
  pending = undefined; parse = jest.fn().mockResolvedValue(edit); dispatch = jest.fn(); escalate = jest.fn();
  service = new LineSceneEditService({ versions: repo, parse, dispatch, escalate, savePending: async p => { pending = p ?? undefined; } });
 });
 afterEach(() => { delete process.env.LINE_SCENE_EDIT_ENABLED; });
 const input = () => ({ base, assets: [asset], rules: {}, message: 'ปรับฉาก 1 เป็น 8 วินาที', pending });
 it('parse -> Thai summary/quick replies -> confirm -> immutable version + full-render dispatch + one revision', async () => {
  const messages = await service.handle(input());
  expect(messages[0].text).toContain('ฉาก 1'); expect(messages[0].quickReply?.items).toHaveLength(2);
  expect(parse).toHaveBeenCalledTimes(1); expect(dispatch).not.toHaveBeenCalled();
  await service.handle({ ...input(), message: 'ยืนยันแก้ไข' });
  const next = (await repo.latest('request'))!;
  expect(next.parentVersionId).toBe(base.id); expect(next.scenes[0].roughDurationHint).toBe(8);
  expect(next.scenes[0].visualCrop).toEqual(base.scenes[0].visualCrop);
  expect((await repo.get(base.id))?.scenes[0].roughDurationHint).toBe(5);
  expect(repo.revisions.get('request')).toBe(1); expect(dispatch).toHaveBeenCalledWith(next);
 });
 it('cancel clears proposal without render or revision', async () => {
  await service.handle(input()); await service.handle({ ...input(), message: 'ยกเลิก' });
  expect(pending).toBeUndefined(); expect(dispatch).not.toHaveBeenCalled(); expect(repo.revisions.size).toBe(0);
 });
 it.each([{ ops: [{ type: 'timing', scene: 9, newDurationSec: 8 }] }, { ops: [{ type: 'asset', scene: 1, assetId: '00000000-0000-4000-8000-000000000002' }] }, { ops: [{ type: 'reorder', order: [1,1] }] }, { ops: [{ type: 'text', scene: 1, field: 'price', newText: '1' }] }])('rejects invalid operations and asks to clarify: %j', async raw => {
  parse.mockResolvedValue(raw); const messages = await service.handle(input()); expect(messages[0].text).toContain('ชัดเจน'); expect(pending).toBeUndefined();
 });
 it('fixed menu/price edits route to Tho, never auto apply', async () => {
  await service.handle({ ...input(), message: 'แก้ราคาเมนูข้าวเป็น 99 บาท', rules: { menuNames: ['ข้าว'], menuPrices: { ข้าว: 50 } } });
  await service.handle({ ...input(), message: 'ยืนยัน' });
  expect(escalate).toHaveBeenCalledWith('shop_facts', expect.any(Object)); expect(dispatch).not.toHaveBeenCalled(); expect(repo.revisions.size).toBe(0);
 });
 it('exhausted revisions require new package/approval and escalation', async () => {
  repo.revisions.set('request', 2); await service.handle(input());
  const messages = await service.handle({ ...input(), message: 'ยืนยัน' });
  expect(messages[0].text).toContain('แพ็กเกจใหม่'); expect(escalate).toHaveBeenCalledWith('revisions_exhausted'); expect(dispatch).not.toHaveBeenCalled();
 });
 it('takeover is silent without parsing or processing', async () => {
  expect(await service.handle({ ...input(), takeover: true })).toEqual([]); expect(parse).not.toHaveBeenCalled();
 });
 it('flag off does nothing', async () => {
  delete process.env.LINE_SCENE_EDIT_ENABLED; expect(await service.handle(input())).toEqual([]); expect(parse).not.toHaveBeenCalled();
 });
 it('restore appends a copy with current parent and keeps old versions', async () => {
  await service.handle(input()); await service.handle({ ...input(), message: 'ยืนยัน' });
  const current = (await repo.latest('request'))!; const restored = await service.restore(current, base.id);
  expect(restored.scenes).toEqual(base.scenes); expect(restored.id).not.toBe(base.id); expect(restored.parentVersionId).toBe(current.id);
  expect(repo.revisions.get('request')).toBe(1); expect(await repo.get(current.id)).not.toBeNull();
 });
 it('stale/concurrent confirmation cannot consume twice', async () => {
  await service.handle(input()); const confirm = { ...input(), message: 'ยืนยัน' };
  const results = await Promise.allSettled([service.handle(confirm), service.handle(confirm)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(repo.revisions.get('request')).toBe(1);
 });
 it('supports text, swap and reorder while preserving scene identities', () => {
  const b = { ...base, scenes: [...base.scenes, { ...base.scenes[0], sceneNumber: 2 }] };
  const result = applySceneEdit(b, { ops: [{ type: 'text', scene: 1, field: 'voiceScript', newText: 'ลองเลย' }, { type: 'asset', scene: 2, assetId: asset }, { type: 'reorder', order: [2,1] }] }, [asset]);
  expect(result.map(s => s.sceneNumber)).toEqual([2,1]); expect(result[1].voiceScript).toBe('ลองเลย');
 });
 it('prints REAL prompt token estimate without AI or network', () => {
  require('../../../scripts/storyboard-precheck-estimate');
  const sample = { ...base, scenes: Array.from({ length: 8 }, (_, i) => ({ ...base.scenes[0], sceneNumber: i+1, summary: 'ภาพอาหารทะเลสดใหม่พร้อมเสิร์ฟที่ร้าน', onScreenText: 'บุฟเฟต์อาหารทะเล 599 บาท', voiceScript: 'เชิญชิมกุ้งเผา ปูนึ่ง และอาหารทะเลสดใหม่ทุกวัน', roughDurationHint: 7 })) };
  const prompt = buildSceneEditPrompt(sample, 'ช่วยเพิ่มเวลาฉาก 2 เป็น 9 วินาที และสลับฉาก 3 กับฉาก 4', [asset]);
  console.log(`LINE edit parse REAL prompt: chars=${prompt.length}; estimated input tokens=${Math.ceil(prompt.length/2.5)} (chars/2.5 Thai-heavy heuristic); max output tokens=${editParseConfig().maxOutputTokens}`);
  expect(prompt).toContain(sample.scenes[0].voiceScript); expect(parse).not.toHaveBeenCalled();
 });
});
