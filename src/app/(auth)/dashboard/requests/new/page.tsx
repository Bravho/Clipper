import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { ROUTES } from "@/config/routes";
import { creditService } from "@/services/CreditService";
import { clipRequestService } from "@/services/ClipRequestService";
import { PackageSelector } from "@/features/requests/components/PackageSelector";
import { getServerI18n } from "@/i18n/server";

export const metadata: Metadata = { title: "คำขอใหม่ — RClipper" };

export default async function NewRequestPage() {
  const { t } = getServerI18n();
  const pageStartedAt = performance.now();
  const timings: Record<string, number> = {};
  const timed = async <T,>(label: string, operation: () => Promise<T>): Promise<T> => {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      timings[label] = Math.round(performance.now() - startedAt);
    }
  };

  const user = await timed("auth", () => requireRole(Role.Requester));
  const [balance, trialAvailable] = await Promise.all([
    timed("creditBalance", () => creditService.getBalance(user.id)),
    timed("trialAvailable", () => clipRequestService.isFirstRequest(user.id)),
  ]);

  if (process.env.NEW_REQUEST_PERF_LOG === "1") {
    console.info("[new-request timing]", {
      ...timings,
      totalDataLoad: Math.round(performance.now() - pageStartedAt),
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-slate-500">
        <Link href={ROUTES.DASHBOARD} className="hover:text-slate-700">
          {t("nav.dashboard")}
        </Link>
        <span>/</span>
        <Link href={ROUTES.REQUESTS} className="hover:text-slate-700">
          {t("sidebar.requests")}
        </Link>
        <span>/</span>
        <span className="text-slate-700 font-medium">{t("request.breadcrumbNew")}</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">{t("request.newTitle")}</h1>
        <p className="mt-2 text-slate-500 text-sm">
          {t("request.newSubtitle")}
        </p>
      </div>

      <PackageSelector creditBalance={balance} trialAvailable={trialAvailable} />
    </div>
  );
}
