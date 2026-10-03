import { randomUUID } from "crypto";
import { HeadObjectCommand } from "@aws-sdk/client-s3";

import {
  clipRequestRepository,
  deviceRenderAttemptRepository,
  renderTaskRepository,
  uploadedAssetRepository,
  videoGenerationJobRepository,
} from "@/repositories/index";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { Platform, PLATFORM_ASPECT_RATIOS } from "@/domain/enums/Platform";
import { RenderStep, isRenderStep } from "@/domain/enums/RenderStep";
import { DEVICE_RENDER, isDeviceEligibleStep } from "@/config/deviceRender";
import { getTemplate } from "@/config/motionTemplates";
import { spacesClient, spacesPublicUrl, spacesSignedUrl, SPACES_BUCKET } from "@/lib/spaces";
import { buildFinalClipKey, buildThumbnailKey } from "@/lib/spacesKeys";
import {
  assessDeviceRenderEligibility,
  type DeviceRenderCapabilities,
} from "@/lib/mobile/deviceRenderEligibility";
import {
  DEVICE_RENDER_CONTRACT_VERSION,
  isAcceptedManifestVersion,
  type DeviceRenderManifest,
  type DeviceRenderRatio,
  type DeviceRenderStage,
} from "@/lib/mobile/deviceRenderContract";
import {
  buildDeviceRenderManifest,
  type ManifestCaptionInput,
} from "@/lib/mobile/deviceRenderManifestBuilder";
import type { CaptionLanguage } from "@/lib/mobile/deviceRenderCaptions";
import type { DeviceRenderAttempt } from "@/domain/models/DeviceRenderAttempt";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import type { RenderTask } from "@/domain/models/RenderTask";
import { readDeviceRatioLink, type DeviceRatioLink } from "@/lib/mobile/deviceRatioChain";
import { canRenderFromSources } from "@/lib/mobile/deviceRenderPluginVersion";

/**
 * Phone rendering, server side: the lease, the manifest, the upload
 * authorisation, the verification and the one-and-only-once completion.
 *
 * WHAT NEVER MOVES. Gemini analysis, ElevenLabs generation, approvals, credits,
 * publishing and the authoritative `VideoGenerationJob` stay here. A device is
 * given a validated description of work already approved, and hands back bytes
 * this service verifies before they become anything a requester can see.
 *
 * FALLBACK IS THE DEFAULT, NOT THE EXCEPTION. Every refusal path in this file
 * leaves the render task exactly where it was — queued, in the same position,
 * with the same priority — so the Mac Mini worker picks it up on its next scan.
 * A phone that cannot render is a phone that renders nothing, never a job that
 * stalls.
 */

export class DeviceRenderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = "DeviceRenderError";
  }
}

export interface DeviceRenderClaimInput {
  requestId: string;
  userId: string;
  capabilities: DeviceRenderCapabilities;
  appVersion?: string | null;
}

export interface DeviceRenderClaimResult {
  attemptId: string;
  manifest: DeviceRenderManifest;
  heartbeatSeconds: number;
}

/** Why a device was NOT given work. Always paired with "the worker will do it". */
export interface DeviceRenderRefusal {
  claimed: false;
  reason: string;
}

export interface DeviceRenderCompletionInput {
  attemptId: string;
  userId: string;
  jobId: string;
  step: string;
  stage: DeviceRenderStage;
  ratio: DeviceRenderRatio;
  manifestVersion: number;
  storageKey: string;
  coverStorageKey?: string | null;
  fileSizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  hasAudioTrack: boolean;
}

export interface DeviceRenderCompletionResult {
  ok: true;
  assetId: string | null;
  firstCompletion: boolean;
  nextStep: string | null;
}

export class DeviceRenderService {
  /**
   * What a phone would be asked to do for this request right now.
   *
   * Read-only and side-effect free, so the editor can show an honest state —
   * "your phone can render this", "the queue is ahead of you", "this step runs
   * on the server" — without taking a lease it might not use.
   */
  async describeAvailableWork(
    requestId: string,
    userId: string
  ): Promise<{
    available: boolean;
    reason?: string;
    step?: string;
    stage?: DeviceRenderStage;
    ratio?: DeviceRenderRatio;
    /** The step was being rendered on a phone that stopped (app closed); resuming restarts it. */
    interrupted?: boolean;
    /** A phone's claim has gone quiet; it can be resumed in about this many seconds. */
    resumeInSeconds?: number;
  }> {
    if (!DEVICE_RENDER.enabled) {
      return { available: false, reason: "device_rendering_disabled" };
    }
    const request = await clipRequestRepository.findById(requestId);
    if (!request || request.userId !== userId) {
      return { available: false, reason: "request_not_found" };
    }
    const task = await renderTaskRepository.findActiveByRequest(requestId);
    if (!task) return { available: false, reason: "no_render_queued" };
    let interrupted = false;
    if (task.state !== "queued") {
      const lapse = deviceClaimLapse(task);
      if (lapse === null) return { available: false, reason: "already_rendering" };
      if (lapse > 0) {
        return { available: false, reason: "already_rendering", resumeInSeconds: lapse };
      }
      interrupted = true;
    }
    // A device-only task is this phone's work by construction — its footage is
    // here and nowhere else — so the eligible-step allowlist, which exists to
    // limit what a phone may opportunistically take off the worker, does not
    // apply to it.
    if (!task.deviceOnly && !isDeviceEligibleStep(task.step)) {
      return { available: false, reason: "step_runs_on_server", step: task.step };
    }
    const stage = stageForTask(task);
    const ratio = await this._ratioForTask(task);
    return {
      available: true,
      step: task.step,
      stage,
      ratio,
      ...(interrupted ? { interrupted: true } : {}),
    };
  }

