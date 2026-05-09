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
import { Card } from "@/components/ui/Card";
import { RequestStatusBadge } from "@/features/requests/components/RequestStatusBadge";
import { DueDateDisplay } from "@/features/requests/components/DueDateDisplay";
import { DeliveryLinks } from "@/features/requests/components/DeliveryLinks";
import { RequestTimeline } from "@/features/requests/components/RequestTimeline";
import { ProductionPipeline } from "@/features/requests/components/ProductionPipeline";
import { PipelineStatusPoller } from "@/features/requests/components/PipelineStatusPoller";
import { PipelineFailurePanel } from "@/features/requests/components/PipelineFailurePanel";
import { ContentApprovalPanel } from "@/features/requests/components/ContentApprovalPanel";
import { AnalyzeButton } from "@/features/requests/components/AnalyzeButton";
import { VideoGenerationStep, POLLING_STEPS } from "@/domain/enums/VideoGenerationStep";
import { CREDITS_CONFIG } from "@/config/credits";
import { AssetUploadStatus } from "@/domain/enums/AssetType";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

export const metadata: Metadata = { title: "Request Detail — RClipper" };

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
            ? "AI วิเคราะห์เนื้อหาเสร็จแล้ว — ตรวจสอบและแก้ไขสคริปต์ด้านล่าง แล้วคลิกอนุมัติเพื่อเริ่มสร้างวิดีโอ"
            : view.statusPresentation.description}
        </p>

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
            จากนั้นคุณสามารถแก้ไขและอนุมัติก่อนเริ่มสร้างวิดีโอได้
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
        const isPolling = POLLING_STEPS.includes(pipelineJob.currentStep);

        // Parse scene plan — prefer approved version; fall back to raw AI output
        let scenePlan: ScenePlan[] = [];
        const scenePlanSrc = pipelineJob.approvedScenePlan ?? pipelineJob.scenePlan;
        if (scenePlanSrc) {
          try { scenePlan = JSON.parse(scenePlanSrc); } catch { /* ignore */ }
        }

        // Requester must approve before Kling starts — show editable script panel
        if (isAwaitingApproval) {
          return (
            <ContentApprovalPanel
              requestId={id}
              initialScenes={scenePlan}
              initialHookThai={pipelineJob.hookThai}
              initialHookEnglish={pipelineJob.hookEnglish}
              initialScriptThai={pipelineJob.scriptThai}
              initialScriptEnglish={pipelineJob.scriptEnglish}
              initialCaptionThai={pipelineJob.captionThai}
              initialCaptionEnglish={pipelineJob.captionEnglish}
              initialCaptionChinese={pipelineJob.captionChinese}
            />
          );
        }

        return (
          <>
            <ProductionPipeline
              currentStep={pipelineJob.currentStep}
              failedAtStep={pipelineJob.failedAtStep}
            />

            {/* Auto-refresh while an async AI step is running */}
            {isPolling && (
              <PipelineStatusPoller
                requestId={id}
                currentStep={pipelineJob.currentStep}
              />
            )}

            {/* Error recovery — shown when the pipeline has failed */}
            {isFailed && (
              <PipelineFailurePanel
                requestId={id}
                jobId={pipelineJob.id}
                failedAtStep={pipelineJob.failedAtStep}
                scenePlan={scenePlan}
                scriptThai={pipelineJob.approvedScriptThai}
                scriptEnglish={pipelineJob.approvedScriptEnglish}
                hookThai={pipelineJob.approvedHookThai}
                hookEnglish={pipelineJob.approvedHookEnglish}
              />
            )}

            {/* Approved script — read-only reference while production is running */}
            {!isFailed && (pipelineJob.approvedHookThai ?? pipelineJob.hookThai) && (
              <ApprovedScriptCard
                scenes={scenePlan}
                hookThai={pipelineJob.approvedHookThai ?? pipelineJob.hookThai}
                hookEnglish={pipelineJob.approvedHookEnglish ?? pipelineJob.hookEnglish}
                scriptThai={pipelineJob.approvedScriptThai ?? pipelineJob.scriptThai}
                scriptEnglish={pipelineJob.approvedScriptEnglish ?? pipelineJob.scriptEnglish}
                captionThai={pipelineJob.approvedCaptionThai ?? pipelineJob.captionThai}
                captionEnglish={pipelineJob.approvedCaptionEnglish ?? pipelineJob.captionEnglish}
                captionChinese={pipelineJob.approvedCaptionChinese ?? pipelineJob.captionChinese}
              />
            )}
          </>
        );
      })()}

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
          Uploaded source files are kept only for this request and are not
          maintained as a reusable asset library. Raw uploads are scheduled for
          deletion after 90 days under our storage policy.
        </p>
        {assets.filter((a) => a.uploadStatus !== AssetUploadStatus.Deleted).length === 0 ? (
          <p className="text-sm text-slate-400">No source files attached.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {assets
              .filter((a) => a.uploadStatus !== AssetUploadStatus.Deleted)
              .map((asset) => (
                <li
                  key={asset.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
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
                  <span className="text-xs capitalize text-slate-500">
                    {asset.uploadStatus}
                  </span>
                </li>
              ))}
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

function ApprovedScriptCard({
  scenes,
  hookThai,
  hookEnglish,
  scriptThai,
  scriptEnglish,
  captionThai,
  captionEnglish,
  captionChinese,
}: {
  scenes: ScenePlan[];
  hookThai: string | null;
  hookEnglish: string | null;
  scriptThai: string | null;
  scriptEnglish: string | null;
  captionThai: string | null;
  captionEnglish: string | null;
  captionChinese: string | null;
}) {
  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-base font-semibold text-slate-900">สคริปต์วิดีโอที่อนุมัติ</h2>

      {/* Hook */}
      {(hookThai ?? hookEnglish) && (
        <div className="mb-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
            ฮุค (3 วินาทีแรก)
          </p>
          {hookThai && <p className="text-sm text-slate-800">{hookThai}</p>}
          {hookEnglish && <p className="mt-0.5 text-sm italic text-slate-500">{hookEnglish}</p>}
        </div>
      )}

      {/* Scene plan */}
      {scenes.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">แผนฉาก</p>
          <div className="flex flex-col gap-2">
            {scenes.map((scene) => (
              <div
                key={scene.sceneNumber}
                className="rounded-lg border border-slate-100 bg-slate-50 p-3"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-600">
                    ฉาก {scene.sceneNumber}
                  </span>
                  <span className="text-xs text-slate-400">{scene.durationSeconds} วินาที</span>
                </div>
                {scene.visualDescriptionThai && (
                  <p className="text-sm text-slate-700">{scene.visualDescriptionThai}</p>
                )}
                <p className={`text-sm ${scene.visualDescriptionThai ? "mt-0.5 text-slate-500" : "text-slate-700"}`}>
                  {scene.visualDescription}
                </p>
                {(scene.motionNotesThai ?? scene.motionNotes) && (
                  <p className="mt-1 text-xs text-slate-400">
                    {scene.motionNotesThai ?? scene.motionNotes}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Script */}
      {(scriptThai ?? scriptEnglish) && (
        <div className="mb-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">บทพูด</p>
          {scriptThai && <p className="text-sm text-slate-800">{scriptThai}</p>}
          {scriptEnglish && <p className="mt-1 text-sm italic text-slate-500">{scriptEnglish}</p>}
        </div>
      )}

      {/* Captions */}
      {(captionThai ?? captionEnglish ?? captionChinese) && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            แคปชั่นโซเชียล
          </p>
          <div className="flex flex-col gap-2">
            {captionThai && (
              <div>
                <p className="text-xs text-slate-400">ภาษาไทย</p>
                <p className="text-sm text-slate-700">{captionThai}</p>
              </div>
            )}
            {captionEnglish && (
              <div>
                <p className="text-xs text-slate-400">English</p>
                <p className="text-sm text-slate-700">{captionEnglish}</p>
              </div>
            )}
            {captionChinese && (
              <div>
                <p className="text-xs text-slate-400">中文</p>
                <p className="text-sm text-slate-700">{captionChinese}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
