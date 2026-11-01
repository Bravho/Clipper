import { NextRequest, NextResponse } from 'next/server';
import { lineAccountRepository, reviewItemRepository, reviewOutboxRepository, clipRequestRepository, videoGenerationJobRepository } from '@/repositories';
import { adminAuth, notFound, scopedItem, takeoverActive } from '@/services/line/handoffAdmin';

export async function GET(request: NextRequest, { params }: { params: { itemId: string } }): Promise<NextResponse> {
  const auth = adminAuth(request); if (auth) return auth;
  const context = await scopedItem(params.itemId); if (!context) return notFound();
  const { item, account } = context;
  const messages = await reviewItemRepository.listCustomerMessages(item.shopUserId, account.lineUserId);
  const replies = await reviewOutboxRepository.listRecentReplies(account.id);
  const conversation = await lineAccountRepository.getConversationState(account.lineChannelId, account.lineUserId);
  const requestId = item.requestId ?? (typeof conversation?.context.requestId === 'string' ? conversation.context.requestId : null);
  const req = requestId ? await clipRequestRepository.findById(requestId) : null;
  if (req && (req.userId !== item.shopUserId || (req.isTest === true) !== (account.isTest === true))) return notFound();
  const job = item.jobId ? await videoGenerationJobRepository.findById(item.jobId)
    : req ? await videoGenerationJobRepository.findByRequestId(req.id) : null;
  if (job && (!req || job.requestId !== req.id)) return notFound();
  const takeover = takeoverActive(account);
  return NextResponse.json({
    itemId: item.id, version: item.version, status: item.status, typeKey: item.typeKey, shortCode: item.shortCode,
    isTest: account.isTest === true, conversationRef: account.id, takeoverActive: takeover,
    takeoverExpiresAt: account.takeoverExpiresAt?.toISOString() ?? null,
    customerText: typeof item.payload.text === 'string' ? item.payload.text : null,
    messages: messages.map(i => ({ itemId: i.id, text: typeof i.payload.text === 'string' ? i.payload.text : null, receivedAt: i.createdAt.toISOString(), status: i.status })),
    replies: replies.slice(0,10).map(e => ({ outboxEventId: e.eventId, text: e.payload.text, actor: e.payload.actor, status: e.state, createdAt: e.createdAt.toISOString() })),
    conversation: { state: conversation?.state ?? null, requestId: typeof conversation?.context.requestId === 'string' ? conversation.context.requestId : null },
    request: req ? { id: req.id, status: req.status } : null,
    job: job ? { status: job.status, currentStep: job.currentStep } : null,
  });
}
