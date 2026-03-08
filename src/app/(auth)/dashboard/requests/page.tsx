import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { ROUTES, requestDetailPath } from "@/config/routes";
import { clipRequestService } from "@/services/ClipRequestService";
import { requestPresentationService } from "@/services/RequestPresentationService";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { RequestStatusBadge } from "@/features/requests/components/RequestStatusBadge";
import { DueDateDisplay } from "@/features/requests/components/DueDateDisplay";
import { DeleteDraftButton } from "@/features/requests/components/DeleteDraftButton";
import { CREDITS_CONFIG } from "@/config/credits";
import { creditService } from "@/services/CreditService";

export const metadata: Metadata = { title: "My Requests — RClipper" };

const STATUS_FILTERS = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Delivered", value: "delivered" },
  { label: "On Hold", value: "on_hold" },
  { label: "Rejected", value: "rejected" },
] as const;

type FilterValue = (typeof STATUS_FILTERS)[number]["value"];

function matchesFilter(status: RequestStatus, filter: FilterValue): boolean {
  if (filter === "all") return true;
  if (filter === "active") {
    return [
      RequestStatus.Submitted,
      RequestStatus.UnderReview,
      RequestStatus.AcceptedForProduction,
      RequestStatus.Editing,
      RequestStatus.ScheduledForPublishing,
    ].includes(status);
  }
  if (filter === "delivered") {
    return (
      status === RequestStatus.Delivered || status === RequestStatus.Published
    );
  }
  if (filter === "on_hold") return status === RequestStatus.OnHold;
  if (filter === "rejected") return status === RequestStatus.Rejected;
  return true;
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requireRole(Role.Requester);
  const params = await searchParams;
  const filter = (params.filter ?? "all") as FilterValue;

  const [allRequests, balance] = await Promise.all([
    clipRequestService.listForUser(user.id),
    creditService.getBalance(user.id),
  ]);

  const canAfford = balance >= CREDITS_CONFIG.REQUEST_COST_CREDITS;

  const filtered = allRequests.filter(
    (r) =>
      r.status !== RequestStatus.Draft && matchesFilter(r.status, filter)
  );

  const drafts = allRequests.filter((r) => r.status === RequestStatus.Draft);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Requests</h1>
          <p className="mt-1 text-slate-500 text-sm">
            {allRequests.length} total request{allRequests.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link href={ROUTES.REQUESTS_NEW}>
          <Button disabled={!canAfford}>+ New Request</Button>
        </Link>
      </div>

      {/* Drafts banner */}
      {drafts.length > 0 && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-700">
            You have {drafts.length} unsaved draft{drafts.length !== 1 ? "s" : ""}.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {drafts.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-lg bg-white border border-slate-200 px-4 py-2 hover:shadow-sm transition-shadow"
              >
                <span className="text-sm text-slate-800">{d.title || "Untitled Draft"}</span>
                <div className="flex items-center gap-4">
                  <DeleteDraftButton requestId={d.id} />
                  <Link href={requestDetailPath(d.id)} className="text-xs text-blue-600 hover:text-blue-800">
                    Continue editing →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-5 flex gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={`${ROUTES.REQUESTS}?filter=${f.value}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === f.value
                ? "bg-blue-700 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Request list */}
      {filtered.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            {allRequests.filter((r) => r.status !== RequestStatus.Draft).length === 0 ? (
              <>
                <p className="text-slate-500 font-medium">
                  You haven't submitted any requests yet.
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Submit your first request to get started. Each clip costs{" "}
                  {CREDITS_CONFIG.REQUEST_COST_CREDITS} credits.
                </p>
                {canAfford && (
                  <Link href={ROUTES.REQUESTS_NEW}>
                    <Button className="mt-5" variant="primary">
                      Submit a Request
                    </Button>
                  </Link>
                )}
              </>
            ) : (
              <p className="text-slate-500">
                No requests match the selected filter.
              </p>
            )}
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((req) => {
            const dueDateDisplay =
              requestPresentationService.getDueDateDisplay(req);
            const queueDisplay =
              requestPresentationService.getQueueDisplay(req);

            return (
              <Link key={req.id} href={requestDetailPath(req.id)}>
                <Card className="cursor-pointer transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 truncate">
                        {req.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {req.submittedAt
                          ? `Submitted ${req.submittedAt.toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}`
                          : `Created ${req.createdAt.toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}`}
                      </p>
                      {queueDisplay.show && (
                        <p className="mt-1.5 text-xs text-slate-500">
                          {queueDisplay.message}
                        </p>
                      )}
                      {(req.status === RequestStatus.OnHold ||
                        req.status === RequestStatus.Rejected) &&
                        (req.holdReason || req.rejectionReason) && (
                          <p className="mt-1.5 text-xs text-red-600 line-clamp-1">
                            {req.holdReason || req.rejectionReason}
                          </p>
                        )}
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <RequestStatusBadge status={req.status} />
                      <DueDateDisplay display={dueDateDisplay} />
                      <p className="text-xs text-slate-400">
                        {req.creditsCost} credits
                      </p>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