  /**
   * Claim the request's queued render step for this device and hand back the
   * manifest to render.
   *
   * Refusals are returned, not thrown, for everything that is a normal "not
   * this time" — no work queued, a worker already has it, the device is not up
   * to the job. Only a genuine authorisation failure throws.
   */
  async claim(
    input: DeviceRenderClaimInput
  ): Promise<DeviceRenderClaimResult | DeviceRenderRefusal> {
    if (!DEVICE_RENDER.enabled) {
      return { claimed: false, reason: "device_rendering_disabled" };
    }

    const request = await clipRequestRepository.findById(input.requestId);
    if (!request) throw new DeviceRenderError("Request not found.", "request_not_found", 404);
    if (request.userId !== input.userId) {
      // Deliberately a 404: a requester should not be able to probe which
      // request ids exist by watching the status code change.
      throw new DeviceRenderError("Request not found.", "request_not_found", 404);
    }

    let task = await renderTaskRepository.findActiveByRequest(input.requestId);
    if (!task) return { claimed: false, reason: "no_render_queued" };
    if (task.state !== "queued") {
      // A phone that was closed mid-render never released its claim, and a
      // device-only task is never reclaimed by the worker. Once that claim has
      // gone quiet, its own requester takes it back: this is "Resume".
      if (deviceClaimLapse(task) !== 0) return { claimed: false, reason: "already_rendering" };
      const previous = task.claimedBy!;
      const released = await renderTaskRepository.releaseClaim(task.id, previous);
      if (released) {
        await deviceRenderAttemptRepository
          .update(previous, { state: "expired" })
          .catch(() => null);
        console.log(
          `[device-render] request ${input.requestId}: resuming ${task.step} after interrupted attempt ${previous}`
        );
      }
      task = await renderTaskRepository.findActiveByRequest(input.requestId);
      if (!task) return { claimed: false, reason: "no_render_queued" };
      if (task.state !== "queued") return { claimed: false, reason: "already_rendering" };
    }
    if (!isRenderStep(task.step)) {
      return { claimed: false, reason: "step_runs_on_server" };
    }
    if (!task.deviceOnly && !isDeviceEligibleStep(task.step)) {
      return { claimed: false, reason: "step_runs_on_server" };
    }

    const job = await videoGenerationJobRepository.findById(task.jobId);
    if (!job) return { claimed: false, reason: "job_not_found" };

    // A device-only task claimed by a build that can compose from the originals
    // gets its master or final as ONE encode from them (see `_planFor`). For an
    // extra channel shape that also makes the chain's silent montage pointless,
    // so that link is handed out as the shape's master straight away.
    const link = chainLinkOf(task);
    const fromSources =
      task.deviceOnly && canRenderFromSources(input.capabilities.nativePluginVersion);
    const stage: DeviceRenderStage =
      fromSources && link?.stage === "montage" ? "master" : stageForTask(task);
    const ratio = await this._ratioForTask(task, request.targetPlatforms ?? []);

    // Gather the inputs BEFORE taking the lease. A claim we then have to
    // release because a master is missing costs the requester a queue position
    // for nothing.
    let plan: Awaited<ReturnType<DeviceRenderService["_planFor"]>>;
    try {
      plan = await this._planFor(job, stage, ratio, link, fromSources);
    } catch (err) {
      console.log(
        `[device-render] request ${input.requestId}: not offering ${task.step} to a device — ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return { claimed: false, reason: "inputs_unavailable" };
    }

    const eligibility = assessDeviceRenderEligibility(input.capabilities, {
      totalInputBytes: plan.estimatedInputBytes,
      estimatedOutputBytes: plan.estimatedOutputBytes,
      durationSeconds: plan.durationSeconds,
      width: plan.width,
      height: plan.height,
      fps: 30,
    });
    if (!eligibility.eligible) {
      return { claimed: false, reason: eligibility.reason };
    }

    const attemptId = `dev_${randomUUID()}`;
    const claimed = await renderTaskRepository.claimForDevice(
      task.id,
      input.userId,
      attemptId,
      DEVICE_RENDER.eligibleSteps
    );
    // A worker claim always wins the race: `claimForDevice` only transitions a
    // row that is still 'queued'.
    if (!claimed) return { claimed: false, reason: "already_rendering" };

    const leaseExpiresAt = new Date(Date.now() + DEVICE_RENDER.leaseSeconds * 1000);
    const uploadStorageKey = buildFinalClipKey(request.userId, request.id, ratio);

    try {
      await deviceRenderAttemptRepository.create({
        id: attemptId,
        taskId: task.id,
        jobId: job.id,
        requestId: request.id,
        requesterId: request.userId,
        step: task.step as RenderStep,
        ratio,
        stage,
        travy: false,
        manifestVersion: DEVICE_RENDER_CONTRACT_VERSION,
        platform: input.capabilities.platform,
        appVersion: input.appVersion ?? null,
        uploadStorageKey,
        uploadId: null,
        leaseExpiresAt,
      });

      const manifest = buildDeviceRenderManifest({
        attemptId,
        taskId: task.id,
        jobId: job.id,
        requestId: request.id,
        step: task.step,
        stage,
        ratio,
        sources: plan.sources,
        scenes: plan.scenes,
        inputVideoUrl: plan.inputVideoUrl,
        voiceUrl: plan.voiceUrl,
        musicUrl: plan.musicUrl,
        voiceDurationSeconds: job.voiceDurationSeconds,
        captions: plan.captions,
        captionLanguages: plan.captionLanguages,
        musicSelected: plan.musicSelected,
        template: plan.template,
        buildFromSources: plan.buildFromSources,
        upload: null,
        leaseExpiresAt,
        maxOutputBytes: DEVICE_RENDER.maxOutputBytes,
      });

      return {
        attemptId,
        manifest,
        heartbeatSeconds: DEVICE_RENDER.heartbeatSeconds,
      };
    } catch (err) {
      // Anything that goes wrong after the claim must put the task back, or the
      // requester waits out a whole lease for a render nobody is doing.
      await renderTaskRepository.releaseClaim(task.id, attemptId).catch(() => false);
      await deviceRenderAttemptRepository
        .update(attemptId, { state: "failed", error: errorText(err) })
        .catch(() => null);
      console.error(`[device-render] claim ${attemptId} failed after claiming:`, err);
      return { claimed: false, reason: "manifest_unavailable" };
    }
  }

  /**
   * Heartbeat plus progress. Extends the lease only while this attempt still
   * owns the claim — a device whose work was reclaimed learns it here, on its
   * next heartbeat, rather than after finishing a render nobody wants.
   */
  async reportProgress(
    attemptId: string,
    userId: string,
    percent: number
  ): Promise<{ ok: boolean; leaseExpiresAt: string | null; cancelled: boolean }> {
    const attempt = await this._ownedAttempt(attemptId, userId);

    if (attempt.state === "completed") {
      return { ok: true, leaseExpiresAt: null, cancelled: false };
    }
    if (attempt.state !== "claimed" && attempt.state !== "uploading") {
      return { ok: false, leaseExpiresAt: null, cancelled: true };
    }

    const stillOurs = await renderTaskRepository.touchClaim(attempt.taskId, attemptId);
    if (!stillOurs) {
      // Reclaimed by the worker (or released). Mark the attempt so a later
      // completion is refused with a clear reason instead of a bare 409.
      await deviceRenderAttemptRepository.update(attemptId, { state: "expired" });
      return { ok: false, leaseExpiresAt: null, cancelled: true };
    }

    const leaseExpiresAt = new Date(Date.now() + DEVICE_RENDER.leaseSeconds * 1000);
    await deviceRenderAttemptRepository.update(attemptId, {
      progressPercent: clampPercent(percent),
      leaseExpiresAt,
    });

    // Mirror the percentage onto the job so the requester's existing progress
    // bar works unchanged whether the Mac or a phone is rendering.
    await videoGenerationJobRepository
      .update(attempt.jobId, {
        renderProgress: clampPercent(percent),
        renderProgressDetail: { unit: attempt.ratio },
      })
      .catch(() => {});

    return { ok: true, leaseExpiresAt: leaseExpiresAt.toISOString(), cancelled: false };
  }

  /**
   * Give the work back.
   *
   * Called when the user cancels, the app is about to be killed, storage runs
   * out, or the render throws. The task returns to the queue with its FIFO
   * position and priority intact (`release` preserves `enqueued_at`), so the
   * worker takes it next — the requester loses a few seconds, not their place
   * in line.
   */
  async release(
    attemptId: string,
    userId: string,
    reason: string,
    /** The phone's step-by-step log of what failed, kept with the attempt. */
    log?: string[]
  ): Promise<{ released: boolean }> {
    const attempt = await this._ownedAttempt(attemptId, userId);
    if (attempt.state === "completed") return { released: false };

    const released = await renderTaskRepository.releaseClaim(attempt.taskId, attemptId);
    await deviceRenderAttemptRepository.update(attemptId, {
      state: reason === "cancelled" ? "released" : "failed",
      error: reason.slice(0, 500),
      ...(log && log.length > 0 ? { result: { errorLog: log.slice(0, 120) } } : {}),
    });
    await videoGenerationJobRepository
      .update(attempt.jobId, { renderProgress: null, renderProgressDetail: null })
      .catch(() => {});

    console.log(
      `[device-render] attempt ${attemptId} released (${reason}); task ${attempt.taskId} ` +
        `${released ? "returned to the queue for the worker" : "was no longer ours"}`
    );
    return { released };
  }

  /**
   * Authorise the upload of a finished render.
   *
   * Minted only for the key recorded on the attempt, only while the attempt
   * still holds the claim, and only for a size within the configured cap. The
   * device cannot name its own destination.
   */
  async authorizeUpload(
    attemptId: string,
    userId: string,
    fileSizeBytes: number,
    coverBytes: number | null
  ): Promise<NonNullable<DeviceRenderManifest["upload"]>> {
    const attempt = await this._ownedAttempt(attemptId, userId);
    if (attempt.state !== "claimed" && attempt.state !== "uploading") {
      throw new DeviceRenderError("This render attempt is no longer active.", "attempt_inactive", 409);
    }
    if (!(fileSizeBytes > 0) || fileSizeBytes > DEVICE_RENDER.maxOutputBytes) {
      throw new DeviceRenderError("Rendered file size is out of range.", "bad_output_size", 422);
    }
    if (coverBytes != null && coverBytes > DEVICE_RENDER.maxCoverBytes) {
      throw new DeviceRenderError("Cover image is too large.", "bad_cover_size", 422);
    }

    const stillOurs = await renderTaskRepository.touchClaim(attempt.taskId, attemptId);
    if (!stillOurs) {
      await deviceRenderAttemptRepository.update(attemptId, { state: "expired" });
      throw new DeviceRenderError(
        "This render was taken over by the server worker.",
        "lease_lost",
        409
      );
    }

    const { uploadService, MULTIPART_PART_SIZE } = await import("@/services/UploadService");

    const created = await uploadService.createMultipartUploadForKey({
      key: attempt.uploadStorageKey,
      mimeType: "video/mp4",
    });
    const partCount = Math.max(1, Math.ceil(fileSizeBytes / MULTIPART_PART_SIZE));
    const parts = await uploadService.signUploadParts({
      key: attempt.uploadStorageKey,
      uploadId: created.uploadId,
      partCount,
    });

    // The cover is a single small JPEG — a presigned PUT, not a multipart.
    const coverStorageKey =
      coverBytes != null
        ? buildThumbnailKey(
            attempt.requesterId,
            attempt.requestId,
            `poster-${attempt.ratio.replace(":", "x")}`
          )
        : null;
    const coverUrl = coverStorageKey
      ? await uploadService.signPutUrl({ key: coverStorageKey, mimeType: "image/jpeg" })
      : null;

    await deviceRenderAttemptRepository.update(attemptId, {
      state: "uploading",
      uploadId: created.uploadId,
    });

    return {
      storageKey: attempt.uploadStorageKey,
      uploadId: created.uploadId,
      partSizeBytes: MULTIPART_PART_SIZE,
      parts,
      coverStorageKey,
      coverUrl,
      expiresAt: new Date(Date.now() + DEVICE_RENDER.leaseSeconds * 1000 + 60_000).toISOString(),
    };
  }

  /** Assemble the uploaded parts. Separate from `complete` so a failed assembly
   * is distinguishable from a failed verification in the logs and the UI. */
  async finishUpload(
    attemptId: string,
    userId: string,
    parts: { partNumber: number; eTag: string }[]
  ): Promise<{ ok: true }> {
    const attempt = await this._ownedAttempt(attemptId, userId);
    if (!attempt.uploadId) {
      throw new DeviceRenderError("No upload was authorised.", "no_upload", 409);
    }
    const { uploadService } = await import("@/services/UploadService");
    await uploadService.completeMultipartUpload({
      key: attempt.uploadStorageKey,
      uploadId: attempt.uploadId,
      parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.eTag })),
    });
    return { ok: true };
  }

  /**
   * Verify the uploaded object and, exactly once, turn it into the asset the
   * pipeline expects.
   *
   * Every field of the completion is checked against the attempt rather than
   * trusted: a device may only finish the job, step, ratio, stage and manifest
   * version it was given, writing the key it was given. Then the object itself
   * is checked — it must exist in the bucket, be big enough to be a video, be
   * the exact canvas size for its ratio, be about the right length, and carry
   * an audio track when its stage says it should.
   */
  async complete(input: DeviceRenderCompletionInput): Promise<DeviceRenderCompletionResult> {
    const attempt = await this._ownedAttempt(input.attemptId, input.userId);

    // Idempotency first: a retry must never re-verify, re-create or re-advance.
    if (attempt.state === "completed") {
      return {
        ok: true,
        assetId: attempt.resultAssetId,
        firstCompletion: false,
        nextStep: (attempt.result?.nextStep as string | undefined) ?? null,
      };
    }
    if (attempt.state === "expired" || attempt.state === "released") {
      throw new DeviceRenderError(
        "This render attempt is no longer the one the server is waiting for.",
        "attempt_superseded",
        409
      );
    }

    this._assertCompletionMatchesAttempt(attempt, input);

    // The attempt must still own the claim. If the lease lapsed and the worker
    // reclaimed the task, the worker's result is the one that counts.
    const stillOurs = await renderTaskRepository.touchClaim(attempt.taskId, attempt.id);
    if (!stillOurs) {
      await deviceRenderAttemptRepository.update(attempt.id, { state: "expired" });
      throw new DeviceRenderError(
        "This render was taken over by the server worker.",
        "lease_lost",
        409
      );
    }

    await this._verifyUploadedObject(attempt, input);

    const assetId = await this._createExportAsset(attempt, input);

    const recorded = await deviceRenderAttemptRepository.completeOnce(attempt.id, {
      resultAssetId: assetId,
      result: { assetId, ratio: attempt.ratio, stage: attempt.stage, nextStep: null },
    });
    if (!recorded) {
      throw new DeviceRenderError("Render attempt disappeared.", "attempt_not_found", 404);
    }
    if (!recorded.firstCompletion) {
      // Another retry won the race and already created an asset. Ours is a
      // duplicate object; leave it for the storage sweep rather than deleting
      // bytes we might be wrong about, and return the winner's result.
      console.warn(
        `[device-render] attempt ${attempt.id}: concurrent completion, keeping the first result`
      );
      return {
        ok: true,
        assetId: recorded.attempt.resultAssetId,
        firstCompletion: false,
        nextStep: null,
      };
    }

    // Hand the result to the pipeline, then close the claim. Order matters: the
    // job must carry its new asset before the task is marked done, because
    // `afterRenderStepCompleted` may immediately advance to the next gate.
    // The claimed task's payload carries the extra-shape chain link, when there
    // is one; it is read before the claim is closed, while it is still active.
    const activeTask = await renderTaskRepository.findActiveByJob(attempt.jobId).catch(() => null);
    const payload = activeTask && activeTask.id === attempt.taskId ? activeTask.payload : null;

    const { videoGenerationService } = await import("@/services/VideoGenerationService");
    const applied = await videoGenerationService.applyDeviceRenderResult({
      jobId: attempt.jobId,
      step: attempt.step,
      ratio: attempt.ratio,
      assetId,
      stage: attempt.stage,
      payload,
    });

    await renderTaskRepository.completeClaim(attempt.taskId, attempt.id);
    if (applied.chain) {
      // Only now that this link's task is closed may the next one be queued.
      await videoGenerationService
        .advanceDeviceRatioChain(attempt.jobId, applied.chain)
        .catch((err) => {
          console.error(`[device-render] could not continue the shape chain for job ${attempt.jobId}:`, err);
        });
    }
    await videoGenerationService.afterRenderStepCompleted(attempt.jobId).catch((err) => {
      console.error(`[device-render] post-step hook failed for job ${attempt.jobId}:`, err);
    });

    await deviceRenderAttemptRepository.update(attempt.id, {
      result: { assetId, ratio: attempt.ratio, stage: attempt.stage, nextStep: applied.nextStep },
    });

    console.log(
      `[device-render] attempt ${attempt.id} completed ${attempt.step} ${attempt.ratio} → asset ${assetId}`
    );
    return { ok: true, assetId, firstCompletion: true, nextStep: applied.nextStep };
  }

  /**
   * Sweep leases that lapsed without a release.
   *
   * A phone that was force-quit never says so. The render task's own stale-claim
   * reclaim already returns the work to the worker (`claimNext` treats a claim
   * with a cold heartbeat as available); this marks the matching attempts so a
   * late completion is refused with "superseded" rather than being allowed to
   * overwrite whatever the worker produced.
   */
  async expireLapsedAttempts(now: Date = new Date()): Promise<number> {
    const swept = await deviceRenderAttemptRepository.expireStale(now);
    if (swept > 0) console.log(`[device-render] expired ${swept} lapsed attempt(s)`);
    return swept;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async _ownedAttempt(attemptId: string, userId: string): Promise<DeviceRenderAttempt> {
    const attempt = await deviceRenderAttemptRepository.findById(attemptId);
    if (!attempt || attempt.requesterId !== userId) {
      throw new DeviceRenderError("Render attempt not found.", "attempt_not_found", 404);
    }
    return attempt;
  }

  private _assertCompletionMatchesAttempt(
    attempt: DeviceRenderAttempt,
    input: DeviceRenderCompletionInput
  ): void {
    const mismatch =
      attempt.jobId !== input.jobId ||
      attempt.step !== input.step ||
      attempt.stage !== input.stage ||
      attempt.ratio !== input.ratio ||
      attempt.uploadStorageKey !== input.storageKey;
    if (mismatch) {
      throw new DeviceRenderError(
        "This completion does not match the work that was handed out.",
        "completion_mismatch",
        409
      );
    }
    if (!isAcceptedManifestVersion(input.manifestVersion)) {
      throw new DeviceRenderError(
        "This app build renders an unsupported manifest version.",
        "unsupported_manifest_version",
        409
      );
    }
    if (
      input.coverStorageKey &&
      !input.coverStorageKey.startsWith(`thumbnails/${attempt.requesterId}/`)
    ) {
      throw new DeviceRenderError("Cover key is out of scope.", "bad_cover_key", 409);
    }
  }

  /**
   * Inspect the bytes that landed. This is the gate that stops a broken render
   * from becoming a delivered video.
   */
  private async _verifyUploadedObject(
    attempt: DeviceRenderAttempt,
    input: DeviceRenderCompletionInput
  ): Promise<void> {
    if (!SPACES_BUCKET) {
      throw new DeviceRenderError("Storage is not configured.", "storage_unavailable", 503);
    }

    let head: { ContentLength?: number; ContentType?: string };
    try {
      head = await spacesClient.send(
        new HeadObjectCommand({ Bucket: SPACES_BUCKET, Key: attempt.uploadStorageKey })
      );
    } catch {
      throw new DeviceRenderError(
        "The rendered file is not in storage.",
        "output_missing",
        422
      );
    }

    const bytes = Number(head.ContentLength ?? 0);
    if (bytes < DEVICE_RENDER.validation.minOutputBytes) {
      throw new DeviceRenderError("The rendered file is too small to be a video.", "output_too_small", 422);
    }
    if (bytes > DEVICE_RENDER.maxOutputBytes) {
      throw new DeviceRenderError("The rendered file exceeds the size limit.", "output_too_large", 422);
    }

    const ffmpegService = await import("@/lib/ai/ffmpegService");
    const summary = await ffmpegService.probeMediaSummary(
      await spacesSignedUrl(attempt.uploadStorageKey, 900)
    );

    if (!summary.hasVideo) {
      throw new DeviceRenderError("The uploaded file has no video track.", "no_video_track", 422);
    }
    if (summary.videoCodec && !/^(h264|avc1)$/i.test(summary.videoCodec)) {
      throw new DeviceRenderError(
        `The uploaded video is ${summary.videoCodec}, not H.264.`,
        "wrong_video_codec",
        422
      );
    }

    // Judge the size AS SHOWN. Android's Media3 (by default, and as a fallback
    // when a phone's encoder cannot take a portrait frame) stores a 9:16
    // video as 1920x1080 frames with a 90° rotation tag; every player shows it
    // 1080x1920. Comparing the stored size rejected correct portrait videos
    // ("The uploaded video is 1920x1080, not 1080x1920").
    const expected = expectedDimensions(attempt.ratio);
    const shownWidth = summary.displayWidth ?? summary.width;
    const shownHeight = summary.displayHeight ?? summary.height;
    if (shownWidth && shownHeight) {
      if (shownWidth !== expected.width || shownHeight !== expected.height) {
        throw new DeviceRenderError(
          `The uploaded video is ${shownWidth}x${shownHeight}` +
            (summary.rotation ? ` (stored ${summary.width}x${summary.height}, rotated ${summary.rotation}°)` : "") +
            `, not ${expected.width}x${expected.height}.`,
          "wrong_dimensions",
          422
        );
      }
    }

    if (attempt.stage !== "montage" && DEVICE_RENDER.validation.requireAudioForFinal) {
      // The single most valuable check in this method: the whole reason the
      // draft renderer could not ship was that it produced a silent file.
      if (!summary.hasAudio) {
        throw new DeviceRenderError(
          "The uploaded export is silent; it must carry the approved voice.",
          "silent_output",
          422
        );
      }
      if (summary.audioCodec && !/^aac$/i.test(summary.audioCodec)) {
        throw new DeviceRenderError(
          `The uploaded audio is ${summary.audioCodec}, not AAC.`,
          "wrong_audio_codec",
          422
        );
      }
    }

    if (
      input.durationSeconds > 0 &&
      summary.durationSeconds > 0 &&
      Math.abs(summary.durationSeconds - input.durationSeconds) >
        DEVICE_RENDER.validation.durationToleranceSeconds
    ) {
      throw new DeviceRenderError(
        "The uploaded video is not the length the device reported.",
        "duration_mismatch",
        422
      );
    }

    if (input.coverStorageKey) {
      try {
        const cover = await spacesClient.send(
          new HeadObjectCommand({ Bucket: SPACES_BUCKET, Key: input.coverStorageKey })
        );
        const coverBytes = Number(cover.ContentLength ?? 0);
        if (coverBytes <= 0 || coverBytes > DEVICE_RENDER.maxCoverBytes) {
          throw new Error("cover out of range");
        }
      } catch {
        // A missing cover is not worth discarding a finished render over; the
        // server generates one from the verified video instead.
        console.warn(
          `[device-render] attempt ${attempt.id}: cover ${input.coverStorageKey} unusable, falling back to server extraction`
        );
        input.coverStorageKey = null;
      }
    }
  }

  private async _createExportAsset(
    attempt: DeviceRenderAttempt,
    input: DeviceRenderCompletionInput
  ): Promise<string> {
    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    const asset = await uploadedAssetRepository.create({
      requestId: attempt.requestId,
      userId: attempt.requesterId,
      fileName: `${attempt.stage}_${attempt.ratio.replace(":", "-")}.mp4`,
      assetType:
        attempt.stage === "montage" ? AssetType.AIGeneratedBaseVideo : AssetType.FinalClip,
      fileSizeBytes: input.fileSizeBytes,
      mimeType: "video/mp4",
      storageKey: attempt.uploadStorageKey,
      storageUrl: spacesPublicUrl(attempt.uploadStorageKey),
      thumbnailKey: input.coverStorageKey ?? "",
      thumbnailUrl: input.coverStorageKey ? spacesPublicUrl(input.coverStorageKey) : "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt,
      videoRatio: attempt.ratio,
    });

    // `ensureAssetPoster` is idempotent and never throws: when the device gave
    // us a verified cover this returns it untouched, and when it did not, the
    // poster is extracted here from the video we have just verified. Either way
    // the poster comes from the finished export, never from a source photo.
    const { ensureAssetPoster } = await import("@/services/AssetPosterService");
    await ensureAssetPoster(asset.id, `poster-${attempt.ratio.replace(":", "x")}`);

    return asset.id;
  }

  /** The canvas a task renders at: the request's primary channel ratio. */
  private async _ratioForTask(
    task: RenderTask,
    platforms?: Platform[]
  ): Promise<DeviceRenderRatio> {
    const resolved =
      platforms ?? (await clipRequestRepository.findById(task.requestId))?.targetPlatforms ?? [];
    const payloadRatio = (task.payload as { ratio?: unknown } | null)?.ratio;
    if (typeof payloadRatio === "string" && isRatio(payloadRatio)) return payloadRatio;
    return primaryRatio(resolved[0] ?? Platform.TravyApp);
  }

  /**
   * Collect everything a stage needs from APPROVED job data. Throws when an
   * input the device cannot produce for itself is missing, which the caller
   * turns into a refusal so the worker handles the step instead.
   *
   * With `fromSources` (a device-only task claimed by plugin v6+), a master or
   * final carries the scene plan and the originals' handles instead of a
   * previous stage's export, plus everything the phone needs to mix and
   * decorate it itself: the voice, the music, the captions, the template.
   */
  private async _planFor(
    job: VideoGenerationJob,
    stage: DeviceRenderStage,
    ratio: DeviceRenderRatio,
    /** An extra channel shape's chain link (see `deviceRatioChain`), if any. */
    link: DeviceRatioLink | null = null,
    fromSources = false
  ): Promise<{
    sources: Parameters<typeof buildDeviceRenderManifest>[0]["sources"];
    scenes: Parameters<typeof buildDeviceRenderManifest>[0]["scenes"];
    inputVideoUrl: string | null;
    voiceUrl: string | null;
    musicUrl: string | null;
    musicSelected: boolean;
    captions: ManifestCaptionInput[];
    captionLanguages: CaptionLanguage[];
    template: Parameters<typeof buildDeviceRenderManifest>[0]["template"];
    estimatedInputBytes: number;
    estimatedOutputBytes: number;
    durationSeconds: number;
    width: number;
    height: number;
    buildFromSources: boolean;
  }> {
    const dimensions = expectedDimensions(ratio);
    const template = getTemplate(job.selectedMotionTemplate);
    // The same palette the server's styled render uses — derived from the
    // place, the matching business profile and the approved script — so a
    // template's accents are the colours the Mac would have drawn.
    const { videoGenerationService } = await import("@/services/VideoGenerationService");
    const palette = await videoGenerationService.deriveOverlayPaletteForJob(job);

    const musicSelected = Boolean(job.selectedMusicTrack);
    const voiceDuration = job.voiceDurationSeconds ?? 15;
    const leadIn = musicSelected ? 0.6 : 0;
    const buildFromSources = fromSources && stage !== "montage";

    const templateSpec = {
      id: template.id,
      frame: template.frame,
      canvas: template.canvas,
      decor: template.decor,
      palette,
    };

    const languages =
      job.subtitleLanguages && job.subtitleLanguages.length > 0
        ? (job.subtitleLanguages as CaptionLanguage[])
        : (["en", "zh"] as CaptionLanguage[]);

    if (stage === "final" && !buildFromSources) {
      const masterAssetId = masterAssetIdForRatio(job, ratio);
      if (!masterAssetId) {
        // `_renderCaptionedRatio` self-heals this on the worker by composing the
        // master on demand. A phone cannot compose one from media the server
        // holds, and for a device-rendered job the worker cannot either — so
        // either way the honest answer is "not yet", and the caller turns that
        // into a refusal rather than a wrong render.
        throw new Error(`no merged master for ${ratio}`);
      }
      const master = await uploadedAssetRepository.findById(masterAssetId);
      if (!master?.storageKey) throw new Error(`master asset ${masterAssetId} has no object`);

      return {
        sources: [],
        scenes: [],
        inputVideoUrl: await spacesSignedUrl(master.storageKey, DEVICE_RENDER.leaseSeconds + 600),
        voiceUrl: null,
        musicUrl: null,
        musicSelected,
        captions: await this._captionCues(job),
        captionLanguages: languages,
        template: templateSpec,
        estimatedInputBytes: master.fileSizeBytes || 60_000_000,
        estimatedOutputBytes: (master.fileSizeBytes || 60_000_000) * 1.3,
        durationSeconds: voiceDuration + leadIn,
        width: dimensions.width,
        height: dimensions.height,
        buildFromSources: false,
      };
    }

    // The montage — and a master or final composed from the originals — needs
    // the approved scene plan and the material it points at.
    const { getOrderedSourceAssets } = await import("@/lib/sourceAssets");
    const ordered = await getOrderedSourceAssets(job.requestId);
    const { sanitizeScenePlanDescriptions } = await import("@/lib/ai/scenePlanSanitizer");
    const scenePlan = sanitizeScenePlanDescriptions(
      JSON.parse(job.approvedScenePlan ?? job.scenePlan ?? "[]")
    );

    // A device-held asset is named by its handle and never given a URL: the
    // only URL it has points at a poster frame, and a renderer handed that
    // would animate a still where moving footage belongs. The manifest contract
    // enforces the either/or, so a mistake here fails validation rather than
    // silently shipping the wrong picture.
    const sources = await Promise.all(
      ordered.map(async (asset) =>
        asset.localId
          ? {
              assetId: asset.id,
              kind: asset.kind,
              localId: asset.localId,
              mimeType: asset.kind === "clip" ? "video/mp4" : "image/jpeg",
              durationSeconds: asset.durationSeconds ?? null,
            }
          : {
              assetId: asset.id,
              kind: asset.kind,
              url: await spacesSignedUrlForPublic(asset.url),
              mimeType: asset.kind === "clip" ? "video/mp4" : "image/jpeg",
              durationSeconds: asset.durationSeconds ?? null,
            }
      )
    );

    const scenes = scenePlan.map((scene, index) => ({
      sceneNumber: scene.sceneNumber ?? index,
      transitionIn: scene.transitionIn ?? null,
      assets: (scene.assets ?? []).map((shot) => ({
        sourceAssetId: ordered[shot.assetIndex]?.id ?? "",
        durationSeconds: shot.durationSeconds,
        motion: shot.motion,
        trimStartSeconds: shot.trimStartSeconds ?? null,
        trimEndSeconds: shot.trimEndSeconds ?? null,
        focusX: shot.focusX ?? null,
        focusY: shot.focusY ?? null,
        frameZoom: shot.frameZoom ?? null,
      })),
    }));

    let inputVideoUrl: string | null = null;
    let voiceUrl: string | null = null;
    let musicUrl: string | null = null;

    if (stage === "master" && !buildFromSources) {
      // An extra shape merges ITS OWN montage, rendered at its own canvas by
      // the previous link; the first shape merges the approved base video.
      const baseAssetId = link?.baseAssetId ?? job.baseVideoAssetId;
      if (!baseAssetId) throw new Error("no approved montage to merge");
      const base = await uploadedAssetRepository.findById(baseAssetId);
      if (!base?.storageKey) throw new Error("approved montage has no object");
      inputVideoUrl = await spacesSignedUrl(base.storageKey, DEVICE_RENDER.leaseSeconds + 600);
    }

    if (stage === "master" || buildFromSources) {
      if (!job.processedVoiceAssetId) throw new Error("no approved voice");
      const voice = await uploadedAssetRepository.findById(job.processedVoiceAssetId);
      if (!voice?.storageKey) throw new Error("approved voice has no object");
      voiceUrl = await spacesSignedUrl(voice.storageKey, DEVICE_RENDER.leaseSeconds + 600);

      // Music is a static asset shipped with the app's public folder, not a
      // per-request object, so it is a plain public URL.
      musicUrl = job.selectedMusicTrack
        ? `${appOrigin()}/music/${job.selectedMusicTrack}.mp3`
        : null;
    }

    const isFinal = stage === "final";
    const estimatedInputBytes = sources.length * 8_000_000;
    return {
      sources,
      scenes,
      inputVideoUrl,
      voiceUrl,
      musicUrl,
      musicSelected,
      captions: isFinal ? await this._captionCues(job) : [],
      captionLanguages: isFinal ? languages : [],
      template: templateSpec,
      estimatedInputBytes,
      estimatedOutputBytes: 60_000_000,
      durationSeconds: voiceDuration + leadIn,
      width: dimensions.width,
      height: dimensions.height,
      buildFromSources,
    };
  }

  /**
   * Caption cues in VOICE time — the builder applies the lead-in shift, so this
   * must NOT apply it too. Split for display first, exactly as
   * `_buildOverlayInputs` does, or the phone wraps long sentences differently
   * from the Mac.
   */
  private async _captionCues(job: VideoGenerationJob): Promise<ManifestCaptionInput[]> {
    const raw = job.subtitleTimeline ?? job.voiceTimestamps;
    if (!raw) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    const languages =
      job.subtitleLanguages && job.subtitleLanguages.length > 0
        ? job.subtitleLanguages
        : (["en", "zh"] as ("th" | "en" | "zh")[]);

    const { splitSegmentsForDisplay } = await import("@/lib/ai/geminiSubtitlesService");
    const request = await clipRequestRepository.findById(job.requestId);
    const protectedPhrases = request?.placeName ? [request.placeName] : [];

    return splitSegmentsForDisplay(parsed, languages, protectedPhrases).map((segment) => ({
      startSecond: segment.startSecond,
      endSecond: segment.endSecond,
      textThai: segment.textThai,
      textEnglish: segment.textEnglish,
      textChinese: segment.textChinese ?? "",
    }));
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function isRatio(value: string): value is DeviceRenderRatio {
  return value === "9:16" || value === "16:9" || value === "1:1" || value === "4:5";
}

function primaryRatio(platform: Platform): DeviceRenderRatio {
  const raw = PLATFORM_ASPECT_RATIOS[platform];
  return isRatio(raw) ? raw : "9:16";
}

function expectedDimensions(ratio: DeviceRenderRatio): { width: number; height: number } {
  switch (ratio) {
    case "16:9": return { width: 1920, height: 1080 };
    case "1:1": return { width: 1080, height: 1080 };
    case "4:5": return { width: 1080, height: 1350 };
    default: return { width: 1080, height: 1920 };
  }
}

/** The extra-shape chain link a task carries, if it is one. */
function chainLinkOf(task: Pick<RenderTask, "step" | "payload">): DeviceRatioLink | null {
  return task.step === RenderStep.AdditionalRatios ? readDeviceRatioLink(task.payload) : null;
}

/**
 * Which stage a queued task is. A phone-rendered request's extra shape is an
 * `AdditionalRatios` task that names its own stage (montage, master or final);
 * every other task's stage follows from its step.
 */
export function stageForTask(task: Pick<RenderTask, "step" | "payload">): DeviceRenderStage {
  return chainLinkOf(task)?.stage ?? stageForStep(task.step);
}

/** Which stage of the parity contract a queued render step corresponds to. */
export function stageForStep(step: string): DeviceRenderStage {
  switch (step) {
    case RenderStep.MontageSceneSegment:
    case RenderStep.MontageAllSegments:
    case RenderStep.MontageMerge:
      return "montage";
    case RenderStep.FfmpegComposition:
      return "master";
    default:
      return "final";
  }
}

function masterAssetIdForRatio(job: VideoGenerationJob, ratio: DeviceRenderRatio): string | null {
  switch (ratio) {
    case "9:16": return job.finalExport_9_16_assetId ?? null;
    case "16:9": return job.finalExport_16_9_assetId ?? null;
    case "1:1": return job.finalExport_1_1_assetId ?? null;
    case "4:5": return job.finalExport_4_5_assetId ?? null;
    default: return null;
  }
}

/**
 * Source material is written public-read today, so its `storageUrl` is already
 * fetchable. Signing it anyway would be a lie about the privacy we provide;
 * passing it through keeps the manifest honest about what it hands out, and
 * leaves one place to change when those prefixes go private.
 */
async function spacesSignedUrlForPublic(url: string): Promise<string> {
  return url;
}

function appOrigin(): string {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
}

export const deviceRenderService = new DeviceRenderService();

/**
 * For a task claimed by a PHONE, how many seconds until that claim counts as
 * abandoned: 0 once it already has (the app that held it was closed or stopped
 * heartbeating), a positive number while it is still inside the grace window.
 * Null when the task is not a phone's claim — a worker's claim is never taken
 * over from here.
 */
export function deviceClaimLapse(task: RenderTask, now: number = Date.now()): number | null {
  if (task.state !== "claimed" || !task.claimedBy?.startsWith("dev_")) return null;
  const lastSeen = (task.heartbeatAt ?? task.claimedAt)?.getTime();
  if (lastSeen == null) return 0;
  const left = Math.ceil((lastSeen + DEVICE_RENDER.resumeAfterSeconds * 1000 - now) / 1000);
  return Math.max(0, left);
}
