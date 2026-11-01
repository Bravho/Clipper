import { createHash } from 'crypto';
import { ILineAccountRepository } from '@/repositories/interfaces/ILineAccountRepository';
import { IUserRepository } from '@/repositories/interfaces/IUserRepository';
import { IServicePackageRepository } from '@/repositories/interfaces/IServicePackageRepository';
import { IClipRequestRepository } from '@/repositories/interfaces/IClipRequestRepository';
import { IUploadedAssetRepository } from '@/repositories/interfaces/IUploadedAssetRepository';
import { Role } from '@/domain/enums/Role';
import { Platform } from '@/domain/enums/Platform';
import { RequestStatus } from '@/domain/enums/RequestStatus';
import { AssetType, AssetUploadStatus } from '@/domain/enums/AssetType';
import { findPackageByCode } from '@/config/stripePackages';
import { assertDurationAllowed } from '@/services/review/ReviewService';

function isTestRun(lineUserId: string): boolean {
  if (process.env.LINE_TEST_MODE === 'true') return true;
  const testId = process.env.LINE_TEST_SHOP_ID;
  return !!testId && testId === lineUserId;
}

export class LineIntakeService {
  constructor(private channel: string, private accounts: ILineAccountRepository,
    private users: IUserRepository, private packages: IServicePackageRepository,
    private requests: IClipRequestRepository, private assets: IUploadedAssetRepository) {}

  async ensureAccount(lineUserId: string) {
    const existing = await this.accounts.findByLineUser(this.channel, lineUserId);
    if (existing) {
      if (existing.status !== 'active') throw new Error('account_blocked');
      return existing;
    }
    const email = createHash('sha256').update(this.channel + ':' + lineUserId).digest('hex') + '@line.invalid';
    const user = await this.users.findByEmail(email) ?? await this.users.create({
      email, name: 'LINE shop', role: Role.Requester, emailVerified: false, priorTrialRequestsUsed: 0 });
    return this.accounts.create({ userId: user.id, lineUserId, lineChannelId: this.channel,
      displayName: null, linkedVia: 'auto_created', status: 'active', isTest: isTestRun(lineUserId) });
  }

  /** Return the active paid order if it has remaining clips, null otherwise. */
  async findActiveOrderWithBalance(lineUserId: string): Promise<{ orderId: string; clipsLeft: number } | null> {
    const account = await this.ensureAccount(lineUserId);
    const order = await this.packages.findActiveOrderByUser(account.userId);
    if (!order) return null;
    const balance = await this.packages.getBalance(order.id);
    if (balance.clipsLeft <= 0) return null;
    return { orderId: order.id, clipsLeft: balance.clipsLeft };
  }

  async choosePackage(lineUserId: string, code: string) {
    const account = await this.ensureAccount(lineUserId);
    const pkg = findPackageByCode(code);
    if (!pkg) throw new Error('unknown_package');
    const order = await this.packages.createOrder({ userId: account.userId, packageCode: code,
      clipsIncluded: pkg.clipsIncluded, revisionsPerClip: pkg.revisionsPerClip,
      priceBaht: pkg.priceBaht, expiresAt: new Date(Date.now() + 30 * 86400000),
      isTest: isTestRun(lineUserId) });
    const url = new URL(pkg.paymentLinkUrl);
    url.searchParams.set('client_reference_id', order.id);
    return { orderId: order.id, paymentUrl: url.toString() };
  }

  async isPaid(orderId: string, lineUserId: string) {
    const account = await this.ensureAccount(lineUserId);
    const order = await this.packages.findOrderById(orderId);
    return !!order && order.userId === account.userId && order.status === 'active' && order.expiresAt > new Date();
  }

  async submit(lineUserId: string, context: Record<string, unknown>) {
    const account = await this.ensureAccount(lineUserId);
    const orderId = String(context.orderId ?? '');
    if (!await this.isPaid(orderId, lineUserId)) throw new Error('payment_required');
    const balance = await this.packages.getBalance(orderId);
    if (balance.clipsLeft <= 0) throw new Error('package_exhausted');
    const duration = Number(context.durationSeconds ?? 30);
    assertDurationAllowed(duration);
    const files = context.files as string[];
    if (!files?.length) throw new Error('files_required');
    const existing = (await this.requests.findByUserId(account.userId)).find(r => r.externalRef === context.intakeId);
    if (existing && existing.status !== RequestStatus.Draft) return { requestId: existing.id };
    const request = existing ?? await this.requests.create({ userId: account.userId, title: 'LINE shop video',
      description: String(context.brief ?? ''), targetAudience: '', targetPlatforms: [Platform.TikTok],
      preferredStyle: '', preferredLanguage: 'th', durationSeconds: duration, intakeChannel: 'line',
      renderLane: 'mac_mini', packageOrderId: orderId, externalRef: String(context.intakeId),
      shopReviewPreferences: { storyboard: context.reviewStoryboard === true, voice: context.reviewVoice === true },
      isTest: isTestRun(lineUserId) });
    const existingAssets = await this.assets.findByRequestId(request.id);
    for (const file of files) {
      if (existingAssets.some(asset => asset.storageKey === file)) continue;
      const video = file.endsWith('.mp4');
      await this.assets.create({ requestId: request.id, userId: account.userId, fileName: file.split('/').pop()!,
        assetType: video ? AssetType.Video : AssetType.Image, fileSizeBytes: 0,
        mimeType: video ? 'video/mp4' : 'image/jpeg', storageKey: file, storageUrl: '',
        thumbnailKey: '', thumbnailUrl: '', uploadStatus: AssetUploadStatus.Uploaded,
        scheduledDeletionAt: new Date(Date.now() + 7 * 86400000) });
    }
    await this.packages.recordUsage({ packageOrderId: orderId, requestId: request.id, kind: 'clip' });
    await this.requests.updateStatus(request.id, RequestStatus.Submitted, {
      submittedAt: new Date(), creditConfirmed: true, rightsConfirmed: true, aiProcessingConfirmed: true,
      aiConsentVersion: "1.0.0", aiConsentAcceptedAt: new Date(), downloadUnlocked: true });
    return { requestId: request.id };
  }
}
