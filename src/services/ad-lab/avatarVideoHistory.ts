import type { AdLabAvatarVideoEntry, AdLabAvatarVideo, AdLabDraftAvatar } from "@/domain/models/AdLab";

export function legacyVideoFromEntry(entry: AdLabAvatarVideoEntry): AdLabAvatarVideo {
  return {
    provider: "heygen", engine: entry.engine, lookId: entry.lookId,
    idempotencyKey: entry.idempotencyKey, heygenVideoId: entry.heygenVideoId,
    jobToken: entry.jobToken, status: entry.status, error: entry.error,
    attempts: entry.attempts, requestedAt: entry.createdAt,
    completedAt: entry.status === "ready" ? entry.updatedAt : undefined,
    aspectRatio: entry.aspectRatio ?? "9:16", resolution: "1080p",
    durationSec: entry.durationSec, estCostUsd: entry.estCostUsd,
    videoKey: entry.videoKey, audioAssetId: entry.audioAssetId,
    assetToken: entry.assetToken, sourceAudioKey: entry.sourceAudioKey,
  };
}

export function removeAvatarVideo(avatar: AdLabDraftAvatar, id: string, now: string): AdLabDraftAvatar {
  const videos = (avatar.videos ?? []).filter(entry => entry.id !== id);
  const primary = videos.find(entry => entry.id === avatar.primaryVideoId && entry.status === "ready")
    ?? videos.find(entry => entry.status === "ready");
  // An explicit empty history prevents the legacy field from resurrecting a deleted entry.
  return { ...avatar, videos, primaryVideoId: primary?.id,
    video: primary ? legacyVideoFromEntry(primary) : undefined, updatedAt: now };
}
