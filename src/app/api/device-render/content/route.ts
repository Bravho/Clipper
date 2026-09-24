import { NextResponse } from "next/server";

import { authorizeDeviceRenderRequest } from "../_guard";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { StoryboardScene } from "@/domain/models/VideoGenerationJob";
import {
  clipRequestRepository,
  deviceRenderAttemptRepository,
  renderTaskRepository,
  videoGenerationJobRepository,
} from "@/repositories/index";
import { readDeviceRatioLink } from "@/lib/mobile/deviceRatioChain";
import {
  localMediaDescriptorSchema,
  type LocalMediaDescriptor,
} from "@/lib/mobile/localMediaContract";

/**
 * GET /api/device-render/content?requestId=<id>
 *
 * What the phone studio needs to show after the media is submitted: the
 * storyboard and speaking script the pipeline wrote, and where the job is.
 *
 * WHY A ROUTE OF ITS OWN. `pipeline-status` reports the STEP, which is what the
 * request page's poller needs; the request page itself gets the CONTENT from
 * its server component. The studio is a single client screen that stays open
 * while the analysis runs, so it needs the content over HTTP — and a studio
 * reopened later needs the list of device-held originals too, so it can find
 * them in private storage again. Adding all that to `pipeline-status` would
 * make every request page's poll carry a storyboard it never reads.
 *
 * Read-only. Approving the script goes through the existing
 * `POST /api/requests/[id]/start-production`, the same call the request page's
 * approval panel makes, so there is one approval and not two.
 */

function parseStoryboard(raw: string | null | undefined): StoryboardScene[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoryboardScene[]) : null;
  } catch {
    return null;
  }
}

function parseLocalMedia(payload: Record<string, unknown> | null | undefined): LocalMediaDescriptor[] {
  const list = payload?.localMedia;
  if (!Array.isArray(list)) return [];
  const descriptors: LocalMediaDescriptor[] = [];
  for (const entry of list) {
    const parsed = localMediaDescriptorSchema.safeParse(entry);
    if (parsed.success) descriptors.push(parsed.data);
  }
  return descriptors;
}

export async function GET(request: Request) {
  const auth = await authorizeDeviceRenderRequest();
  if (!auth.ok) return auth.response;

  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId." }, { status: 400 });
  }

  const clipRequest = await clipRequestRepository.findById(requestId);
  if (!clipRequest || clipRequest.userId !== auth.caller.userId) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const submitted = clipRequest.status !== RequestStatus.Draft;
  const job = await videoGenerationJobRepository.findByRequestId(requestId);

  if (!job) {
    return NextResponse.json(
      { submitted, jobId: null, currentStep: null, failedAtStep: null, contentApproved: false,
        storyboard: null, script: null, voice: null, localMedia: [], outputs: [], phoneParts: [],
        chain: null },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  // Once approved, the approved_* columns are the truth; before that, the
  // generated ones are what the requester is being asked to review.
  const contentApproved = Boolean(job.contentApprovedBy);
  const storyboard = parseStoryboard(
    contentApproved ? (job.approvedStoryboard ?? job.storyboard) : job.storyboard
  );
  const hasScript =
    job.currentStep !== VideoGenerationStep.AnalyzingContent &&
    Boolean(job.scriptThai || job.approvedScriptThai);

  // The finished, captioned videos — one per channel shape — played in the
  // studio's Render and Channels steps through the request's own stream route.
  const captioned: [string, string | null | undefined][] = [
    ["9:16", job.captionedExport_9_16_assetId],
    ["16:9", job.captionedExport_16_9_assetId],
    ["1:1", job.captionedExport_1_1_assetId],
    ["4:5", job.captionedExport_4_5_assetId],
  ];
  // Which of them a phone actually made. A video the phone uploaded is the
  // result of one of this request's device attempts; anything else came from
  // the server's worker — which, for a request whose clips never left the
  // phone, can only have worked from their poster frames. Saying so plainly is
  // what turns "the clips look like still photos" into a diagnosis.
  const attempts = await deviceRenderAttemptRepository.listByRequest(requestId).catch(() => []);
  const phoneMade = new Map(
    attempts
      .filter((attempt) => attempt.resultAssetId)
      .map((attempt) => [attempt.resultAssetId as string, attempt])
  );
  const outputs = captioned
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([ratio, assetId]) => {
      const attempt = phoneMade.get(assetId);
      return {
        ratio,
        assetId,
        url: `/api/requests/${requestId}/stream?assetId=${encodeURIComponent(assetId)}`,
        madeOn: attempt ? ("phone" as const) : ("server" as const),
        platform: attempt?.platform ?? null,
      };
    });
  // Every part a phone finished for this request, oldest first.
  const phoneParts = attempts
    .filter((attempt) => attempt.resultAssetId)
    .map((attempt) => ({
      stage: attempt.stage,
      ratio: attempt.ratio,
      platform: attempt.platform,
      appVersion: attempt.appVersion,
      finishedAt: attempt.updatedAt,
    }));

  // Which extra shape the phone is on, while the Channels step is rendering.
  const activeTask = await renderTaskRepository.findActiveByJob(job.id).catch(() => null);
  const link = activeTask ? readDeviceRatioLink(activeTask.payload) : null;
  const chain = link ? { ratio: link.ratio, stage: link.stage, queue: link.queue } : null;

  return NextResponse.json(
    {
      submitted,
      jobId: job.id,
      currentStep: job.currentStep,
      failedAtStep: job.failedAtStep ?? null,
      contentApproved,
      storyboard,
      phoneParts,
      script: hasScript
        ? {
            // Named "Thai" for history; it is written in the request's content
            // language, whatever that is.
            text: (contentApproved ? job.approvedScriptThai : null) ?? job.scriptThai ?? "",
            english: (contentApproved ? job.approvedScriptEnglish : null) ?? job.scriptEnglish ?? "",
            caption: (contentApproved ? job.approvedCaptionThai : null) ?? job.captionThai ?? "",
            captionEnglish:
              (contentApproved ? job.approvedCaptionEnglish : null) ?? job.captionEnglish ?? "",
            captionChinese:
              (contentApproved ? job.approvedCaptionChinese : null) ?? job.captionChinese ?? "",
          }
        : null,
      // The generated voice, once there is one: where to play it (the request
      // page's own authenticated stream) and how long it runs — the length the
      // storyboard has to cover before the scene-design gate will accept it.
      voice: job.processedVoiceAssetId
        ? {
            assetId: job.processedVoiceAssetId,
            url: `/api/requests/${requestId}/stream?assetId=${encodeURIComponent(job.processedVoiceAssetId)}`,
            durationSeconds: job.voiceDurationSeconds ?? null,
          }
        : null,
      localMedia: parseLocalMedia(job.renderPayload ?? null),
      outputs,
      chain,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
