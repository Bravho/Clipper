import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import {
  clipRequestRepository,
  uploadedAssetRepository,
  publishingLinkRepository,
  requestStatusHistoryRepository,
  internalNoteRepository,
} from "@/repositories";
import { staffRequestPresentationService } from "@/services/staff/StaffRequestPresentationService";
import { dueDateConfirmationService } from "@/services/staff/DueDateConfirmationService";
import { StaffActionButtons } from "@/features/staff/components/StaffActionButtons";
import { InternalNotesPanel } from "@/features/staff/components/InternalNotesPanel";
import { EditedClipUploadPanel } from "@/features/staff/components/EditedClipUploadPanel";
import { AssetCard } from "@/features/staff/components/AssetCard";
import { StaffStatusBadge } from "@/features/staff/components/StaffStatusBadge";
import { PLATFORM_LABELS } from "@/domain/enums/Platform";
import { EFFORT_CLASS_LABELS } from "@/domain/enums/EffortClass";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Request Detail — Staff" };

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div className="mt-0.5 text-sm text-slate-800">{value}</div>
    </div>
  );
}

export default async function StaffRequestDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const currentUser = await requireRole(Role.Editor, Role.Admin);

  const [request, assets, publishingLinks, statusHistory, internalNotes] =
    await Promise.all([
      clipRequestRepository.findById(params.id),
      uploadedAssetRepository.findByRequestId(params.id),
      publishingLinkRepository.findByRequestId(params.id),
      requestStatusHistoryRepository.findByRequestId(params.id),
      internalNoteRepository.findByRequestId(params.id),
    ]);

  if (!request) notFound();

  // Separate source materials from the staff-uploaded edited clip
  const sourceAssets = assets.filter((a) => a.assetType !== AssetType.EditedClip);
  const editedClip = assets
    .filter(
      (a) =>
        a.assetType === AssetType.EditedClip &&
        a.uploadStatus === AssetUploadStatus.Uploaded
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;

  const view = staffRequestPresentationService.buildRequestView(
    request,
    sourceAssets,
    publishingLinks,
    statusHistory,
    internalNotes
  );

  const dueDateStatus = dueDateConfirmationService.getDueDateStatus(request);

  // Request locking: a request in Editing is locked to the staff who accepted it.
  // Other staff can view the detail but cannot perform workflow actions.
  const isLockedByOther =
    request.status === RequestStatus.Editing &&
    !!request.assignedStaffId &&
    request.assignedStaffId !== currentUser.id;

  // Show clip upload panel when editing is active or the clip may already exist
  const showClipUpload = [
    RequestStatus.Editing,
    RequestStatus.ScheduledForPublishing,
    RequestStatus.Published,
    RequestStatus.Delivered,
    RequestStatus.Rejected,
  ].includes(request.status);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/staff" className="hover:text-blue-600">Staff</Link>
        <span>/</span>
        <Link href="/staff/editing" className="hover:text-blue-600">Editing</Link>
        <span>/</span>
        <span className="font-medium text-slate-700">{view.title}</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{view.title}</h1>
            <StaffStatusBadge status={view.status} />
            {view.isOverdue && (
              <Badge variant="red">Overdue</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Request #{view.id} &middot; Submitted:{" "}
            {view.submittedAt
              ? staffRequestPresentationService.formatDate(view.submittedAt)
              : "Not submitted"}
          </p>
          <p className="text-sm text-slate-500">
            {view.statusPresentation.operationalDescription}
          </p>
        </div>
      </div>

      {/* Locked by another staff member */}
      {isLockedByOther && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm font-semibold text-amber-800">Request locked</p>
          <p className="mt-0.5 text-xs text-amber-700">
            This request is currently being edited by another staff member. You can
            view the details, but workflow actions are unavailable until they reject
            it back to the queue.
          </p>
        </div>
      )}

      {/* AI Video Pipeline shortcut — shown when request is in Editing */}
      {request.status === RequestStatus.Editing && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-blue-800">AI Video Production Pipeline</p>
            <p className="mt-0.5 text-xs text-blue-600">
              Generate and publish a 15-second short video using ChatGPT, Kling AI, ElevenLabs and FFmpeg.
            </p>
          </div>
          <a
            href={`/staff/requests/${params.id}/pipeline`}
            className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Open Pipeline →
          </a>
        </div>
      )}

      {/* Workflow actions */}
      {view.statusPresentation.nextActions.length > 0 && (
        <Section title="Actions">
          <StaffActionButtons
            requestId={view.id}
            currentStatus={view.status}
            isLockedByOther={isLockedByOther}
          />
        </Section>
      )}

      {/* Edited clip upload — shown during and after editing */}
      {showClipUpload && (
        <EditedClipUploadPanel
          requestId={view.id}
          editedClip={editedClip ? {
            id: editedClip.id,
            fileName: editedClip.fileName,
            fileSizeBytes: editedClip.fileSizeBytes,
          } : null}
          targetPlatforms={request.targetPlatforms}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — 2/3 */}
        <div className="space-y-6 lg:col-span-2">
          {/* Brief */}
          <Section title="Clip Brief">
            <div className="space-y-4">
              <Field label="Title" value={view.title} />
              <Field label="Description" value={<p className="whitespace-pre-wrap">{view.description}</p>} />
              <Field label="Target Audience" value={view.targetAudience} />
              <Field
                label="Target Platforms"
                value={
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {view.targetPlatforms.map((p) => (
                      <span key={p} className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs text-blue-700">
                        {p}
                      </span>
                    ))}
                  </div>
                }
              />
              <Field label="Preferred Style / Tone" value={view.preferredStyle} />
              {view.preferredLanguage && (
                <Field label="Preferred Language" value={view.preferredLanguage} />
              )}
            </div>
          </Section>

          {/* Uploaded assets */}
          <Section title={`Uploaded Files (${view.assets.length})`}>
            {view.assets.length === 0 ? (
              <p className="text-sm text-slate-400">No files uploaded.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {view.assets.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    id={asset.id}
                    fileName={asset.fileName}
                    mimeType={asset.mimeType}
                    fileSizeBytes={asset.fileSizeBytes}
                    thumbnailUrl={asset.thumbnailUrl}
                    hasStorageKey={!!asset.storageKey}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* Publishing links */}
          {publishingLinks.length > 0 && (
            <Section title="Publishing Links">
              <div className="space-y-2">
                {publishingLinks.map((link) => (
                  <div key={link.id} className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-3">
                    <div>
                      <p className="font-medium text-slate-800">
                        {PLATFORM_LABELS[link.platform] ?? link.platform}
                      </p>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {link.url}
                      </a>
                    </div>
                    <p className="text-xs text-slate-400">
                      {staffRequestPresentationService.formatDate(link.publishedAt)}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Status history */}
          <Section title="Status History">
            {view.statusHistory.length === 0 ? (
              <p className="text-sm text-slate-400">No history yet.</p>
            ) : (
              <div className="space-y-2">
                {view.statusHistory.map((entry) => (
                  <div key={entry.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="mt-1 h-2 w-2 rounded-full bg-slate-400" />
                      <div className="w-0.5 flex-1 bg-slate-200" />
                    </div>
                    <div className="pb-3">
                      <div className="flex items-center gap-2">
                        <StaffStatusBadge status={entry.status} />
                        <span className="text-xs text-slate-400">
                          {staffRequestPresentationService.formatRelativeDate(entry.changedAt)}
                        </span>
                      </div>
                      {entry.note && (
                        <p className="mt-1 text-xs text-slate-600">{entry.note}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Right column — 1/3 */}
        <div className="space-y-6">
          {/* Due date */}
          <Section title="Due Date">
            <div className="space-y-3">
              <Field
                label="System Estimate"
                value={dueDateStatus.formattedEstimate ?? "Not calculated"}
              />
              <Field
                label="Confirmed Due Date"
                value={
                  dueDateStatus.isConfirmed && dueDateStatus.formattedConfirmed ? (
                    <span className={dueDateStatus.isOverdue ? "font-medium text-red-600" : "font-medium text-green-700"}>
                      {dueDateStatus.formattedConfirmed}
                      {dueDateStatus.isOverdue && " (overdue)"}
                    </span>
                  ) : (
                    <span className="text-amber-600">Not confirmed yet</span>
                  )
                }
              />
              {dueDateStatus.daysRemaining !== null && (
                <Field
                  label="Days Remaining"
                  value={
                    <span className={dueDateStatus.daysRemaining <= 1 ? "text-amber-600 font-medium" : ""}>
                      {dueDateStatus.daysRemaining}
                    </span>
                  }
                />
              )}
              {!dueDateStatus.isConfirmed && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">
                  Due date not confirmed. Requester sees a pending message.
                </p>
              )}
            </div>
          </Section>

          {/* Effort class */}
          <Section title="Effort Classification">
            <div className="space-y-2">
              <Field
                label="Effort Class"
                value={
                  view.effortClass ? (
                    <span className="font-medium">
                      {EFFORT_CLASS_LABELS[view.effortClass]}
                    </span>
                  ) : (
                    <span className="text-slate-400">Not set</span>
                  )
                }
              />
              <p className="text-xs text-slate-400">
                Update effort class from the Actions section above.
              </p>
            </div>
          </Section>

          {/* Hold / rejection info */}
          {view.holdReason && (
            <Section title="Hold Reason">
              <p className="text-sm text-amber-800 bg-amber-50 rounded p-3">{view.holdReason}</p>
              <p className="mt-2 text-xs text-slate-400">Visible to requester.</p>
            </Section>
          )}

          {view.rejectionReason && (
            <Section title="Rejection Reason">
              <p className="text-sm text-red-700 bg-red-50 rounded p-3">{view.rejectionReason}</p>
              <p className="mt-2 text-xs text-slate-400">Visible to requester.</p>
            </Section>
          )}

          {/* Credits */}
          <Section title="Credits">
            <Field label="Credits charged" value={view.creditsCost} />
          </Section>
        </div>
      </div>

      {/* Internal notes */}
      <Section title="Internal Notes">
        <InternalNotesPanel requestId={view.id} notes={view.internalNotes} />
      </Section>
    </div>
  );
}
