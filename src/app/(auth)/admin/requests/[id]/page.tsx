import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import {
  clipRequestRepository,
  productionReviewRepository,
  internalNoteRepository,
  uploadedAssetRepository,
  publishingLinkRepository,
  requestStatusHistoryRepository,
} from "@/repositories";
import { AdminStatusBadge } from "@/features/admin/components/AdminStatusBadge";
import { ProductionReviewBadge } from "@/features/admin/components/ProductionReviewBadge";
import { AdminActionButtons } from "@/features/admin/components/AdminActionButtons";

export const metadata: Metadata = { title: "Request Detail — Admin" };

export default async function AdminRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(Role.Admin);
  const { id } = await params;

  const [request, review, notes, assets, links, history] = await Promise.all([
    clipRequestRepository.findById(id),
    productionReviewRepository.findLatestByRequestId(id),
    internalNoteRepository.findByRequestId(id),
    uploadedAssetRepository.findByRequestId(id),
    publishingLinkRepository.findByRequestId(id),
    requestStatusHistoryRepository.findByRequestId(id),
  ]);

  if (!request) notFound();

  const isPendingAdminReview = request.status === RequestStatus.ScheduledForPublishing;
  const now = new Date();
  const isOverdue =
    request.confirmedDueDate &&
    request.confirmedDueDate < now &&
    !["published", "delivered", "rejected", "on_hold"].includes(request.status);

  return (
    <div className="space-y-8">
      {/* Back + header */}
      <div>
        <Link
          href="/admin/requests"
          className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
        >
          ← All Requests
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{request.title}</h1>
          <AdminStatusBadge status={request.status} />
          {review && <ProductionReviewBadge status={review.status} />}
          {isOverdue && (
            <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
              Overdue
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-400">ID: {request.id}</p>
      </div>

      {/* Admin action panel — only when pending review */}
      {isPendingAdminReview && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-orange-800">
              Production Review — Action Required
            </h2>
            <p className="mt-1 text-xs text-orange-700">
              Staff has submitted this clip for your review. Approve to proceed to
              publishing, or return to editing / hold / reject as needed.
            </p>
          </div>
          <AdminActionButtons requestId={request.id} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — brief + operational data */}
        <div className="lg:col-span-2 space-y-6">
          {/* Brief */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Clip Brief
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-medium text-slate-500">Description</p>
                <p className="mt-0.5 text-slate-800">{request.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500">Target Audience</p>
                  <p className="mt-0.5 text-slate-800">{request.targetAudience}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Platforms</p>
                  <p className="mt-0.5 text-slate-800">{request.targetPlatforms.join(", ")}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Style / Tone</p>
                  <p className="mt-0.5 text-slate-800">{request.preferredStyle}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Language</p>
                  <p className="mt-0.5 text-slate-800">{request.preferredLanguage}</p>
                </div>
              </div>
            </div>
          </section>

          {/* Production review record */}
          {review && (
            <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                Production Review Record
              </h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs font-medium text-slate-500">Review Status</p>
                  <div className="mt-0.5">
                    <ProductionReviewBadge status={review.status} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Submitted for Review</p>
                  <p className="mt-0.5 text-slate-800">
                    {review.submittedAt.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                {review.reviewedBy && (
                  <div>
                    <p className="text-xs font-medium text-slate-500">Reviewed By</p>
                    <p className="mt-0.5 text-slate-800">{review.reviewedBy}</p>
                  </div>
                )}
                {review.reviewedAt && (
                  <div>
                    <p className="text-xs font-medium text-slate-500">Reviewed At</p>
                    <p className="mt-0.5 text-slate-800">
                      {review.reviewedAt.toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                )}
                {review.reviewNote && (
                  <div className="col-span-2">
                    <p className="text-xs font-medium text-slate-500">Review Note</p>
                    <p className="mt-0.5 text-slate-800">{review.reviewNote}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Internal notes */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Internal Notes ({notes.length})
            </h2>
            {notes.length === 0 ? (
              <p className="text-sm text-slate-400">No internal notes yet.</p>
            ) : (
              <div className="space-y-3">
                {notes.map((note) => (
                  <div key={note.id} className="rounded-md bg-slate-50 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-700">{note.authorName}</span>
                      <span className="text-xs text-slate-400">
                        {note.createdAt.toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-600">{note.content}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Status history */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Status History
            </h2>
            <div className="space-y-2">
              {[...history]
                .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())
                .map((h) => (
                  <div key={h.id} className="flex gap-3 text-sm">
                    <span className="text-xs text-slate-400 mt-0.5 shrink-0">
                      {h.changedAt.toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <div>
                      <AdminStatusBadge status={h.status} />
                      {h.note && (
                        <p className="mt-1 text-xs text-slate-500">{h.note}</p>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </section>
        </div>

        {/* Right column — operational sidebar */}
        <div className="space-y-5">
          {/* Operational metadata */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3 text-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Operational Data
            </h2>
            <div className="space-y-2">
              <div>
                <p className="text-xs text-slate-500">Requester</p>
                <p className="font-medium text-slate-800">{request.userId}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Assigned Staff</p>
                <p className="font-medium text-slate-800">{request.assignedStaffId ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Effort Class</p>
                <p className="font-medium text-slate-800 capitalize">{request.effortClass ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Confirmed Due Date</p>
                <p className={`font-medium ${isOverdue ? "text-red-600" : "text-slate-800"}`}>
                  {request.confirmedDueDate
                    ? request.confirmedDueDate.toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : "Not confirmed"}
                  {isOverdue && " ⚠ Overdue"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Internal Estimate</p>
                <p className="text-slate-600">
                  {request.estimatedDueDate
                    ? request.estimatedDueDate.toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Submitted</p>
                <p className="text-slate-600">
                  {request.submittedAt
                    ? request.submittedAt.toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "Not submitted"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Credits Cost</p>
                <p className="text-slate-600">{request.creditsCost} credits</p>
              </div>
            </div>
          </section>

          {/* Hold/reject reasons */}
          {(request.holdReason || request.rejectionReason) && (
            <section
              className={`rounded-lg border p-5 space-y-2 text-sm ${
                request.holdReason ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"
              }`}
            >
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {request.holdReason ? "Hold Reason" : "Rejection Reason"}
              </h2>
              <p className="text-slate-700">
                {request.holdReason ?? request.rejectionReason}
              </p>
            </section>
          )}

          {/* Source assets */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3 text-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Source Assets ({assets.length})
            </h2>
            {assets.length === 0 ? (
              <p className="text-slate-400 text-xs">No assets uploaded.</p>
            ) : (
              <ul className="space-y-2">
                {assets.map((asset) => (
                  <li key={asset.id} className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        asset.assetType === "video"
                          ? "bg-blue-100 text-blue-700"
                          : asset.assetType === "edited_clip"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {asset.assetType}
                    </span>
                    <span className="text-slate-700 text-xs truncate">{asset.fileName}</span>
                  </li>
                ))}
              </ul>
            )}
            {/* TODO: DigitalOcean Spaces — add presigned download link for each asset */}
          </section>

          {/* Publishing links */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3 text-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Publishing Links ({links.length})
            </h2>
            {links.length === 0 ? (
              <p className="text-slate-400 text-xs">No publishing links recorded.</p>
            ) : (
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.id}>
                    <span className="text-xs text-slate-500">{link.platform}: </span>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline truncate block"
                    >
                      {link.url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Delivery readiness */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-2 text-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Delivery Readiness
            </h2>
            <div className="space-y-1">
              <ReadinessRow
                label="Clip published"
                ready={[RequestStatus.Published, RequestStatus.Delivered].includes(request.status)}
              />
              <ReadinessRow
                label="Publishing links recorded"
                ready={links.length > 0}
              />
              <ReadinessRow
                label="Downloadable asset"
                ready={assets.some((a) => a.assetType === "edited_clip")}
                todo
              />
              {/* TODO: DigitalOcean Spaces — verify final clip asset URL exists */}
              <ReadinessRow
                label="Delivered to requester"
                ready={request.status === RequestStatus.Delivered}
              />
            </div>
          </section>

          {/* Staff detail link */}
          <Link
            href={`/staff/requests/${request.id}`}
            className="block rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 text-center hover:bg-slate-50 transition"
          >
            View in Staff Portal →
          </Link>
        </div>
      </div>
    </div>
  );
}

function ReadinessRow({
  label,
  ready,
  todo,
}: {
  label: string;
  ready: boolean;
  todo?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-600">{label}</span>
      {todo ? (
        <span className="text-slate-400">TODO</span>
      ) : ready ? (
        <span className="text-green-600 font-medium">✓</span>
      ) : (
        <span className="text-slate-400">—</span>
      )}
    </div>
  );
}
