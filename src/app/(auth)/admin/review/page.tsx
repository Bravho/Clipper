import { requireRole } from '@/lib/auth/helpers';
import { Role } from '@/domain/enums/Role';
import { createReviewService } from '@/repositories';
import { executeReviewDecision } from '@/services/review/lineReviewGate';
import { revalidatePath } from 'next/cache';
export const dynamic = 'force-dynamic';
export default async function ReviewQueue() {
  await requireRole(Role.Admin);
  const items = await createReviewService().listPending();
  async function decide(form: FormData) {
    'use server';
    const user = await requireRole(Role.Admin);
    const decision = form.get('decision');
    if (decision !== 'approve' && decision !== 'reject') throw new Error('Invalid decision');
    const item = await createReviewService().decide({ itemId: String(form.get('itemId')),
      expectedVersion: Number(form.get('version')), actorUserId: user.id, actorVia: 'web', decision });
    await executeReviewDecision(item.id);
    revalidatePath('/admin/review');
  }
  return <main className="p-8 space-y-4"><h1>Review queue</h1>{items.filter(item => item.payload.audience !== 'shop').map(item =>
    <section key={item.id} className="border p-4"><h2>{item.title}</h2><pre className="whitespace-pre-wrap">{JSON.stringify(item.payload, null, 2)}</pre>
      <form action={decide}><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="version" value={item.version} />
        <button name="decision" value="approve">Approve</button> <button name="decision" value="reject">Reject</button></form></section>)}</main>;
}
