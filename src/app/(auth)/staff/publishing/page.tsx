import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { clipRequestRepository, publishingLinkRepository } from "@/repositories";
import { PLATFORM_LABELS } from "@/domain/enums/Platform";
import { StaffStatusBadge } from "@/features/staff/components/StaffStatusBadge";

export const metadata: Metadata = { title: "Publishing — Staff" };

export default async function PublishingPage() {
  await requireRole(Role.Editor, Role.Admin);

  const requests = await clipRequestRepository.findByStatus([RequestStatus.Published]);

  const rows = await Promise.all(
    requests.map(async (req) => {
      const links = await publishingLinkRepository.findByRequestId(req.id);
      return { req, links };
    })
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Publishing</h1>
        <p className="mt-1 text-sm text-slate-500">
          Clips approved by admin and ready to be delivered to the requester.
          Add publishing links for each target platform, then mark as Delivered.
        </p>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
          {rows.length} clip{rows.length !== 1 ? "s" : ""} ready
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">No clips in publishing at the moment.</p>
          <p className="mt-1 text-xs text-slate-400">
            Clips appear here after admin approves them in Production Review.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(({ req, links }) => {
            const allLinked = req.targetPlatforms.every((p) =>
              links.some((l) => l.platform === p)
            );
            const isOverdue = !!req.confirmedDueDate && req.confirmedDueDate < new Date();
            return (
              <div
                key={req.id}
                className={`rounded-lg border bg-white p-5 ${isOverdue ? "border-red-200" : "border-slate-200"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{req.title}</h3>
                      <StaffStatusBadge status={req.status} />
                      {allLinked && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          All links added
                        </span>
                      )}
                    </div>

                    {/* Platform coverage */}
                    <div className="flex flex-wrap gap-1">
                      {req.targetPlatforms.map((platform) => {
                        const hasLink = links.some((l) => l.platform === platform);
                        return (
                          <span
                            key={platform}
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              hasLink
                                ? "bg-green-100 text-green-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {hasLink ? "✓ " : "○ "}
                            {PLATFORM_LABELS[platform] ?? platform}
                          </span>
                        );
                      })}
                    </div>

                    {/* Publishing links */}
                    {links.length > 0 && (
                      <div className="space-y-1">
                        {links.map((link) => (
                          <div key={link.id} className="flex items-center gap-2 text-xs">
                            <span className="font-medium text-slate-500">
                              {PLATFORM_LABELS[link.platform] ?? link.platform}:
                            </span>
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                              className="truncate text-blue-600 hover:underline"
                            >
                              {link.url}
                            </a>
                          </div>
                        ))}
                      </div>
                    )}

                    {req.confirmedDueDate && (
                      <p className={`text-xs ${isOverdue ? "text-red-600 font-medium" : "text-slate-500"}`}>
                        Due:{" "}
                        {req.confirmedDueDate.toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        {isOverdue && " — overdue"}
                      </p>
                    )}
                  </div>

                  <Link
                    href={`/staff/requests/${req.id}`}
                    className="shrink-0 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Manage →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
