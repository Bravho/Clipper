import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/helpers";
import { canAccessDeviceRenderLab } from "@/lib/mobile/deviceRenderLabAccess";
import MobileVideoEditor from "@/features/device-render/MobileVideoEditor";
import { StudioBanner } from "@/features/device-render/StudioBanner";
import type { EditorBrief } from "@/features/device-render/editorState";
import { PIPELINE_STEP_COSTS } from "@/config/credits";
import { Platform } from "@/domain/enums/Platform";
import { clipRequestService } from "@/services/ClipRequestService";
import { getStudioQuota } from "@/services/studioQuota";
import type { StudioQuota } from "@/features/device-render/QuotaPrompt";
import { ROUTES } from "@/config/routes";

/**
 * The phone video editor.
 *
 * THE GATE STAYS. `canAccessDeviceRenderLab` limits this to one tester account
 * in production, and it stays in front of the page for exactly as long as the
 * renderer is incomplete — the same check also guards every `/api/device-render`
 * route, so a production build exposes neither the screen nor the endpoints that
 * could take a real job off the worker queue.
 *
 * `?request=<id>` connects the editor to a real request: it can then take that
 * request's queued render step, with the server holding the lease and verifying
 * the result. Without it the editor is a draft tool and says so.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const user = process.env.NODE_ENV === "development" ? null : await getCurrentUser();
  if (!canAccessDeviceRenderLab(user?.email)) notFound();

  const { request } = await searchParams;

  // Reopening a request the studio saved: show its brief, so the next save
  // edits what is there rather than overwriting it with blanks. Ownership is
  // checked by the service; anything it refuses simply opens an empty brief.
  let initialBrief: EditorBrief | null = null;
  let requestLabel: string | null = null;
  if (request && user) {
    try {
      const saved = await clipRequestService.getOwnedRequest(request, user.id);
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
    }
  }

  // The allowance, so the studio can say "none left — buy a package" before
  // media is picked, instead of failing at Submit. Unknown on error.
  let quota: StudioQuota | null = null;
  if (user) {
    try {
      quota = await getStudioQuota(user.id);
    } catch {
      quota = null;
    }
  }

  return (
    <>
      {/*
        Said once, at the top, because the mistake it prevents is expensive.
        This screen renders a throwaway timeline the tester assembles by hand;
        it is for comparing a phone export against a Mac Mini export, nothing
        else. A requester who treats it as the editor would be hand-building
        something the real flow already produces from their approved job, and
        would lose the storyboard, the voice, the captions and the channel
        ratios in the process.
      */}
      <StudioBanner requestsHref={ROUTES.REQUESTS} />
      <MobileVideoEditor
        requestId={request ?? null}
        requestLabel={requestLabel}
        initialBrief={initialBrief}
        quota={quota}
      />
    </>
  );
}
