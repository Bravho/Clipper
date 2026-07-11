import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { ROUTES } from "@/config/routes";
import { clipRequestService } from "@/services/ClipRequestService";
import { requestPresentationService } from "@/services/RequestPresentationService";
import {
  uploadedAssetRepository,
  publishingLinkRepository,
  requestStatusHistoryRepository,
  videoGenerationJobRepository,
} from "@/repositories";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Platform, PLATFORM_ASPECT_RATIOS, PLATFORM_LABELS } from "@/domain/enums/Platform";
import { Card } from "@/components/ui/Card";
import { RequestStatusBadge } from "@/features/requests/components/RequestStatusBadge";
import { DueDateDisplay } from "@/features/requests/components/DueDateDisplay";
import { DeliveryLinks } from "@/features/requests/components/DeliveryLinks";
import { UnlockDownloadPanel } from "@/features/requests/components/UnlockDownloadPanel";
import { CREDITS_CONFIG } from "@/config/credits";
import { RequestTimeline } from "@/features/requests/components/RequestTimeline";
import { PipelineSection } from "@/features/requests/components/PipelineSection";
import { PipelineFailurePanel } from "@/features/requests/components/PipelineFailurePanel";
import { ContentApprovalPanel } from "@/features/requests/components/ContentApprovalPanel";
import {
  SceneDesignApprovalPanel,
  SceneDesignGeneratingPanel,
} from "@/features/requests/components/SceneDesignApprovalPanel";
import { SceneScriptApprovalPanel } from "@/features/requests/components/SceneScriptApprovalPanel";
import { VideoApprovalPanel } from "@/features/requests/components/VideoApprovalPanel";
import { DistributionReviewPanel } from "@/features/requests/components/DistributionReviewPanel";
import { RetentionNoteText } from "@/features/requests/components/RetentionNoteText";
import {
  finalClipAvailabilityNote,
  inactivityNote,
  uploadedMaterialsNote,
} from "@/lib/retentionNotes";
import { AnalyzeButton } from "@/features/requests/components/AnalyzeButton";
import { StoryboardView } from "@/features/requests/components/StoryboardView";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { orderSourceAssets } from "@/lib/sourceAssets";
import type { ScenePlan, StoryboardScene } from "@/domain/models/VideoGenerationJob";

