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
import { DraftRequestsBanner } from "@/features/requests/components/DraftRequestsBanner";
import { CancelRequestButton } from "@/features/requests/components/CancelRequestButton";
import { videoQuotaService } from "@/services/VideoQuotaService";
import { getServerI18n } from "@/i18n/server";
import { intlLocale } from "@/i18n/config";
import type { MessageKey } from "@/i18n/messages";

export const metadata: Metadata = { title: "คำขอของฉัน — RClipper" };

const STATUS_FILTERS = [
  { label: "requests.filter.all", value: "all" },
  { label: "requests.filter.active", value: "active" },
  { label: "requests.filter.delivered", value: "delivered" },
  { label: "requests.filter.onHold", value: "on_hold" },
  { label: "requests.filter.rejected", value: "rejected" },
] as const satisfies ReadonlyArray<{ label: MessageKey; value: string }>;

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
  const { t, locale } = getServerI18n();
  const dateTag = intlLocale(locale);
  const user = await requireRole(Role.Requester);
  const params = await searchParams;
  const filter = (params.filter ?? "all") as FilterValue;

  const [allRequests, quota] = await Promise.all([
    clipRequestService.listForUser(user.id),
    videoQuotaService.getQuota(user.id),
  ]);

  const filtered = allRequests.filter(
    (r) =>
      r.status !== RequestStatus.Draft && matchesFilter(r.status, filter)
  );

  const drafts = allRequests.filter((r) => r.status === RequestStatus.Draft);

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-bold text-slate-900 sm:text-2xl">
            {t("sidebar.requests")}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t("requests.total", { count: allRequests.length })}
          </p>
        </div>
        <Link href={ROUTES.REQUESTS_NEW} className="sm:flex-shrink-0">
          <Button fullWidth disabled={!quota.canSubmit} className="sm:w-auto">
            {t("dashboard.newRequest")}
          </Button>
        </Link>
      </div>

      {/* Drafts banner */}
      <DraftRequestsBanner drafts={drafts} />

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
            {t(f.label)}
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
                  {t("requests.none")}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  {t("requests.noneHint", { remaining: quota.remaining, total: quota.total })}
                </p>
                {quota.canSubmit && (
                  <Link href={ROUTES.REQUESTS_NEW}>
                    <Button className="mt-5" variant="primary">
                      {t("dashboard.firstRequest")}
                    </Button>
                  </Link>
                )}
              </>
            ) : (
              <p className="text-slate-500">
                {t("requests.noMatch")}
              </p>
            )}
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((req) => {
            const dueDateDisplay =
              requestPresentationService.getDueDateDisplay(req, locale);
            const queueDisplay =
              requestPresentationService.getQueueDisplay(req, locale);

            return (
              <Link
                key={req.id}
                href={requestDetailPath(req.id)}
                className="block min-w-0"
              >
                <Card
                  padding="sm"
                  className="cursor-pointer transition-shadow hover:shadow-md sm:p-6"
                >
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium leading-6 text-slate-900 sm:truncate">
                        {req.title}
                      </p>
                      <p className="mt-0.5 break-words text-xs leading-5 text-slate-400">
                        {req.submittedAt
                          ? t("requests.submittedOn", {
                              date: req.submittedAt.toLocaleDateString(dateTag, {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              }),
                            })
                          : t("requests.createdOn", {
                              date: req.createdAt.toLocaleDateString(dateTag, {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              }),
                            })}
                      </p>
                      {queueDisplay.show && (
                        <p className="mt-1.5 break-words text-xs leading-5 text-slate-500">
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
                    <div className="flex min-w-0 flex-col items-start gap-2 border-t border-slate-100 pt-3 sm:flex-shrink-0 sm:items-end sm:border-0 sm:pt-0">
                      <RequestStatusBadge status={req.status} />
                      <DueDateDisplay
                        display={dueDateDisplay}
                        className="max-w-full break-words sm:max-w-64 sm:text-right"
                      />
                      <p className="text-xs text-slate-400">
                        {t("dashboard.credits", { count: req.creditsCost })}
                      </p>
                      {req.status === RequestStatus.Submitted && (
                        <CancelRequestButton requestId={req.id} status={req.status} />
                      )}
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
