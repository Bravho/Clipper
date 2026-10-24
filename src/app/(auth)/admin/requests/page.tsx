import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository } from "@/repositories";
import { AdminStatusBadge } from "@/features/admin/components/AdminStatusBadge";
import { StudioStepBadge } from "@/features/admin/components/StudioStepBadge";
import {
  adminRequestJourneyService,
  JOURNEY_STEPS,
  journeyStepRank,
} from "@/services/admin/AdminRequestJourneyService";

export const metadata: Metadata = { title: "All Requests — Admin" };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string | string[]; sort?: string | string[] }>;
}) {
  await requireRole(Role.Admin);
  const params = await searchParams;

  const allRequests = await clipRequestRepository.findAll();
  // Furthest studio step per request (read-only; see AdminRequestJourneyService).
  const steps = await adminRequestJourneyService.latestStepsFor(allRequests);
  const now = new Date();

  const stepFilter = one(params.step);
  const filterKey = JOURNEY_STEPS.some((s) => s.key === stepFilter) ? stepFilter : undefined;
  const failedOnly = stepFilter === "failed";
  const sortByStep = one(params.sort) === "step";

  const counts = new Map<string, number>();
  let failedCount = 0;
  for (const req of allRequests) {
    const step = steps.get(String(req.id));
    if (!step) continue;
    counts.set(step.key, (counts.get(step.key) ?? 0) + 1);
    if (step.failed) failedCount++;
  }

  let requests = allRequests.filter((req) => {
    const step = steps.get(String(req.id));
    if (failedOnly) return !!step?.failed;
    return !filterKey || step?.key === filterKey;
  });
  if (sortByStep) {
    requests = [...requests].sort(
      (a, b) =>
        journeyStepRank(steps.get(String(b.id))?.key ?? "") -
          journeyStepRank(steps.get(String(a.id))?.key ?? "") ||
        b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  }

  const href = (next: { step?: string; sort?: string }) => {
    const q = new URLSearchParams();
    if (next.step) q.set("step", next.step);
    if (next.sort) q.set("sort", next.sort);
    const s = q.toString();
    return s ? `/admin/requests?${s}` : "/admin/requests";
  };
  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-xs ${
      active
        ? "border-slate-800 bg-slate-800 text-white"
        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
    }`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">All Requests</h1>
        <p className="mt-1 text-sm text-slate-500">
          {allRequests.length} total requests across the system.
          {requests.length !== allRequests.length && ` Showing ${requests.length}.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" aria-label="Filter by studio step">
        <Link href={href({ sort: sortByStep ? "step" : undefined })} className={chip(!filterKey && !failedOnly)}>
          All steps
        </Link>
        {JOURNEY_STEPS.filter((s) => counts.get(s.key)).map((s) => (
          <Link
            key={s.key}
            href={href({ step: s.key, sort: sortByStep ? "step" : undefined })}
            className={chip(filterKey === s.key)}
          >
            {s.label} · {counts.get(s.key)}
          </Link>
        ))}
        {failedCount > 0 && (
          <Link
            href={href({ step: "failed", sort: sortByStep ? "step" : undefined })}
            className={chip(failedOnly)}
          >
            Failed · {failedCount}
          </Link>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">
                <Link
                  href={href({ step: filterKey ?? (failedOnly ? "failed" : undefined), sort: sortByStep ? undefined : "step" })}
                  className="hover:text-slate-800"
                  title="Latest studio step reached. Click to sort by step."
                >
                  Status{sortByStep ? " ▼" : ""}
                </Link>
              </th>
              <th className="px-4 py-3">Due Date</th>
              <th className="px-4 py-3">Effort</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((req) => {
              const isOverdue =
                req.confirmedDueDate &&
                req.confirmedDueDate < now &&
                !["published", "delivered", "rejected", "draft"].includes(req.status);

              return (
                <tr key={req.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900 max-w-xs truncate">{req.title}</p>
                    {req.holdReason && (
                      <p className="text-xs text-amber-600">On hold</p>
                    )}
                    {req.rejectionReason && (
                      <p className="text-xs text-red-500">Rejected</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {steps.get(String(req.id)) ? (
                      <StudioStepBadge step={steps.get(String(req.id))!} />
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                    <div className="mt-1" title="Request status">
                      <AdminStatusBadge status={req.status} size="sm" />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {req.confirmedDueDate ? (
                      <span className={isOverdue ? "font-medium text-red-600" : "text-slate-600"}>
                        {req.confirmedDueDate.toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "2-digit",
                        })}
                        {isOverdue && " ⚠"}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 capitalize">
                    {req.effortClass ?? "—"}
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
    </div>
  );
}
