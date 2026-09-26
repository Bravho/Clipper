import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import MobileVideoEditor from "@/features/device-render/MobileVideoEditor";
import { StudioAppGate } from "@/features/device-render/StudioAppGate";
import type { EditorBrief } from "@/features/device-render/editorState";
import { PIPELINE_STEP_COSTS } from "@/config/credits";
import { Platform } from "@/domain/enums/Platform";
import { clipRequestService } from "@/services/ClipRequestService";
import { getStudioQuota } from "@/services/studioQuota";
import type { StudioQuota } from "@/features/device-render/QuotaPrompt";
import {
  buildDistributionTransferView,
  type DistributionTransferView,
} from "@/features/management/server/buildDistributionTransferView";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/config/studioRollout";
import { isManagementEnabledFor } from "@/config/management";
import { headers } from "next/headers";
import { parseAppUserAgent } from "@/lib/mobile/appUserAgent";

export const metadata: Metadata = { title: "Studio — RClipper" };
export const dynamic = "force-dynamic";

/**
 * The studio: THE way to make a video.
 *
 * Every frame is rendered on the phone; the server only writes the storyboard
 * and script, makes the voice, checks what the phone uploads, keeps the
 * finished videos and publishes them. `?request=<id>` reopens a request at the
 * step it is on — a Draft's brief, a job waiting for approval, a render that
 * was interrupted (the phone takes its lease back), or the finished videos and
 * their hand-over to Channel Management.
 *
 * Open to every requester (the tester-only gate is retired — see
 * `_to_delete/studio-lab-gate/`). `StudioAppGate` shows an update screen to
 * an app build without the render plugin, and "get the app" to a browser.
 */
export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const user = await requireRole(Role.Requester);
  const { request } = await searchParams;

  // Reopening a request: show its brief, so the next save edits what is there
  // rather than overwriting it with blanks. Ownership is checked by the
  // service; anything it refuses simply opens an empty studio.
  let initialBrief: EditorBrief | null = null;
  let requestLabel: string | null = null;
  let requestId: string | null = null;
  if (request) {
    try {
      const saved = await clipRequestService.getOwnedRequest(request, user.id);
      requestId = saved.id;
      requestLabel = saved.title || null;
      initialBrief = {
        clipName: saved.title ?? "",
        placeName: saved.placeName ?? "",
        latitude: Number.isFinite(saved.latitude) ? (saved.latitude as number) : null,
        longitude: Number.isFinite(saved.longitude) ? (saved.longitude as number) : null,
        details: saved.description ?? "",
        targetSeconds: saved.durationSeconds ?? PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS,
        platforms:
          saved.targetPlatforms && saved.targetPlatforms.length > 0
            ? saved.targetPlatforms
            : [Platform.TravyApp],
      };
    } catch {
      initialBrief = null;
      requestId = null;
    }
  }

  // The allowance, so the studio can say "none left — buy a package" before
  // media is picked, instead of failing at Submit. Unknown on error.
  let quota: StudioQuota | null = null;
  try {
    quota = await getStudioQuota(user.id);
  } catch {
    quota = null;
  }

  // Which finished videos of this request are already in Channel Management,
  // so the Channels step shows "Publish" instead of "Send" for them.
  let management: DistributionTransferView = { enabled: false, transferredByAssetId: {} };
  try {
    management = requestId
      ? await buildDistributionTransferView(user, requestId)
      : { enabled: isManagementEnabledFor(user), transferredByAssetId: {} };
  } catch {
    // Channel Management unavailable: the Channels step still offers downloads.
  }

  return (
    <StudioAppGate
      appStoreUrl={APP_STORE_URL}
      playStoreUrl={PLAY_STORE_URL}
      appClient={parseAppUserAgent(headers().get("user-agent"))}
    >
      <MobileVideoEditor
        requestId={requestId}
        requestLabel={requestLabel}
        initialBrief={initialBrief}
        quota={quota}
        management={management}
      />
    </StudioAppGate>
  );
}
