/**
 * AdLabPublishingService — real publishing for the private Ad Lab, plus the
 * results it reads back from the platforms.
 *
 * It reuses Channel Management's CONNECTED ACCOUNTS (social_connections, via
 * Post for Me) but not Management's content items or paid entitlement: Ad Lab
 * is owner-only and its pricing is undecided, so publishing here is free and
 * gated only by the Ad Lab allowlist (checked by the routes).
 *
 * ORDER OF OPERATIONS (same discipline as ManagementPublicationService):
 *   1. validate the video object (ours, present) and every connection (ours,
 *      connected, maps to the channel);
 *   2. write the publication + one target per destination BEFORE the provider
 *      call, so a crash mid-send leaves an auditable record;
 *   3. mint a fresh signed URL and send ONE provider post to all destinations
 *      (one video → one post);
 *   4. never retry a create — a timeout may have published, and a duplicate
 *      post is the one failure users never forgive. Status is read back with
 *      refresh(), not by re-sending.
 */

import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { spacesClient, SPACES_BUCKET, spacesSignedUrl } from "@/lib/spaces";
import { adLabPublicationRepository, socialConnectionRepository } from "@/repositories";
import type { IAdLabPublicationRepository } from "@/repositories/interfaces/IAdLabPublicationRepository";
import type { ISocialConnectionRepository } from "@/repositories/postgres/PostgresSocialConnectionRepository";
import { socialPublishingProvider } from "@/services/social-publishing";
import type { SocialPublishingProvider } from "@/services/social-publishing/provider";
import { SocialPublishingError } from "@/services/social-publishing/errors";
import { SocialConnectionStatus } from "@/domain/enums/ManagementStatus";
import { AD_LAB_CHANNELS, type AdLabChannel } from "@/domain/models/AdLab";
import {
  aggregateAdLabPublicationStatus,
  type AdLabPublication,
} from "@/domain/models/AdLabPublication";
import { channelForPlatform } from "@/features/ad-lab/socialAccountChannels";
import { normalizeAdLabMetrics } from "./adLabInsights";
import { isAdLabLocalUserId } from "@/lib/auth/adLabLocalCredentials";

export const AD_LAB_EXTERNAL_ID_PREFIX = "adlab_";

export const AD_LAB_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
] as const;

/** Largest video accepted (default 500 MB, env-overridable). */
export const AD_LAB_VIDEO_MAX_BYTES = Number(
  process.env.RCLIPPER_AD_LAB_VIDEO_MAX_BYTES ?? String(500 * 1024 * 1024)
);

const UPLOAD_URL_TTL_SECONDS = 60 * 60;

export class AdLabPublishingError extends Error {
  constructor(
    readonly code:
      | "local_account"
      | "unsupported_type"
      | "too_large"
      | "empty_file"
      | "video_not_found"
      | "no_targets"
      | "missing_caption"
      | "duplicate_target"
      | "unknown_connection"
      | "connection_not_connected"
      | "channel_mismatch"
      | "not_found"
      | "not_deletable"
      | "provider_error"
      | "insights_unavailable",
    message: string
  ) {
    super(message);
    this.name = "AdLabPublishingError";
  }
}

export interface PublishTargetInput {
  channel: AdLabChannel;
  connectionId: string;
  plannedBudget?: number;
}

export interface PublishInput {
  brandId: string;
  draftId: string;
  planId?: string | null;
  campaignName: string;
  caption: string;
  /** Used as the title on platforms that need one (YouTube). */
  title?: string;
  videoKey: string;
  videoName: string;
  targets: PublishTargetInput[];
}

export interface RefreshResult {
  publication: AdLabPublication;
  /** Per-destination notes, e.g. an account that needs reconnecting for analytics. */
  warnings: string[];
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "video.mp4";
}

export function adLabVideoKeyPrefix(userId: string): string {
  return `ad_lab/${userId}/`;
}

export class AdLabPublishingService {
  constructor(
    private publications: IAdLabPublicationRepository = adLabPublicationRepository,
    private connections: ISocialConnectionRepository = socialConnectionRepository,
    private provider: SocialPublishingProvider = socialPublishingProvider,
    private s3: S3Client = spacesClient,
    private signUrl: (key: string) => Promise<string> = (key) => spacesSignedUrl(key)
  ) {}

