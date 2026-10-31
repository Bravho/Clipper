import { spacesSignedUrl } from '@/lib/spaces';
import { validatePreview } from '@/lib/review/previewToken';
import { createReviewService } from '@/repositories';
import { redirect } from 'next/navigation';
import { issuePreviewToken } from '@/lib/review/previewToken';
import { executeReviewDecision } from '@/services/review/lineReviewGate';
export const dynamic = 'force-dynamic';
export default async function Storyboard({ params }: { params: { token: string } }) {
  const { item } = await validatePreview(params.token);
  const mediaUrl = item.assetRefs[0] ? await spacesSignedUrl(item.assetRefs[0].storage_key, 300) : null;
  async function save(data: FormData) {
    'use server';
    const { item: current } = await validatePreview(params.token);
    const script = String(data.get('script') ?? '');
    if (!script.trim() || script.length > 20000) throw new Error('Invalid script');
    const storyboard = String(data.get('storyboard') ?? current.payload.storyboard ?? '');
    if (storyboard) JSON.parse(storyboard);
    if (data.get('decision') === 'approve' && (script !== String(current.payload.script ?? '') ||
        storyboard !== String(current.payload.storyboard ?? ''))) throw new Error('Save revisions before approving');
    const updated = await createReviewService().decide({ itemId: current.id, expectedVersion: current.version,
      actorUserId: current.shopUserId, actorVia: 'web', rerender: current.typeKey !== 'script', decision: data.get('decision') === 'approve' ? 'approve' : 'edit',
      edits: [{ field: 'script', before: current.payload.script, after: script },
        { field: 'storyboard', before: current.payload.storyboard, after: storyboard }] });
    if (updated.status === 'approved') {

      redirect('/r/' + params.token);
    }
    if (updated.renderState === 'queued') {

      redirect('/r/' + params.token);
    }
    const token = await issuePreviewToken({ itemId: updated.id, version: updated.version, typeKey: updated.typeKey });
    redirect('/r/' + token + '/storyboard');
  }
  return <main className="max-w-2xl mx-auto p-8"><h1>Storyboard review</h1>
    {mediaUrl && <video controls src={mediaUrl} className="w-full" />}
    <form action={save}><textarea name="script" aria-label="Storyboard review" rows={18} className="w-full border p-3"
      defaultValue={String(item.payload.script ?? JSON.stringify(item.payload, null, 2))} />
      {item.typeKey === 'script' && <textarea name="storyboard" aria-label="Storyboard JSON" rows={12}
        className="w-full border p-3" defaultValue={String(item.payload.storyboard ?? '')} />}
      <button name="decision" value="edit">Save revision</button>
      <button name="decision" value="approve">Approve</button></form></main>;
}
