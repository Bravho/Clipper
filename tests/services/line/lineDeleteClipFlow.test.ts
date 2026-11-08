import { runDeleteClipStep, isDeleteClipText, DELETE_CONFIRM_STATE } from '@/services/line/lineDeleteClipFlow';

function deps(clips: string[] = ['c1']) {
  const removed: string[] = [];
  return {
    removed,
    deps: {
      listClips: jest.fn(async () => clips.map((id) => ({ id }))),
      removeClip: jest.fn(async (_r: string, id: string) => {
        removed.push(id);
      }),
    },
  };
}
const ctx = { requestId: 'req-1' };

describe('isDeleteClipText', () => {
  it('recognises a request to delete a clip', () => {
    expect(isDeleteClipText('ลบคลิปเก่า')).toBe(true);
    expect(isDeleteClipText('ลบวิดีโอนี้')).toBe(true);
  });
  it('does not treat a confirmation as a new delete request', () => {
    expect(isDeleteClipText('ยืนยันลบ')).toBe(false);
    expect(isDeleteClipText('ยืนยันลบคลิป')).toBe(false);
  });
  it('ignores unrelated text', () => {
    expect(isDeleteClipText('เริ่มงาน')).toBe(false);
  });
});

describe('first request asks for confirmation and deletes nothing', () => {
  it('asks, stores the clip ids, and deletes nothing', async () => {
    const d = deps(['c1', 'c2']);
    const step = await runDeleteClipStep({ text: 'ลบคลิปเก่า', state: 'in_progress', context: ctx, deps: d.deps });
    expect(step).toMatchObject({ handled: true, nextState: DELETE_CONFIRM_STATE });
    expect((step as { reply: string }).reply).toMatch(/ยืนยันลบ/);
    expect((step as { nextContext: Record<string, unknown> }).nextContext.pendingDeleteIds).toEqual(['c1', 'c2']);
    expect(d.removed).toEqual([]);
  });

  it('with no request yet: says so, deletes nothing', async () => {
    const d = deps();
    const step = await runDeleteClipStep({ text: 'ลบคลิปเก่า', state: 'idle', context: {}, deps: d.deps });
    expect(step).toMatchObject({ handled: true, nextState: 'idle' });
    expect(d.removed).toEqual([]);
  });

  it('with no clips: says so, deletes nothing', async () => {
    const d = deps([]);
    const step = await runDeleteClipStep({ text: 'ลบคลิปเก่า', state: 'in_progress', context: ctx, deps: d.deps });
    expect((step as { reply: string }).reply).toMatch(/ไม่มีคลิป/);
    expect(d.removed).toEqual([]);
  });
});

describe('old clip links in the confirmation question', () => {
  it('sends each clip link so the shop can check it before confirming', async () => {
    const d = deps();
    d.deps.listClips = jest.fn(async () => [
      { id: 'c1', url: 'https://example.test/c1' },
      { id: 'c2', url: 'https://example.test/c2' },
    ]);
    const step = await runDeleteClipStep({ text: 'ลบคลิปเก่า', state: 'in_progress', context: ctx, deps: d.deps });
    const reply = (step as { reply: string }).reply;
    expect(reply).toContain('https://example.test/c1');
    expect(reply).toContain('https://example.test/c2');
    expect(reply).toMatch(/ยืนยันลบ/);
    expect(d.removed).toEqual([]);
  });

  it('still asks when a link cannot be made, and says so', async () => {
    const d = deps();
    d.deps.listClips = jest.fn(async () => [{ id: 'c1' }]);
    const step = await runDeleteClipStep({ text: 'ลบคลิปเก่า', state: 'in_progress', context: ctx, deps: d.deps });
    expect((step as { reply: string }).reply).toMatch(/เปิดดูลิงก์ไม่ได้/);
    expect(d.removed).toEqual([]);
  });
});

describe('confirmation', () => {
  const pending = { ...ctx, previousState: 'in_progress', pendingDeleteIds: ['c1', 'c2'] };

  it('"ยืนยันลบ" deletes exactly the pending clips and returns to the previous step', async () => {
    const d = deps();
    const step = await runDeleteClipStep({ text: 'ยืนยันลบ', state: DELETE_CONFIRM_STATE, context: pending, deps: d.deps });
    expect(d.removed).toEqual(['c1', 'c2']);
    expect(step).toMatchObject({ handled: true, nextState: 'in_progress' });
    expect((step as { nextContext: Record<string, unknown> }).nextContext.pendingDeleteIds).toBeUndefined();
  });

  it('"ยกเลิก" deletes nothing and returns to the previous step', async () => {
    const d = deps();
    const step = await runDeleteClipStep({ text: 'ยกเลิก', state: DELETE_CONFIRM_STATE, context: pending, deps: d.deps });
    expect(d.removed).toEqual([]);
    expect(step).toMatchObject({ handled: true, nextState: 'in_progress' });
  });

  it('any other reply keeps waiting and deletes nothing', async () => {
    const d = deps();
    const step = await runDeleteClipStep({ text: 'ok ลบเลย', state: DELETE_CONFIRM_STATE, context: pending, deps: d.deps });
    expect(d.removed).toEqual([]);
    expect(step).toMatchObject({ handled: true, nextState: DELETE_CONFIRM_STATE });
  });

  it('a failed removal is reported, keeps the confirmation waiting, and is not reported as done', async () => {
    const d = deps();
    d.deps.removeClip = jest.fn(async (_r: string, _id: string) => {
      throw new Error('db down');
    });
    const step = await runDeleteClipStep({ text: 'ยืนยันลบ', state: DELETE_CONFIRM_STATE, context: pending, deps: d.deps });
    expect((step as { reply: string }).reply).toMatch(/ไม่สำเร็จ/);
    expect((step as { nextState: string }).nextState).toBe(DELETE_CONFIRM_STATE);
  });

  it('unrelated messages outside the confirmation are not handled here', async () => {
    const d = deps();
    expect(await runDeleteClipStep({ text: 'เริ่มงาน', state: 'in_progress', context: ctx, deps: d.deps })).toEqual({ handled: false });
  });
});
