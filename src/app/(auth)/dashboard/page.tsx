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
import { CREDITS_CONFIG } from "@/config/credits";

export const metadata: Metadata = { title: "Dashboard — RClipper" };

export default async function DashboardPage() {
  const user = await requireRole(Role.Requester);
  const summary = await requesterDashboardService.getDashboardSummary(user.id);

  const canAfford = summary.creditBalance >= CREDITS_CONFIG.REQUEST_COST_CREDITS;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome back, {user.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-slate-500">
            Manage your clip requests and track their progress.
          </p>
        </div>
        <Link href={ROUTES.REQUESTS_NEW}>
          <Button disabled={!canAfford}>
            + New Request
          </Button>
        </Link>
      </div>

      {/* Credits + Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-4 rounded-xl border border-blue-200 bg-blue-50 p-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-700 text-white font-bold text-lg">
            {summary.creditBalance}
          </div>
          <div>
            <p className="font-semibold text-blue-900">
              {summary.creditBalance} credit{summary.creditBalance !== 1 ? "s" : ""}
            </p>
            <Link href={ROUTES.CREDITS}>
              <p className="text-sm text-blue-700 hover:underline cursor-pointer">
                View credit history →
              </p>
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-3xl font-bold text-slate-900">
            {summary.activeRequestCount}
          </p>
          <p className="mt-1 text-sm text-slate-500">Active requests</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-3xl font-bold text-slate-900">
            {summary.draftCount}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Draft{summary.draftCount !== 1 ? "s" : ""} in progress
          </p>
          {summary.draftCount > 0 && (
            <Link href={ROUTES.REQUESTS}>
              <p className="mt-1 text-xs text-blue-600 hover:underline cursor-pointer">
                Continue drafts →
              </p>
            </Link>
          )}
        </div>
      </div>

      {/* Insufficient credits warning */}
      {!canAfford && (
        <div className="mb-6 rounded-xl border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm font-medium text-yellow-800">
            You have {summary.creditBalance} credit{summary.creditBalance !== 1 ? "s" : ""} remaining —
            not enough to submit a new request ({CREDITS_CONFIG.REQUEST_COST_CREDITS} credits needed).
          </p>
          <p className="mt-1 text-sm text-yellow-700">
            Please contact support if you need additional credits.
          </p>
        </div>
      )}

      {/* Active Requests */}
      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Active Requests</h2>
          <Link href={ROUTES.REQUESTS} className="text-sm text-blue-600 hover:underline">
            View all →
          </Link>
        </div>

        {summary.activeRequests.length === 0 ? (
          <Card>
            <div className="text-center py-6">
              <p className="text-slate-500 text-sm">No active requests right now.</p>
              {canAfford ? (
                <Link href={ROUTES.REQUESTS_NEW}>
                  <Button className="mt-4" variant="outline" size="sm">
                    Submit your first request
                  </Button>
                </Link>
              ) : null}
            </div>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {summary.activeRequests.map((req) => (
              <Link key={req.id} href={requestDetailPath(req.id)}>
                <Card className="cursor-pointer transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 truncate">{req.title}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {req.statusPresentation.description}
                      </p>
                      {req.queueDisplay.show && (
                        <p className="mt-1 text-xs text-slate-500">
                          {req.queueDisplay.message}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <RequestStatusBadge status={req.status} />
                      <DueDateDisplay display={req.dueDateDisplay} />
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recently Delivered */}
      {summary.recentlyDelivered.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-slate-900">
            Recently Delivered
          </h2>
          <div className="flex flex-col gap-3">
            {summary.recentlyDelivered.map((row) => (
              <Link key={row.id} href={requestDetailPath(row.id)}>
                <Card className="cursor-pointer transition-shadow hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{row.title}</p>
                      <p className="text-xs text-slate-400">
                        Delivered{" "}
                        {row.deliveredAt.toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="green">Delivered</Badge>
                      <span className="text-xs text-slate-500">
                        {row.linkCount} link{row.linkCount !== 1 ? "s" : ""}
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
            <CardTitle className="text-sm">Pricing & Credits</CardTitle>
            <CardDescription>
              Each around-10-seconds clip request costs {CREDITS_CONFIG.REQUEST_COST_CREDITS} credits.
              You received {CREDITS_CONFIG.SIGNUP_BONUS_CREDITS} free credits when you signed up.
            </CardDescription>
          </CardHeader>
          <Link href={ROUTES.CREDITS}>
            <p className="mt-3 text-xs text-blue-600 hover:underline cursor-pointer">
              View credit history →
            </p>
          </Link>
        </Card>

        <Card>
          <CardHeader padding="none">
            <CardTitle className="text-sm">Ownership & Usage</CardTitle>
            <CardDescription>
              Final edited clips belong to RClipper. You are free to repost and
              share delivered clips on your own channels.
            </CardDescription>
          </CardHeader>
          <Link href={ROUTES.LEGAL}>
            <p className="mt-3 text-xs text-blue-600 hover:underline cursor-pointer">
              Read full policy →
            </p>
          </Link>
        </Card>
      </div>
    </div>
  );
}
