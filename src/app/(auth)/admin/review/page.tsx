import { requireRole } from '@/lib/auth/helpers';
import { Role } from '@/domain/enums/Role';
import { createReviewService } from '@/repositories';
import { spacesSignedUrl } from '@/lib/spaces';
import { revalidatePath } from 'next/cache';
import type { ReviewItem } from '@/domain/models/ReviewItem';

export const dynamic = 'force-dynamic';

/** Build short-lived signed preview URLs for all assetRefs on an item. */
async function resolvePreviewUrls(item: ReviewItem): Promise<{ role: string; url: string; mime: string }[]> {
  return Promise.all(
    (item.assetRefs ?? []).map(async (ref) => ({
      role: ref.role,
      mime: ref.mime,
      url: await spacesSignedUrl(ref.storage_key, 1800).catch(() => ''),
    }))
  );
}

export default async function ReviewQueue() {
  await requireRole(Role.Admin);
  const items = await createReviewService().listPending();
  const adminItems = items.filter(item => item.payload.audience !== 'shop');

  const previews = await Promise.all(adminItems.map(resolvePreviewUrls));

  async function decide(form: FormData) {
    'use server';
    const user = await requireRole(Role.Admin);
    const decision = form.get('decision') as string;
    if (!['approve', 'reject', 'manual_reply'].includes(decision)) throw new Error('Invalid decision');
    const replyText = form.get('replyText') ? String(form.get('replyText')) : undefined;
    await createReviewService().decide({
      itemId: String(form.get('itemId')),
      expectedVersion: Number(form.get('version')),
      actorUserId: user.id,
      actorVia: 'web',
      decision: decision as 'approve' | 'reject' | 'manual_reply',
      replyText,
    });
    revalidatePath('/admin/review');
  }

  return (
    <main className="p-8 space-y-6">
      <h1 className="text-2xl font-bold">Review queue ({adminItems.length})</h1>
      {adminItems.length === 0 && <p className="text-gray-500">No pending items.</p>}
      {adminItems.map((item, i) => {
        const isReply = item.typeKey === 'customer_reply';
        const itemPreviews = previews[i] ?? [];
        return (
          <section key={item.id} className="border rounded p-4 space-y-3">
            <header className="flex items-center gap-3">
              <span className="font-mono text-sm bg-gray-100 px-2 py-0.5 rounded">{item.shortCode}</span>
              <h2 className="font-semibold">{item.title}</h2>
              <span className="text-xs text-gray-400">{item.typeKey} · v{item.version}</span>
            </header>

            {/* Media previews */}
            {itemPreviews.length > 0 && (
              <div className="space-y-2">
                {itemPreviews.map((p, j) => (
                  <div key={j} className="space-y-1">
                    <p className="text-xs text-gray-500 uppercase">{p.role}</p>
                    {p.url && p.mime.startsWith('video/') && (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video src={p.url} controls className="max-w-sm max-h-64 rounded border" />
                    )}
                    {p.url && p.mime.startsWith('audio/') && (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <audio src={p.url} controls className="w-full" />
                    )}
                    {p.url && p.mime.startsWith('image/') && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.url} alt={p.role} className="max-w-sm max-h-64 rounded border object-contain" />
                    )}
                    {!p.url && (
                      <p className="text-xs text-red-400">Preview unavailable</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Payload */}
            <details>
              <summary className="cursor-pointer text-sm text-gray-500">Payload</summary>
              <pre className="mt-1 text-xs whitespace-pre-wrap bg-gray-50 p-2 rounded">{JSON.stringify(item.payload, null, 2)}</pre>
            </details>

            {/* Decision form */}
            <form action={decide} className="space-y-2">
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="version" value={item.version} />

              {/* Reply textarea for escalated customer messages */}
              {isReply && (
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor={`reply-${item.id}`}>
                    Reply to customer (sent via LINE push):
                  </label>
                  <textarea
                    id={`reply-${item.id}`}
                    name="replyText"
                    rows={3}
                    className="w-full border rounded p-2 text-sm"
                    placeholder="Type your reply here…"
                    required
                  />
                  <button name="decision" value="manual_reply"
                    className="px-3 py-1 bg-blue-600 text-white rounded text-sm">
                    Send reply
                  </button>
                </div>
              )}

              {!isReply && (
                <div className="flex gap-2">
                  <button name="decision" value="approve"
                    className="px-3 py-1 bg-green-600 text-white rounded text-sm">
                    Approve
                  </button>
                  <button name="decision" value="reject"
                    className="px-3 py-1 bg-red-600 text-white rounded text-sm">
                    Reject
                  </button>
                </div>
              )}
            </form>
          </section>
        );
      })}
    </main>
  );
}
