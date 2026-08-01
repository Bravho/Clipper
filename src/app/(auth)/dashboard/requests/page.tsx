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
import { CREDITS_CONFIG } from "@/config/credits";
import { creditService } from "@/services/CreditService";

export const metadata: Metadata = { title: "คำขอของฉัน — RClipper" };

const STATUS_FILTERS = [
  { label: "ทั้งหมด", value: "all" },
  { label: "กำลังดำเนินการ", value: "active" },
  { label: "ส่งมอบแล้ว", value: "delivered" },
  { label: "พักไว้", value: "on_hold" },
  { label: "ปฏิเสธ", value: "rejected" },
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
          <h1 className="text-2xl font-bold text-slate-900">คำขอของฉัน</h1>
          <p className="mt-1 text-slate-500 text-sm">
            {allRequests.length} คำขอทั้งหมด
          </p>
        </div>
        <Link href={ROUTES.REQUESTS_NEW}>
          <Button disabled={!canAfford}>+ คำขอใหม่</Button>
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
                  คุณยังไม่มีคำขอที่ส่งแล้ว
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  ส่งคำขอแรกเพื่อเริ่มต้น แต่ละคลิปใช้{" "}
                  {CREDITS_CONFIG.REQUEST_COST_CREDITS} เครดิต
                </p>
                {canAfford && (
                  <Link href={ROUTES.REQUESTS_NEW}>
                    <Button className="mt-5" variant="primary">
                      ส่งคำขอ
                    </Button>
                  </Link>
                )}
              </>
            ) : (
              <p className="text-slate-500">
                ไม่มีคำขอที่ตรงกับตัวกรองที่เลือก
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
                          ? `ส่งเมื่อ ${req.submittedAt.toLocaleDateString("th-TH", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}`
                          : `สร้างเมื่อ ${req.createdAt.toLocaleDateString("th-TH", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}`}
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
                        {req.creditsCost} เครดิต
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
