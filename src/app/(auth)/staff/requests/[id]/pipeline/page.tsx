import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { PipelineStepIndicator } from "@/features/staff/components/pipeline/PipelineStepIndicator";
import { ContentReviewPanel } from "@/features/staff/components/pipeline/ContentReviewPanel";
import { VideoReviewPanel } from "@/features/staff/components/pipeline/VideoReviewPanel";
import { VoiceRecordingPanel } from "@/features/staff/components/pipeline/VoiceRecordingPanel";
import { VoiceComparisonPanel } from "@/features/staff/components/pipeline/VoiceComparisonPanel";
import { FinalExportReviewPanel } from "@/features/staff/components/pipeline/FinalExportReviewPanel";
import { PublishingPanel } from "@/features/staff/components/pipeline/PublishingPanel";
import { PollingRefresher } from "@/features/staff/components/pipeline/PollingRefresher";
import { videoPipelinePresentationService } from "@/services/staff/VideoPipelinePresentationService";
import { StartPipelineButton } from "@/features/staff/components/pipeline/StartPipelineButton";
import { RetryPipelineButton } from "@/features/staff/components/pipeline/RetryPipelineButton";

export const metadata: Metadata = { title: "Video Pipeline — Staff" };

function PollingStatus({ step }: { step: VideoGenerationStep }) {
  const messages: Partial<Record<VideoGenerationStep, string>> = {
    [VideoGenerationStep.AnalyzingContent]:
      "ChatGPT Vision is analyzing your images and creating the production plan...",
    [VideoGenerationStep.GeneratingBaseVideo]:
      "Kling AI is generating your 15-second video. This may take 1–3 minutes...",
    [VideoGenerationStep.ProcessingVoice]:
      "Processing voice...",
    [VideoGenerationStep.ComposingFinalVideo]:
      "FFmpeg is composing the final video with subtitles in 4 ratios...",
  };

  return (
    <div className="flex items-center gap-3 text-gray-600">
      <div className="w-5 h-5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin flex-shrink-0" />
      <div>
        <p className="font-medium text-sm">{messages[step] ?? "Processing..."}</p>
        <p className="text-xs text-gray-400 mt-0.5">Page will refresh automatically when ready.</p>
      </div>
      <PollingRefresher intervalMs={5000} />
    </div>
  );
}

export default async function VideoPipelinePage({
  params,
}: {
  params: { id: string };
}) {
  await requireRole(Role.Editor, Role.Admin);

  const request = await clipRequestRepository.findById(params.id);
  if (!request) notFound();

  const job = await videoGenerationJobRepository.findByRequestId(params.id);

  // No pipeline started yet — show prompt to start
  if (!job) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-6 flex items-center gap-2 text-sm">
          <a href={`/staff/requests/${params.id}`} className="text-blue-600 hover:underline">
            ← Back to request
          </a>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{request.title}</h1>
        <p className="text-sm text-gray-500 mb-8">AI Video Production Pipeline</p>

        <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-10 text-center space-y-4">
          <p className="text-lg font-semibold text-slate-700">No pipeline started yet</p>
          <p className="text-sm text-slate-500">
            Click the button below to begin the AI video production pipeline for this request.
            ChatGPT will analyse the uploaded images and generate a scene plan, script, and captions.
          </p>
          <StartPipelineButton requestId={params.id} />
        </div>
      </div>
    );
  }

  // Pipeline exists — fetch full view
  const pipelineView = await videoPipelinePresentationService.getStaffPipelineView(params.id);
  if (!pipelineView) notFound();

  const { scenePlanParsed, resolvedAssets, stepProgress, publishViews } = pipelineView;
  const step = job.currentStep;

  const isPolling =
    step === VideoGenerationStep.AnalyzingContent ||
    step === VideoGenerationStep.GeneratingBaseVideo ||
    step === VideoGenerationStep.ProcessingVoice ||
    step === VideoGenerationStep.ComposingFinalVideo;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <a href="/staff" className="text-blue-600 hover:underline">Staff</a>
        <span className="text-gray-300">/</span>
        <a href={`/staff/requests/${params.id}`} className="text-blue-600 hover:underline">
          {request.title}
        </a>
        <span className="text-gray-300">/</span>
        <span className="text-gray-500">Video Pipeline</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">{request.title}</h1>
        <p className="text-sm text-gray-500 mt-1">AI Video Production Pipeline</p>
      </div>

      {/* Step progress */}
      <div className="rounded-lg border bg-white p-4 overflow-x-auto">
        <PipelineStepIndicator steps={stepProgress} />
      </div>

      {/* Active step panel */}
      <div className="rounded-lg border bg-white p-6">
        {step === VideoGenerationStep.Failed && (
          <div className="space-y-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-1">
              <p className="font-semibold text-red-700">Pipeline failed</p>
              <p className="text-sm text-red-600">
                An error occurred during AI processing. Check the dev server logs for details.
              </p>
            </div>
            <RetryPipelineButton
              requestId={params.id}
              jobId={job.id}
              failedAtStep={job.failedAtStep}
            />
          </div>
        )}

        {isPolling && <PollingStatus step={step} />}

        {step === VideoGenerationStep.AwaitingContentApproval && (
          <ContentReviewPanel requestId={params.id} job={job} scenePlan={scenePlanParsed} />
        )}
        {step === VideoGenerationStep.AwaitingVideoApproval && (
          <VideoReviewPanel requestId={params.id} job={job} baseVideoAsset={resolvedAssets.baseVideo} />
        )}
        {step === VideoGenerationStep.AwaitingVoiceRecording && (
          <div className="py-10 text-center space-y-2">
            <div className="w-10 h-10 mx-auto rounded-full border-4 border-blue-200 border-t-blue-500 animate-spin" />
            <p className="text-base font-semibold text-slate-600">รอผู้ใช้บันทึกเสียงพากย์</p>
            <p className="text-sm text-slate-400">
              ผู้ใช้กำลังบันทึกเสียงและแปลงผ่าน RVC โดยตรง หน้านี้จะอัพเดทอัตโนมัติเมื่อเสร็จสิ้น
            </p>
          </div>
        )}
        {step === VideoGenerationStep.AwaitingVoiceApproval && (
          <VoiceComparisonPanel
            requestId={params.id}
            job={job}
            voiceRecording={resolvedAssets.voiceRecording}
            processedVoice={resolvedAssets.processedVoice}
          />
        )}
        {step === VideoGenerationStep.AwaitingFinalApproval && (
          <FinalExportReviewPanel requestId={params.id} job={job} exports={resolvedAssets.finalExports} />
        )}
        {(step === VideoGenerationStep.Publishing || step === VideoGenerationStep.Complete) && (
          <PublishingPanel requestId={params.id} job={job} platforms={publishViews} />
        )}
      </div>
    </div>
  );
}