  /** Publishing needs a real RClipper account (and its social connections). */
  private assertRealAccount(userId: string) {
    if (isAdLabLocalUserId(userId)) {
      throw new AdLabPublishingError(
        "local_account",
        "การเผยแพร่จริงต้องเข้าสู่ระบบด้วยบัญชี RClipper จริง (ไม่ใช่ local login)"
      );
    }
  }

  /** Step 1 of publishing: a presigned PUT so the browser uploads straight to Spaces. */
  async beginVideoUpload(params: {
    userId: string;
    fileName: string;
    fileSizeBytes: number;
    mimeType: string;
  }): Promise<{ uploadUrl: string; videoKey: string; expiresInSeconds: number }> {
    this.assertRealAccount(params.userId);
    const mime = params.mimeType.toLowerCase().split(";")[0].trim();
    if (!(AD_LAB_VIDEO_MIME_TYPES as readonly string[]).includes(mime)) {
      throw new AdLabPublishingError("unsupported_type", `รองรับเฉพาะ ${AD_LAB_VIDEO_MIME_TYPES.join(", ")}`);
    }
    if (!Number.isFinite(params.fileSizeBytes) || params.fileSizeBytes <= 0) {
      throw new AdLabPublishingError("empty_file", "ไฟล์วิดีโอว่างเปล่า");
    }
    if (params.fileSizeBytes > AD_LAB_VIDEO_MAX_BYTES) {
      throw new AdLabPublishingError(
        "too_large",
        `ไฟล์ใหญ่เกิน ${Math.floor(AD_LAB_VIDEO_MAX_BYTES / (1024 * 1024))} MB`
      );
    }
    const videoKey = `${adLabVideoKeyPrefix(params.userId)}${crypto.randomUUID()}-${sanitizeFileName(params.fileName)}`;
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: SPACES_BUCKET, Key: videoKey, ContentType: mime }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS }
    );
    return { uploadUrl, videoKey, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
  }

  async publish(userId: string, input: PublishInput): Promise<AdLabPublication> {
    this.assertRealAccount(userId);

    // ── 1. Validate ─────────────────────────────────────────────────────────
    if (!input.videoKey.startsWith(adLabVideoKeyPrefix(userId))) {
      throw new AdLabPublishingError("video_not_found", "ไม่พบวิดีโอที่อัปโหลด");
    }
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: SPACES_BUCKET, Key: input.videoKey }));
    } catch {
      throw new AdLabPublishingError("video_not_found", "อัปโหลดวิดีโอยังไม่เสร็จ หรือไฟล์หายไป");
    }

    // Post for Me rejects a post without a caption ("caption is required"), so
    // catch it here with a clear message instead of a provider 400.
    if (!input.caption.trim()) {
      throw new AdLabPublishingError("missing_caption", "ใส่ Caption ก่อนเผยแพร่");
    }

    if (input.targets.length === 0) {
      throw new AdLabPublishingError("no_targets", "เลือกบัญชีปลายทางอย่างน้อย 1 บัญชี");
    }
    const seen = new Set<string>();
    const resolved = [];
    for (const target of input.targets) {
      if (!(AD_LAB_CHANNELS as readonly string[]).includes(target.channel)) {
        throw new AdLabPublishingError("channel_mismatch", "ช่องทางไม่รองรับ");
      }
      if (seen.has(target.connectionId)) {
        throw new AdLabPublishingError("duplicate_target", "เลือกบัญชีเดียวกันซ้ำ");
      }
      seen.add(target.connectionId);

      const connection = await this.connections.findById(target.connectionId);
      // Ownership is checked against OUR table: provider filtering alone is not
      // an authorisation boundary (the API key is project-wide).
      if (!connection || connection.userId !== userId) {
        throw new AdLabPublishingError("unknown_connection", "ไม่พบบัญชีโซเชียลนี้ในบัญชีของคุณ");
      }
      if (connection.connectionStatus !== SocialConnectionStatus.Connected || !connection.providerAccountId) {
        throw new AdLabPublishingError(
          "connection_not_connected",
          `บัญชี ${connection.accountUsername ?? connection.accountName ?? connection.platform} ต้องเชื่อมต่อใหม่ก่อนเผยแพร่`
        );
      }
      if (channelForPlatform(connection.platform) !== target.channel) {
        throw new AdLabPublishingError("channel_mismatch", "บัญชีไม่ตรงกับช่องทางที่เลือก");
      }
      resolved.push({
        channel: target.channel,
        connectionId: connection.id,
        providerAccountId: connection.providerAccountId,
        platform: connection.platform,
        accountLabel: connection.accountUsername ?? connection.accountName ?? connection.platform,
        plannedBudget: Math.max(0, Number(target.plannedBudget) || 0),
      });
    }

    // ── 2. Record before sending ────────────────────────────────────────────
    const publication = await this.publications.create({
      ownerId: userId,
      brandId: input.brandId,
      draftId: input.draftId,
      planId: input.planId ?? null,
      campaignName: input.campaignName.trim() || "Ad Lab campaign",
      caption: input.caption.trim(),
      videoKey: input.videoKey,
      videoName: input.videoName,
      targets: resolved,
    });

    // ── 3. Send one post to every destination ───────────────────────────────
    try {
      const media = await this.provider.prepareMedia({ sourceUrl: await this.signUrl(input.videoKey) });
      const title = input.title?.trim().slice(0, 100);
      const result = await this.provider.createPost({
        caption: input.caption.trim(),
        media: [media],
        targets: resolved.map((t) => ({
          externalAccountId: t.providerAccountId,
          platform: t.platform,
          ...(t.channel === "youtube" && title ? { title } : {}),
        })),
        externalId: `${AD_LAB_EXTERNAL_ID_PREFIX}${publication.id}`,
      });
      await this.publications.setProviderPost(publication.id, result.externalPostId, "processing");
    } catch (err) {
      const message =
        err instanceof SocialPublishingError ? err.message : "ส่งโพสต์ไปยังผู้ให้บริการไม่สำเร็จ";
      for (const target of publication.targets) {
        await this.publications.updateTargetOutcome(target.id, { status: "failed", error: message });
      }
      await this.publications.setProviderPost(publication.id, null, "failed", message);
      throw new AdLabPublishingError("provider_error", message);
    }

    return (await this.publications.findById(publication.id)) ?? publication;
  }

  async list(userId: string): Promise<AdLabPublication[]> {
    return this.publications.listByOwner(userId);
  }

  private async owned(userId: string, publicationId: string): Promise<AdLabPublication> {
    const publication = await this.publications.findById(publicationId);
    if (!publication || publication.ownerId !== userId) {
      throw new AdLabPublishingError("not_found", "ไม่พบโพสต์นี้");
    }
    return publication;
  }

  /**
   * Read back where the post went (per destination) and then its metrics.
   * Safe to call repeatedly; never re-sends anything.
   */
  async refresh(userId: string, publicationId: string): Promise<RefreshResult> {
    let publication = await this.owned(userId, publicationId);
    const warnings: string[] = [];

    // ── Outcome per destination ─────────────────────────────────────────────
    if (publication.providerPostId) {
      try {
        const status = await this.provider.getPostStatus(publication.providerPostId);
        for (const target of publication.targets) {
          const result = status.results.find((r) => r.externalAccountId === target.providerAccountId);
          if (!result) continue;
          await this.publications.updateTargetOutcome(target.id, result.success
            ? {
                status: "published",
                platformPostId: result.platformPostId,
                platformUrl: result.publishedUrl,
                error: null,
                publishedAt: target.publishedAt ? null : new Date(),
              }
            : { status: "failed", error: result.error?.message ?? "แพลตฟอร์มปฏิเสธโพสต์" });
        }
        publication = await this.owned(userId, publicationId);
        await this.publications.setStatus(
          publication.id,
          aggregateAdLabPublicationStatus(publication.targets)
        );
      } catch (err) {
        warnings.push(
          err instanceof SocialPublishingError ? `อ่านสถานะไม่สำเร็จ: ${err.message}` : "อ่านสถานะไม่สำเร็จ"
        );
      }
    }

    // ── Metrics for every published destination ─────────────────────────────
    const getInsights = this.provider.getPostInsights?.bind(this.provider);
    if (!getInsights) {
      warnings.push("ผู้ให้บริการยังไม่รองรับการอ่านผลโพสต์");
    } else {
      for (const target of publication.targets.filter((t) => t.status === "published")) {
        try {
          const insights = await getInsights({
            externalAccountId: target.providerAccountId,
            ...(target.platformPostId
              ? { platformPostIds: [target.platformPostId] }
              : publication.providerPostId
                ? { externalPostIds: [publication.providerPostId] }
                : {}),
          });
          const match =
            insights.find((i) => target.platformPostId && i.platformPostId === target.platformPostId) ??
            insights.find((i) => publication.providerPostId && i.externalPostId === publication.providerPostId) ??
            null;
          if (!match?.metrics) {
            warnings.push(`${target.accountLabel}: แพลตฟอร์มยังไม่ส่งตัวเลข (บางแพลตฟอร์มใช้เวลาถึง 48 ชม.)`);
            continue;
          }
          await this.publications.updateTargetMetrics(
            target.id,
            normalizeAdLabMetrics(target.platform, match.metrics),
            match.metrics
          );
        } catch (err) {
          const denied = err instanceof SocialPublishingError && err.code === "permission_denied";
          warnings.push(
            denied
              ? `${target.accountLabel}: เชื่อมต่อบัญชีใหม่จาก Ad Lab เพื่ออนุญาตการอ่านผล (analytics)`
              : `${target.accountLabel}: อ่านผลไม่สำเร็จ`
          );
        }
      }
    }

    return { publication: await this.owned(userId, publicationId), warnings };
  }

  /**
   * Delete a publication that never reached any platform, together with its
   * targets, metric snapshots (cascade) and the uploaded video in storage.
   *
   * Only FAILED publications qualify: once anything is live — or may still go
   * live (sending / processing) — the record is the only audit trail of a real
   * post, and deleting it here would not remove the post from the platform.
   */
  async deleteFailed(userId: string, publicationId: string): Promise<void> {
    const publication = await this.owned(userId, publicationId);
    const anyLive = publication.targets.some((t) => t.status === "published");
    if (publication.status !== "failed" || anyLive) {
      throw new AdLabPublishingError(
        "not_deletable",
        "ลบได้เฉพาะโพสต์ที่เผยแพร่ไม่สำเร็จ — โพสต์ที่ขึ้นแพลตฟอร์มแล้วหรือกำลังประมวลผลต้องจัดการที่แพลตฟอร์ม"
      );
    }
    await this.publications.delete(publication.id);
    // Only ever touch keys under this owner's prefix. Best effort: a leftover
    // object is harmless, a half-deleted record is not.
    if (publication.videoKey.startsWith(adLabVideoKeyPrefix(userId))) {
      await this.s3
        .send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: publication.videoKey }))
        .catch((err) => console.warn("[ad-lab] video delete failed", publication.videoKey, err));
    }
  }

  /** The money side of one destination, entered by the owner. */
  async updateEconomics(
    userId: string,
    targetId: string,
    values: { spend?: number; revenue?: number; conversions?: number }
  ): Promise<AdLabPublication> {
    const found = await this.publications.findTargetById(targetId);
    if (!found || found.ownerId !== userId) {
      throw new AdLabPublishingError("not_found", "ไม่พบโพสต์นี้");
    }
    const clean = (v: number | undefined) =>
      v === undefined ? undefined : Math.max(0, Number.isFinite(v) ? v : 0);
    await this.publications.updateTargetEconomics(targetId, {
      spend: clean(values.spend),
      revenue: clean(values.revenue),
      conversions: values.conversions === undefined ? undefined : Math.max(0, Math.round(values.conversions)),
    });
    return this.owned(userId, found.target.publicationId);
  }
}

export const adLabPublishingService = new AdLabPublishingService();
