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
} from "@/repositories";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Card } from "@/components/ui/Card";
import { RequestStatusBadge } from "@/features/requests/components/RequestStatusBadge";
import { DueDateDisplay } from "@/features/requests/components/DueDateDisplay";
import { DeliveryLinks } from "@/features/requests/components/DeliveryLinks";
import { RequestTimeline } from "@/features/requests/components/RequestTimeline";
import { CREDITS_CONFIG } from "@/config/credits";
import { AssetUploadStatus } from "@/domain/enums/AssetType";

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
  const [assets, publishingLinks, statusHistory] = await Promise.all([
    uploadedAssetRepository.findByRequestId(id),
    publishingLinkRepository.findByRequestId(id),
    requestStatusHistoryRepository.findByRequestId(id),
  ]);

  const view = requestPresentationService.buildRequestView(
    request,
    assets,
    publishingLinks,
    statusHistory
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
          {view.statusPresentation.description}
        </p>

        {/* Queue info */}
        {view.queueDisplay.show && (
          <p className="mt-2 text-sm text-slate-500">{view.queueDisplay.message}</p>
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
