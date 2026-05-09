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

export const metadata: Metadata = { title: "แดชบอร์ด — RClipper" };

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
            ยินดีต้อนรับกลับ, {user.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-slate-500">
            จัดการคำขอคลิปและติดตามความคืบหน้าของคุณ
          </p>
        </div>
        <Link href={ROUTES.REQUESTS_NEW}>
          <Button disabled={!canAfford}>
            + คำขอใหม่
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
              {summary.creditBalance} เครดิต
            </p>
            <Link href={ROUTES.CREDITS}>
              <p className="text-sm text-blue-700 hover:underline cursor-pointer">
                ดูประวัติเครดิต →
              </p>
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-3xl font-bold text-slate-900">
            {summary.activeRequestCount}
          </p>
          <p className="mt-1 text-sm text-slate-500">คำขอที่กำลังดำเนินการ</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-3xl font-bold text-slate-900">
            {summary.draftCount}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            แบบร่างที่ยังไม่เสร็จ
          </p>
          {summary.draftCount > 0 && (
            <Link href={ROUTES.REQUESTS}>
              <p className="mt-1 text-xs text-blue-600 hover:underline cursor-pointer">
                ดำเนินการต่อ →
              </p>
            </Link>
          )}
        </div>
      </div>

      {/* Insufficient credits warning */}
      {!canAfford && (
        <div className="mb-6 rounded-xl border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm font-medium text-yellow-800">
            คุณมีเครดิตคงเหลือ {summary.creditBalance} เครดิต —
            ไม่เพียงพอสำหรับการส่งคำขอใหม่ (ต้องการ {CREDITS_CONFIG.REQUEST_COST_CREDITS} เครดิต)
          </p>
          <p className="mt-1 text-sm text-yellow-700">
            กรุณาติดต่อฝ่ายสนับสนุนหากต้องการเครดิตเพิ่มเติม
          </p>
        </div>
      )}

      {/* Active Requests */}
      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">คำขอที่กำลังดำเนินการ</h2>
          <Link href={ROUTES.REQUESTS} className="text-sm text-blue-600 hover:underline">
            ดูทั้งหมด →
          </Link>
        </div>

        {summary.activeRequests.length === 0 ? (
          <Card>
            <div className="text-center py-6">
              <p className="text-slate-500 text-sm">ไม่มีคำขอที่กำลังดำเนินการขณะนี้</p>
              {canAfford ? (
                <Link href={ROUTES.REQUESTS_NEW}>
                  <Button className="mt-4" variant="outline" size="sm">
                    ส่งคำขอแรกของคุณ
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
            ส่งมอบล่าสุด
          </h2>
          <div className="flex flex-col gap-3">
            {summary.recentlyDelivered.map((row) => (
              <Link key={row.id} href={requestDetailPath(row.id)}>
                <Card className="cursor-pointer transition-shadow hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{row.title}</p>
                      <p className="text-xs text-slate-400">
                        ส่งมอบเมื่อ{" "}
                        {row.deliveredAt.toLocaleDateString("th-TH", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="green">ส่งมอบแล้ว</Badge>
                      <span className="text-xs text-slate-500">
                        {row.linkCount} ลิงก์
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
            <CardTitle className="text-sm">ราคาและเครดิต</CardTitle>
            <CardDescription>
              คำขอคลิปแต่ละรายการใช้ {CREDITS_CONFIG.REQUEST_COST_CREDITS} เครดิต
              คุณได้รับ {CREDITS_CONFIG.SIGNUP_BONUS_CREDITS} เครดิตฟรีเมื่อสมัครสมาชิก
            </CardDescription>
          </CardHeader>
          <Link href={ROUTES.CREDITS}>
            <p className="mt-3 text-xs text-blue-600 hover:underline cursor-pointer">
              ดูประวัติเครดิต →
            </p>
          </Link>
        </Card>

        <Card>
          <CardHeader padding="none">
            <CardTitle className="text-sm">สิทธิ์ความเป็นเจ้าของ</CardTitle>
            <CardDescription>
              คลิปที่ตัดต่อแล้วเป็นของ RClipper คุณสามารถแชร์และโพสต์คลิปที่ส่งมอบแล้วบนช่องทางของคุณเองได้
            </CardDescription>
          </CardHeader>
          <Link href={ROUTES.LEGAL}>
            <p className="mt-3 text-xs text-blue-600 hover:underline cursor-pointer">
              อ่านนโยบายฉบับเต็ม →
            </p>
          </Link>
        </Card>
      </div>
    </div>
  );
}