export const metadata: Metadata = { title: "Request Detail — RClipper" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireRole(Role.Requester);

  // Load request — returns 404 if not found or not owned by user
  let request;
  try {
    request = await clipRequestService.getOwnedRequest(id, user.id);
  } catch {
    notFound();
  }

  // Load supporting data in parallel
  const [assets, publishingLinks, statusHistory, pipelineJob] = await Promise.all([
    uploadedAssetRepository.findByRequestId(id),
    publishingLinkRepository.findByRequestId(id),
    requestStatusHistoryRepository.findByRequestId(id),
    videoGenerationJobRepository.findByRequestId(id),
  ]);

  const baseVideoAsset = pipelineJob?.baseVideoAssetId
    ? assets.find((a) => a.id === pipelineJob.baseVideoAssetId) ?? null
    : null;

  // All rendered per-scene segments, in scene order, for the combined review
  // (each scene video is shown + revised individually before "Approve all").
  const sceneVideos = (pipelineJob?.sceneVideoAssetIds ?? [])
    .map((assetId, index) => {
      if (!assetId) return null;
      const asset = assets.find((a) => a.id === assetId);
      if (!asset?.storageUrl) return null;
      return { sceneNumber: index + 1, sceneIndex: index, url: asset.storageUrl, assetId: asset.id };
    })
    .filter(
      (v): v is { sceneNumber: number; sceneIndex: number; url: string; assetId: string } =>
        v !== null
    );

  // Latest generated cumulative video, derived independently of the current
  // step. Prefer the most recent completed per-scene cumulative asset; fall
  // back to the active baseVideoAssetId. Used to show the previously approved
  // video on the next scene's script gate.
  const latestSceneVideoAssetId =
    pipelineJob?.sceneVideoAssetIds?.filter((id): id is string => Boolean(id)).pop() ?? null;
  const latestVideoAsset =
    (latestSceneVideoAssetId
      ? assets.find((a) => a.id === latestSceneVideoAssetId) ?? null
      : null) ?? baseVideoAsset;

  const voiceRecordingAsset = pipelineJob?.processedVoiceAssetId
    ? assets.find((a) => a.id === pipelineJob.processedVoiceAssetId) ?? null
    : null;

  const animatedVideoAsset = pipelineJob?.animatedVideoAssetId
    ? assets.find((a) => a.id === pipelineJob.animatedVideoAssetId) ?? null
    : null;

  // Only the CURRENT job's exports — not every FinalClip ever produced for this
  // request. Building from the job's finalExport_* ids (deduped) prevents stale
  // clips from earlier compose runs (wrong ratios / silent older renders) from
  // showing up in the review UI.
  const finalExportAssetIds = Array.from(
    new Set(
      [
        pipelineJob?.finalExport_9_16_assetId,
        pipelineJob?.finalExport_16_9_assetId,
        pipelineJob?.finalExport_1_1_assetId,
        pipelineJob?.finalExport_4_5_assetId,
        pipelineJob?.finalExport_tvent_assetId,
      ].filter((id): id is string => !!id)
    )
  );
  const finalClips = finalExportAssetIds
    .map((id) => assets.find((a) => a.id === id))
    .filter(
      (a): a is NonNullable<typeof a> =>
        !!a &&
        a.assetType === AssetType.FinalClip &&
        a.uploadStatus === AssetUploadStatus.Uploaded
    );

  // The base + final review use the PRIMARY distribution channel's aspect ratio
  // (targetPlatforms[0]); the final review shows only this ratio (no selector).
  const primaryPlatform = (request.targetPlatforms?.[0] as Platform) ?? Platform.TventApp;
  const primaryRatio = PLATFORM_ASPECT_RATIOS[primaryPlatform] ?? null;

  // Phase 7 — captioned primary-ratio preview (overlay review step) + Travy clip.
  const captionedPrimaryAssetId =
    primaryRatio === "9:16" ? pipelineJob?.captionedExport_9_16_assetId
    : primaryRatio === "16:9" ? pipelineJob?.captionedExport_16_9_assetId
    : primaryRatio === "1:1" ? pipelineJob?.captionedExport_1_1_assetId
    : primaryRatio === "4:5" ? pipelineJob?.captionedExport_4_5_assetId
    : null;
  const overlayPreviewUrl = captionedPrimaryAssetId
    ? assets.find((a) => a.id === captionedPrimaryAssetId)?.storageUrl ?? null
    : null;
  const tventClipUrl = pipelineJob?.finalExport_tvent_assetId
    ? assets.find((a) => a.id === pipelineJob.finalExport_tvent_assetId)?.storageUrl ?? null
    : null;

  // Phase 8 — the captioned (subtitled) video actually delivered to each ratio,
  // so the distribution-review panel can show/download every generated channel
  // video (not just the primary). Keyed by ratio; each channel maps to its ratio.
  const captionedUrlByRatio: Record<string, string | null> = {
    "9:16": pipelineJob?.captionedExport_9_16_assetId
      ? assets.find((a) => a.id === pipelineJob.captionedExport_9_16_assetId)?.storageUrl ?? null
      : null,
    "16:9": pipelineJob?.captionedExport_16_9_assetId
      ? assets.find((a) => a.id === pipelineJob.captionedExport_16_9_assetId)?.storageUrl ?? null
      : null,
    "1:1": pipelineJob?.captionedExport_1_1_assetId
      ? assets.find((a) => a.id === pipelineJob.captionedExport_1_1_assetId)?.storageUrl ?? null
      : null,
    "4:5": pipelineJob?.captionedExport_4_5_assetId
      ? assets.find((a) => a.id === pipelineJob.captionedExport_4_5_assetId)?.storageUrl ?? null
      : null,
  };
  const channelVideos = (request.targetPlatforms ?? [])
    .filter((p) => p !== Platform.TventApp)
    .map((p) => {
      const ratio = PLATFORM_ASPECT_RATIOS[p as Platform] ?? null;
      return {
        platform: p as string,
        label: PLATFORM_LABELS[p as Platform] ?? (p as string),
        ratio,
        url: ratio ? captionedUrlByRatio[ratio] ?? null : null,
      };
    });
  const sourceAssets = assets.filter(
    (a) =>
      a.uploadStatus === AssetUploadStatus.Uploaded &&
      (a.assetType === AssetType.Image || a.assetType === AssetType.Video)
  );
  // Canonical, index-stable ordering (images + clips) shared by the montage
  // scene panels and the renderer — index N is the same media everywhere.
  const orderedSourceAssets = orderSourceAssets(assets);
  const sourceImageOptions = sourceAssets
    .map((asset, sourceIndex) => ({ asset, sourceIndex }))
    .filter(({ asset }) => asset.assetType === AssetType.Image)
    .map(({ asset, sourceIndex }) => ({
      sourceIndex,
      id: asset.id,
      fileName: asset.fileName,
      thumbnailUrl: asset.thumbnailUrl,
      storageUrl: asset.storageUrl,
    }));

  // Canonical ordering for storyboard/montage thumbnails — an index here is the
  // same asset everywhere (storyboard, scene design, renderer).
  const storyboardAssets = orderSourceAssets(assets).map((a) => ({
    index: a.index,
    thumbnailUrl: a.thumbnailUrl,
    kind: a.kind,
    fileName: a.fileName,
    durationSeconds: a.durationSeconds ?? null,
  }));

  const view = requestPresentationService.buildRequestView(
    request,
    assets,
    publishingLinks,
    statusHistory,
    pipelineJob?.currentStep ?? null
  );

  const isDraft = request.status === RequestStatus.Draft;
  const isTerminal =
    request.status === RequestStatus.Delivered ||
    request.status === RequestStatus.Published;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-slate-500">
        <Link href={ROUTES.DASHBOARD} className="hover:text-slate-700">
          Dashboard
        </Link>
        <span>/</span>
        <Link href={ROUTES.REQUESTS} className="hover:text-slate-700">
          My Requests
        </Link>
        <span>/</span>
        <span className="text-slate-700 font-medium truncate max-w-[200px]">
          {view.title}
        </span>
      </nav>

      {/* Title + Status */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{view.title}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {view.submittedAt
              ? `Submitted ${view.submittedAt.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}`
              : `Created ${view.createdAt.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}`}
          </p>
        </div>
        <RequestStatusBadge status={view.status} />
      </div>

      {/* Status description */}
      <Card className="mb-6">
        <p className="text-sm font-medium text-slate-700">
          {pipelineJob?.currentStep === VideoGenerationStep.AwaitingContentApproval
            ? "AI วิเคราะห์เนื้อหาเสร็จแล้ว — ตรวจสอบและแก้ไขสคริปต์ด้านล่าง แล้วคลิกอนุมัติเพื่อเริ่มสร้างเสียงพากย์"
            : view.statusPresentation.description}
        </p>

        {/* Retention notes — inline text only (no email/popup) */}
        <RetentionNoteText
          note={finalClipAvailabilityNote(request)}
          className="mt-2 font-medium"
        />
        <RetentionNoteText note={inactivityNote(request)} className="mt-2" />

        {/* Queue info — hide while awaiting AI approval */}
        {view.queueDisplay.show && pipelineJob?.currentStep !== VideoGenerationStep.AwaitingContentApproval && (
          <p className="mt-2 text-sm text-slate-500">{view.queueDisplay.message}</p>
        )}

        {/* Pipeline progress — shown during production */}
        {view.pipelineProgress && (
          <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              <p className="text-sm font-semibold text-blue-800">{view.pipelineProgress.label}</p>
            </div>
            <p className="mt-1 text-xs text-blue-600">{view.pipelineProgress.description}</p>
          </div>
        )}

        {/* Due date */}
        <DueDateDisplay
          display={view.dueDateDisplay}
          className="mt-3"
        />

        {/* Hold reason */}
        {request.status === RequestStatus.OnHold && view.holdReason && (
          <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-yellow-700">
              On Hold — Reason
            </p>
            <p className="mt-1 text-sm text-yellow-800">{view.holdReason}</p>
          </div>
        )}

        {/* Rejection reason */}
        {request.status === RequestStatus.Rejected && view.rejectionReason && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
              Rejected — Reason
            </p>
            <p className="mt-1 text-sm text-red-800">{view.rejectionReason}</p>
          </div>
        )}
      </Card>

      {/* Re-analyze prompt — shown when request is submitted but no pipeline job exists yet */}
      {request.status === RequestStatus.Submitted && !pipelineJob && (
        <Card className="mb-6 border-blue-200 bg-blue-50">
          <p className="text-sm font-semibold text-blue-800">
            สร้างสคริปต์วิดีโอด้วย AI
          </p>
          <p className="mt-1 text-sm text-blue-700">
            AI จะวิเคราะห์รูปภาพที่อัพโหลดและสร้างแผนฉาก บทพูด และแคปชั่นสำหรับวิดีโอ 15 วินาที
            จากนั้นคุณสามารถแก้ไขและอนุมัติก่อนเริ่มสร้างเสียงพากย์ได้
          </p>
          <div className="mt-4">
            <AnalyzeButton requestId={id} />
          </div>
        </Card>
      )}

      {/* Draft actions */}
      {isDraft && (
        <div className="mb-6 flex gap-3">
          <Link href={`${ROUTES.REQUESTS_NEW}?edit=${id}`}>
            <button className="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
              Continue Editing
            </button>
          </Link>
        </div>
      )}

      {/* Production pipeline — shown when an AI pipeline job exists */}
      {pipelineJob && (() => {
        const isAwaitingApproval =
          pipelineJob.currentStep === VideoGenerationStep.AwaitingContentApproval;
        const isFailed = pipelineJob.currentStep === VideoGenerationStep.Failed;
        // Audio-first reorder: voice generation now runs before video generation,
        // so a GeneratingVoice failure happens before any base video exists.
        // Handled by the generic PipelineFailurePanel retry flow below.
        const isAwaitingVoiceApproval =
          pipelineJob.currentStep === VideoGenerationStep.AwaitingVoiceApproval;
        const isGeneratingSceneDesign =
          pipelineJob.currentStep === VideoGenerationStep.GeneratingSceneDesign;
        const isAwaitingSceneDesignApproval =
          pipelineJob.currentStep === VideoGenerationStep.AwaitingSceneDesignApproval;
        const isAwaitingSceneScriptApproval =
          pipelineJob.currentStep === VideoGenerationStep.AwaitingSceneScriptApproval;
        // Phase 8 — distribution-review step (auto-filled per-channel publish form).
        const isAwaitingDistributionReview =
          pipelineJob.currentStep === VideoGenerationStep.AwaitingDistributionReview;
        // Steps where an async background job is genuinely in progress — drives the
        // VideoApprovalPanel processing spinner (must NOT show at terminal/review
        // states like Complete/Delivered/AwaitingDistributionReview).
        const isProcessing = [
          VideoGenerationStep.GeneratingVoice,
          VideoGenerationStep.GeneratingBaseVideo,
          VideoGenerationStep.GeneratingAnimations,
          VideoGenerationStep.ComposingFinalVideo,
          VideoGenerationStep.GeneratingOverlay,
          VideoGenerationStep.GeneratingAdditionalRatios,
        ].includes(pipelineJob.currentStep);
        const effectiveDurationSeconds = Math.round(
          pipelineJob.voiceDurationSeconds ?? request.durationSeconds
        );

        // Parse scene plan — prefer approved version; fall back to raw AI output
        let scenePlan: ScenePlan[] = [];
        const scenePlanSrc = pipelineJob.approvedScenePlan ?? pipelineJob.scenePlan;
        if (scenePlanSrc) {
          try { scenePlan = JSON.parse(scenePlanSrc); } catch { /* ignore */ }
        }

        // Parse the Stage-1 storyboard — prefer approved; fall back to generated.
        let storyboard: StoryboardScene[] = [];
        const storyboardSrc = pipelineJob.approvedStoryboard ?? pipelineJob.storyboard;
        if (storyboardSrc) {
          try { storyboard = JSON.parse(storyboardSrc); } catch { /* ignore */ }
        }
        const completedSceneVideoCount =
          pipelineJob.sceneVideoAssetIds?.filter((assetId) => Boolean(assetId)).length ?? 0;
        const activeSceneIndex = Math.min(
          Math.max(
            pipelineJob.currentStep === VideoGenerationStep.AwaitingSceneDesignApproval
              ? completedSceneVideoCount
              : Math.max(completedSceneVideoCount - 1, 0),
            0
          ),
          Math.max(scenePlan.length - 1, 0)
        );

        // Requester must approve before video generation starts — show editable script panel
        if (isAwaitingApproval) {
          return (
            <ContentApprovalPanel
              requestId={id}
              initialScriptThai={pipelineJob.scriptThai}
              initialScriptEnglish={pipelineJob.scriptEnglish}
              initialCaptionThai={pipelineJob.captionThai}
              initialCaptionEnglish={pipelineJob.captionEnglish}
              initialCaptionChinese={pipelineJob.captionChinese}
              storyboard={storyboard}
              storyboardAssets={storyboardAssets}
            />
          );
        }

        if (isAwaitingSceneDesignApproval) {
          return (
            <>
              <PipelineSection
                requestId={id}
                currentStep={pipelineJob.currentStep}
                failedAtStep={pipelineJob.failedAtStep}
                durationSeconds={effectiveDurationSeconds}
                totalChannels={request.targetPlatforms.length}
              />
              <SceneDesignApprovalPanel
                requestId={id}
                jobId={pipelineJob.id}
                initialScenes={scenePlan}
                scriptThai={pipelineJob.approvedScriptThai ?? pipelineJob.scriptThai}
                initialDurationSeconds={effectiveDurationSeconds}
                voiceDurationSeconds={pipelineJob.voiceDurationSeconds}
                voiceRecordingUrl={voiceRecordingAsset?.storageUrl ?? null}
                voiceRecordingAssetId={voiceRecordingAsset?.id ?? null}
                totalChannels={request.targetPlatforms.length}
                primaryAspectRatio={primaryRatio}
                sourceAssets={sourceAssets}
                orderedAssets={orderedSourceAssets}
                activeSceneIndex={activeSceneIndex}
              />
            </>
          );
        }

        if (isAwaitingSceneScriptApproval) {
          return (
            <>
              <PipelineSection
                requestId={id}
                currentStep={pipelineJob.currentStep}
                failedAtStep={pipelineJob.failedAtStep}
                durationSeconds={effectiveDurationSeconds}
                totalChannels={request.targetPlatforms.length}
              />
              <SceneScriptApprovalPanel
                requestId={id}
                jobId={pipelineJob.id}
                initialScenes={scenePlan}
                scriptThai={pipelineJob.approvedScriptThai ?? pipelineJob.scriptThai}
                hookThai={pipelineJob.approvedHookThai ?? pipelineJob.hookThai}
                captionThai={pipelineJob.approvedCaptionThai ?? pipelineJob.captionThai}
                activeSceneIndex={pipelineJob.currentSceneIndex ?? 0}
                voiceRecordingUrl={voiceRecordingAsset?.storageUrl ?? null}
                voiceRecordingAssetId={voiceRecordingAsset?.id ?? null}
                latestVideoUrl={latestVideoAsset?.storageUrl ?? null}
                latestVideoAssetId={latestVideoAsset?.id ?? null}
                sourceAssets={sourceAssets}
                orderedAssets={orderedSourceAssets}
              />
            </>
          );
        }

        return (
          <>
            <PipelineSection
              requestId={id}
              currentStep={pipelineJob.currentStep}
              failedAtStep={pipelineJob.failedAtStep}
              durationSeconds={effectiveDurationSeconds}
              totalChannels={request.targetPlatforms.length}
              tventVideoStatus={pipelineJob.tventVideoStatus ?? null}
            />

            {!isFailed && isGeneratingSceneDesign && (
              <SceneDesignGeneratingPanel voiceDurationSeconds={pipelineJob.voiceDurationSeconds} />
            )}

            {/* Voice approval + script — shown once voice generation completes,
                before the base video exists (audio-first reorder). The approved
                storyboard is shown read-only so the requester can picture the
                story while judging the voiceover. */}
            {!isFailed && isAwaitingVoiceApproval && storyboard.length > 0 && (
              <div className="mb-6">
                <StoryboardView
                  scenes={storyboard}
                  assets={storyboardAssets}
                  subtitle="ภาพรวมฉากที่อนุมัติแล้ว — ใช้จินตนาการเรื่องราวขณะฟังเสียงพากย์"
                />
              </div>
            )}
            {!isFailed && isAwaitingVoiceApproval && (
              <VideoApprovalPanel
                requestId={id}
                jobId={pipelineJob.id}
                videoUrl={baseVideoAsset?.storageUrl ?? null}
                isAwaitingApproval={false}
                isAwaitingVoiceRecording={false}
                isAwaitingVoiceApproval
                isAwaitingAnimationApproval={false}
                isPipelineFailed={isFailed}
                isGeneratingVoice={false}
                animatedVideoUrl={animatedVideoAsset?.storageUrl ?? null}
                savedMusicTrack={pipelineJob.selectedMusicTrack ?? null}
                isAwaitingFinalApproval={false}
                voiceRecordingUrl={voiceRecordingAsset?.storageUrl ?? null}
                voiceRecordingAssetId={voiceRecordingAsset?.id ?? null}
                finalClips={finalClips}
                scenes={scenePlan}
                storyboard={storyboard}
                hookThai={pipelineJob.approvedHookThai ?? pipelineJob.hookThai}
                hookEnglish={pipelineJob.approvedHookEnglish ?? pipelineJob.hookEnglish}
                scriptThai={pipelineJob.approvedScriptThai ?? pipelineJob.scriptThai}
                scriptEnglish={pipelineJob.approvedScriptEnglish ?? pipelineJob.scriptEnglish}
                captionThai={pipelineJob.approvedCaptionThai ?? pipelineJob.captionThai}
                captionEnglish={pipelineJob.approvedCaptionEnglish ?? pipelineJob.captionEnglish}
                captionChinese={pipelineJob.approvedCaptionChinese ?? pipelineJob.captionChinese}
                sourceAssets={sourceAssets}
                orderedAssets={orderedSourceAssets}
                activeSceneIndex={activeSceneIndex}
              />
            )}

            {/* Phase 8 — distribution review: auto-filled per-channel publish form */}
            {!isFailed && isAwaitingDistributionReview && (
              <DistributionReviewPanel
                requestId={id}
                jobId={pipelineJob.id}
                initialDrafts={pipelineJob.publishingDrafts ?? []}
                reviewedClipUrl={overlayPreviewUrl}
                reviewedRatio={primaryRatio}
                reviewedChannelLabels={(request.targetPlatforms ?? [])
                  .filter((p) => p !== Platform.TventApp)
                  .map((p) => PLATFORM_LABELS[p as Platform] ?? p)}
                channelVideos={channelVideos}
                tventVideoStatus={pipelineJob.tventVideoStatus ?? null}
                tventClipUrl={tventClipUrl}
              />
            )}

            {/* Generated base video + script — shown once video generation completes */}
            {!isFailed && !isAwaitingVoiceApproval && !isAwaitingDistributionReview && baseVideoAsset?.storageUrl && (
              <VideoApprovalPanel
                requestId={id}
                jobId={pipelineJob.id}
                videoUrl={baseVideoAsset.storageUrl}
                sceneVideos={sceneVideos}
                isProcessing={isProcessing}
                isAwaitingApproval={
                  pipelineJob.currentStep === VideoGenerationStep.AwaitingVideoApproval
                }
                isAwaitingVoiceRecording={
                  pipelineJob.currentStep === VideoGenerationStep.AwaitingVoiceRecording
                }
                isAwaitingVoiceApproval={false}
                isAwaitingAnimationApproval={
                  pipelineJob.currentStep === VideoGenerationStep.AwaitingAnimationApproval
                }
                isPipelineFailed={isFailed}
                isGeneratingVoice={false}
                animatedVideoUrl={animatedVideoAsset?.storageUrl ?? null}
                savedMusicTrack={pipelineJob.selectedMusicTrack ?? null}
                primaryRatio={primaryRatio}
                isAwaitingFinalApproval={
                  pipelineJob.currentStep === VideoGenerationStep.AwaitingFinalApproval
                }
                isAwaitingOverlayApproval={
                  pipelineJob.currentStep === VideoGenerationStep.AwaitingOverlayApproval
                }
                isAwaitingAdditionalRatios={
                  pipelineJob.currentStep === VideoGenerationStep.AwaitingAdditionalRatios
                }
                overlayPreviewUrl={overlayPreviewUrl}
                savedSubtitleLanguages={pipelineJob.subtitleLanguages}
                savedTemplate={pipelineJob.selectedMotionTemplate ?? "none"}
                tventVideoStatus={pipelineJob.tventVideoStatus ?? null}
                tventClipUrl={tventClipUrl}
                voiceRecordingUrl={voiceRecordingAsset?.storageUrl ?? null}
                voiceRecordingAssetId={voiceRecordingAsset?.id ?? null}
                finalClips={finalClips}
                scenes={scenePlan}
                storyboard={storyboard}
                hookThai={pipelineJob.approvedHookThai ?? pipelineJob.hookThai}
                hookEnglish={pipelineJob.approvedHookEnglish ?? pipelineJob.hookEnglish}
                scriptThai={pipelineJob.approvedScriptThai ?? pipelineJob.scriptThai}
                scriptEnglish={pipelineJob.approvedScriptEnglish ?? pipelineJob.scriptEnglish}
                captionThai={pipelineJob.approvedCaptionThai ?? pipelineJob.captionThai}
                captionEnglish={pipelineJob.approvedCaptionEnglish ?? pipelineJob.captionEnglish}
                captionChinese={pipelineJob.approvedCaptionChinese ?? pipelineJob.captionChinese}
                sourceAssets={sourceAssets}
                orderedAssets={orderedSourceAssets}
                activeSceneIndex={activeSceneIndex}
              />
            )}

            {/* Error recovery — shown when the pipeline has failed */}
            {isFailed && (
              <PipelineFailurePanel
                requestId={id}
                jobId={pipelineJob.id}
                failedAtStep={pipelineJob.failedAtStep}
                scenePlan={scenePlan}
                sourceImages={sourceImageOptions}
                voiceRecordingUrl={voiceRecordingAsset?.storageUrl ?? null}
                scriptThai={pipelineJob.approvedScriptThai}
                hookThai={pipelineJob.approvedHookThai}
              />
            )}
          </>
        );
      })()}

      {/* Pay-to-download / trial paywall — shown once final masters exist */}
      {finalClips.length > 0 && (
        <UnlockDownloadPanel
          requestId={request.id}
          locked={!request.downloadUnlocked}
          isTrial={!!request.isTrialRequest}
          price={CREDITS_CONFIG.REQUEST_COST_CREDITS}
          clips={finalClips.map((c, i) => ({
            id: c.id,
            label: `วิดีโอฉบับสมบูรณ์ ${i + 1}`,
          }))}
        />
      )}

      {/* Delivery links */}
      {(isTerminal || publishingLinks.length > 0) && (
        <Card className="mb-6">
          <h2 className="mb-4 text-base font-semibold text-slate-900">
            Published Links
          </h2>
          <DeliveryLinks links={publishingLinks} />
          {isTerminal && (
            <p className="mt-4 text-xs text-slate-400">
              You may repost or share these links on your own channels at no cost.
              The final edited clip remains the property of RClipper.
            </p>
          )}
        </Card>
      )}

      {/* Brief details */}
      <Card className="mb-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">
          Request Brief
        </h2>
        <dl className="flex flex-col gap-4">
          <BriefRow label="Description" value={view.description} />
          <BriefRow label="Target audience" value={view.targetAudience} />
          <BriefRow
            label="Target platforms"
            value={view.targetPlatforms.join(", ")}
          />
          <BriefRow label="Preferred style" value={view.preferredStyle} />
        </dl>
        <div className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-400">
          Credits used: {view.creditsCost} · Request ID: {view.id}
        </div>
      </Card>

      {/* Source files */}
      <Card className="mb-6">
        <h2 className="mb-2 text-base font-semibold text-slate-900">
          Source Files
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          {uploadedMaterialsNote().text}
        </p>
        {assets.filter((a) => a.uploadStatus !== AssetUploadStatus.Deleted && (a.assetType === AssetType.Image || a.assetType === AssetType.Video)).length === 0 ? (
          <p className="text-sm text-slate-400">No source files attached.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {assets
              .filter((a) => a.uploadStatus !== AssetUploadStatus.Deleted && (a.assetType === AssetType.Image || a.assetType === AssetType.Video))
              .map((asset) => {
                const thumbSrc = asset.thumbnailUrl || (asset.assetType === AssetType.Image ? asset.storageUrl : "");
                return (
                  <li
                    key={asset.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      {thumbSrc ? (
                        // Cloud-stored poster (images, and videos uploaded after
                        // thumbnail support). Prefer this whenever present.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbSrc}
                          alt={asset.fileName}
                          className="h-12 w-12 flex-shrink-0 rounded-md border border-slate-200 object-cover"
                        />
                      ) : asset.assetType === AssetType.Video ? (
                        // No stored poster (e.g. clips uploaded before thumbnail
                        // support, or when extraction was unavailable): let the
                        // browser render a real frame from the clip itself. The
                        // `#t=0.5` media fragment seeks ~0.5s in to avoid a black
                        // first frame; preload="metadata" keeps it cheap.
                        <video
                          src={`${asset.storageUrl}#t=0.5`}
                          preload="metadata"
                          muted
                          playsInline
                          className="h-12 w-12 flex-shrink-0 rounded-md border border-slate-200 object-cover bg-black"
                        />
                      ) : (
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-slate-400">
                          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                            <path d="M4 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm0 2h16v8.59l-3.3-3.3a1 1 0 0 0-1.4 0L11 17.59l-2.3-2.3a1 1 0 0 0-1.4 0L4 18.59V6z" />
                          </svg>
                        </div>
                      )}
                      <div>
                        <p className="text-sm text-slate-800">{asset.fileName}</p>
                        <p className="text-xs text-slate-400">
                          {asset.assetType} ·{" "}
                          {(asset.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB · Deletion
                          scheduled{" "}
                          {asset.scheduledDeletionAt.toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs capitalize text-slate-500">
                      {asset.uploadStatus}
                    </span>
                  </li>
                );
              })}
          </ul>
        )}
      </Card>

      {/* Status timeline */}
      <Card className="mb-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">
          Status History
        </h2>
        <RequestTimeline history={statusHistory} />
      </Card>

      {/* Legal reminder */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        <p>
          <strong>Ownership reminder:</strong> The final edited clip produced for this
          request is the property of RClipper. You are free to repost and share the
          delivered clip on your own channels. Uploaded source materials are retained
          for production purposes only and will be deleted per our 90-day storage
          policy.{" "}
          <Link href={ROUTES.LEGAL} className="text-blue-600 hover:underline">
            View full policy →
          </Link>
        </p>
      </div>
    </div>
  );
}

function BriefRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
    </div>
  );
}
