import { videoQuotaService } from "@/services/VideoQuotaService";
import type { StudioQuota } from "@/features/device-render/QuotaPrompt";

/**
 * The account's allowance in the shape the phone studio uses.
 *
 * Shared by the studio page (first render) and GET /api/video-packages/quota
 * (re-read when the studio comes back into view), so both agree on what
 * "can submit" means.
 */
export async function getStudioQuota(userId: string): Promise<StudioQuota> {
  const current = await videoQuotaService.getQuota(userId);
  return {
    tier: current.tier === "paid" ? "paid" : "free",
    remaining: current.remaining,
    total: current.total,
    renewsAt: current.renewsAt ? current.renewsAt.toISOString() : null,
    canSubmit: current.canSubmit,
  };
}
