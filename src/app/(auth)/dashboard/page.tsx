import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { ROUTES, requestDetailPath } from "@/config/routes";
import { requesterDashboardService } from "@/services/RequesterDashboardService";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { RequestStatusBadge } from "@/features/requests/components/RequestStatusBadge";
import { DueDateDisplay } from "@/features/requests/components/DueDateDisplay";
import { CancelRequestButton } from "@/features/requests/components/CancelRequestButton";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { CREDITS_CONFIG } from "@/config/credits";
import { getServerI18n } from "@/i18n/server";

export const metadata: Metadata = { title: "แดชบอร์ด — RClipper" };

export default async function DashboardPage() {
  const { locale, t } = getServerI18n();
  const user = await requireRole(Role.Requester);
  const summary = await requesterDashboardService.getDashboardSummary(user.id);

  const canAfford = summary.creditBalance >= CREDITS_CONFIG.REQUEST_COST_CREDITS;
  // Trial model: the first request generates for free (pay-to-download), so a
  // 0-credit new user must NOT be blocked from submitting.
  const trialAvailable = summary.trialAvailable;
  const canSubmit = trialAvailable || canAfford;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {t("dashboard.welcome", { name: user.name.split(" ")[0] })}
          </h1>
          <p className="mt-1 text-slate-500">
            {t("dashboard.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {trialAvailable && (
            <Link href={ROUTES.REQUESTS_NEW}>
              <Button className="bg-green-600 hover:bg-green-700">
                {t("dashboard.freeTrial")}
              </Button>
            </Link>
          )}
          <Link href={ROUTES.REQUESTS_NEW}>
            <Button variant={trialAvailable ? "outline" : undefined} disabled={!canSubmit}>
              {t("dashboard.newRequest")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Credits + Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-4 rounded-xl border border-blue-200 bg-blue-50 p-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-700 text-white font-bold text-lg">
            {summary.creditBalance}
          </div>
          <div>
            <p className="font-semibold text-blue-900">
              {t("dashboard.credits", { count: summary.creditBalance })}
            </p>
            <Link href={ROUTES.CREDITS}>
              <p className="text-sm text-blue-700 hover:underline cursor-pointer">
                {t("dashboard.creditHistory")}
              </p>
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-3xl font-bold text-slate-900">
            {summary.activeRequestCount}
          </p>
          <p className="mt-1 text-sm text-slate-500">{t("dashboard.activeCount")}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-3xl font-bold text-slate-900">
            {summary.draftCount}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {t("dashboard.draftCount")}
          </p>
          {summary.draftCount > 0 && (
            <Link href={ROUTES.REQUESTS}>
              <p className="mt-1 text-xs text-blue-600 hover:underline cursor-pointer">
                {t("dashboard.continue")}
              </p>
            </Link>
          )}
        </div>
      </div>

      {/* Free trial banner — shown instead of the credit warning while the
          user's free first request is still available */}
      {trialAvailable && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">
            {t("dashboard.trialTitle")}
          </p>
          <p className="mt-1 text-sm text-green-700">
            {t("dashboard.trialBody", { cost: CREDITS_CONFIG.REQUEST_COST_CREDITS })}
          </p>
        </div>
      )}

      {/* Insufficient credits warning (only after the free trial is used) */}
      {!trialAvailable && !canAfford && (
        <div className="mb-6 rounded-xl border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm font-medium text-yellow-800">
            {t("dashboard.lowCredits", {
              balance: summary.creditBalance,
              cost: CREDITS_CONFIG.REQUEST_COST_CREDITS,
            })}
          </p>
          <Link href={ROUTES.CREDITS}>
            <p className="mt-1 text-sm text-yellow-700 hover:underline cursor-pointer">
              {t("dashboard.topUp")}
            </p>
          </Link>
        </div>
      )}

      {/* Active Requests */}
      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{t("dashboard.active")}</h2>
          <Link href={ROUTES.REQUESTS} className="text-sm text-blue-600 hover:underline">
            {t("dashboard.viewAll")}
          </Link>
        </div>

        {summary.activeRequests.length === 0 ? (
          <Card>
            <div className="text-center py-6">
              <p className="text-slate-500 text-sm">{t("dashboard.noActive")}</p>
              {canSubmit ? (
                <Link href={ROUTES.REQUESTS_NEW}>
                  <Button className="mt-4" variant="outline" size="sm">
                    {trialAvailable ? t("dashboard.firstFree") : t("dashboard.firstRequest")}
                  </Button>
                </Link>
              ) : null}
            </div>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {summary.activeRequests.map((req) => {
              const cancellable =
                req.status === RequestStatus.Draft ||
                req.status === RequestStatus.Submitted;
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
                        <p className="mt-1 break-words text-xs leading-5 text-slate-400">
                          {req.statusPresentation.description}
                        </p>
                        {req.queueDisplay.show && (
                          <p className="mt-1 break-words text-xs leading-5 text-slate-500">
                            {req.queueDisplay.message}
                          </p>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-col items-start gap-2 border-t border-slate-100 pt-3 sm:flex-shrink-0 sm:items-end sm:border-0 sm:pt-0">
                        <RequestStatusBadge status={req.status} />
                        <DueDateDisplay
                          display={req.dueDateDisplay}
                          className="max-w-full break-words sm:max-w-64 sm:text-right"
                        />
                        {cancellable && (
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

      {/* Recently Delivered */}
      {summary.recentlyDelivered.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-slate-900">
            {t("dashboard.recent")}
          </h2>
          <div className="flex flex-col gap-3">
            {summary.recentlyDelivered.map((row) => (
              <Link key={row.id} href={requestDetailPath(row.id)}>
                <Card className="cursor-pointer transition-shadow hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{row.title}</p>
                      <p className="text-xs text-slate-400">
                        {t("dashboard.deliveredOn", { date: row.deliveredAt.toLocaleDateString(
                          locale === "th" ? "th-TH" : locale === "vi" ? "vi-VN" : "en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        }) })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="green">{t("dashboard.delivered")}</Badge>
                      <span className="text-xs text-slate-500">
                        {t("dashboard.links", { count: row.linkCount })}
                      </span>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader padding="none">
            <CardTitle className="text-sm">{t("dashboard.pricing")}</CardTitle>
            <CardDescription>
              {t("dashboard.pricingBody", { cost: CREDITS_CONFIG.REQUEST_COST_CREDITS })}
            </CardDescription>
          </CardHeader>
          <Link href={ROUTES.CREDITS}>
            <p className="mt-3 text-xs text-blue-600 hover:underline cursor-pointer">
              {t("dashboard.creditHistory")}
            </p>
          </Link>
        </Card>

        <Card>
          <CardHeader padding="none">
            <CardTitle className="text-sm">{t("dashboard.ownership")}</CardTitle>
            <CardDescription>
              {t("dashboard.ownershipBody")}
            </CardDescription>
          </CardHeader>
          <Link href={ROUTES.LEGAL}>
            <p className="mt-3 text-xs text-blue-600 hover:underline cursor-pointer">
              {t("dashboard.readPolicy")}
            </p>
          </Link>
        </Card>
      </div>
    </div>
  );
}
