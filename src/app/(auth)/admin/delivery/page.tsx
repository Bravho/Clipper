import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import {
  clipRequestRepository,
  publishingLinkRepository,
  uploadedAssetRepository,
} from "@/repositories";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { AdminStatusBadge } from "@/features/admin/components/AdminStatusBadge";

export const metadata: Metadata = { title: "Delivery Monitor — Admin" };

export default async function AdminDeliveryPage() {
  await requireRole(Role.Admin);

  const [publishedRequests, deliveredRequests] = await Promise.all([
    clipRequestRepository.findByStatus([RequestStatus.Published]),
    clipRequestRepository.findByStatus([RequestStatus.Delivered]),
  ]);

  const allRequests = [...publishedRequests, ...deliveredRequests];

  // Load publishing links and assets for all relevant requests
  const [linksMap, assetsMap] = await Promise.all([
    Promise.all(
      allRequests.map((r) =>
        publishingLinkRepository.findByRequestId(r.id).then((links) => [r.id, links] as const)
      )
    ).then((entries) => Object.fromEntries(entries)),
    Promise.all(
      allRequests.map((r) =>
        uploadedAssetRepository.findByRequestId(r.id).then((assets) => [r.id, assets] as const)
      )
    ).then((entries) => Object.fromEntries(entries)),
  ]);

  function hasEditedClip(requestId: string): boolean {
    return (assetsMap[requestId] ?? []).some(
      (a) => a.assetType === AssetType.EditedClip && a.uploadStatus === AssetUploadStatus.Uploaded
    );
  }

  function linkCount(requestId: string): number {
    return (linksMap[requestId] ?? []).length;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Delivery Monitor</h1>
        <p className="mt-1 text-sm text-slate-500">
          Monitor publishing and delivery readiness for all completed clips.
        </p>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-3xl font-bold text-green-700">{publishedRequests.length}</p>
          <p className="mt-1 text-sm text-green-600">Published — Awaiting Delivery</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-3xl font-bold text-emerald-700">{deliveredRequests.length}</p>
          <p className="mt-1 text-sm text-emerald-600">Delivered</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-3xl font-bold text-slate-900">{allRequests.length}</p>
          <p className="mt-1 text-sm text-slate-500">Total in Delivery Stage</p>
        </div>
      </div>

      {/* Published — awaiting delivery confirmation */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Published — Awaiting Delivery Action
        </h2>
        {publishedRequests.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center">
            <p className="text-sm text-slate-400">No published requests awaiting delivery.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Publishing Links</th>
                  <th className="px-4 py-3">Final Clip Asset</th>
                  <th className="px-4 py-3">Delivery Ready?</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {publishedRequests.map((req) => {
                  const links = linkCount(req.id);
                  const hasClip = hasEditedClip(req.id);
                  const deliveryReady = links > 0 && hasClip;

                  return (
                    <tr key={req.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{req.title}</p>
                        <p className="text-xs text-slate-400">
                          {req.targetPlatforms.join(", ")}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            links > 0
                              ? "text-green-600 font-medium"
                              : "text-amber-600 font-medium"
                          }
                        >
                          {links > 0 ? `${links} link${links !== 1 ? "s" : ""}` : "Missing"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {hasClip ? (
                          <span className="text-green-600 font-medium">✓ Present</span>
                        ) : (
                          <span className="text-amber-600">
                            Placeholder
                            {/* TODO: DigitalOcean Spaces — verify final clip file exists */}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {deliveryReady ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                            Ready
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                            Incomplete
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {req.updatedAt.toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/requests/${req.id}`}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          Open →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delivered */}
      {deliveredRequests.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Delivered
          </h2>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Publishing Links</th>
                  <th className="px-4 py-3">Delivered</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deliveredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{req.title}</td>
                    <td className="px-4 py-3">
                      <AdminStatusBadge status={req.status} />
                    </td>
                    <td className="px-4 py-3">
                      {(linksMap[req.id] ?? []).map((link) => (
                        <div key={link.id} className="text-xs">
                          <span className="text-slate-500">{link.platform}:</span>{" "}
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            View
                          </a>
                        </div>
                      ))}
                      {(linksMap[req.id] ?? []).length === 0 && (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {req.updatedAt.toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/requests/${req.id}`}
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delivery readiness explanation */}
      <div className="rounded-lg border border-dashed border-slate-200 bg-white p-5 text-sm text-slate-500 space-y-1">
        <p className="font-medium text-slate-700">Download Readiness (Placeholder)</p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>
            Requester sees a download button once a request is Published/Delivered
            and publishing links are recorded.
          </li>
          <li>
            TODO: DigitalOcean Spaces — final edited clip is stored at a known key.
            Admin/staff will verify the file exists before marking delivery ready.
          </li>
          <li>
            TODO: Requester Portal — add download button to request detail page,
            pointing to the final clip&apos;s presigned URL from Spaces.
          </li>
          <li>
            TODO: Automatic expiry — final clips may be retained indefinitely (unlike
            raw uploads which are deleted after 90 days).
          </li>
        </ul>
      </div>
    </div>
  );
}
