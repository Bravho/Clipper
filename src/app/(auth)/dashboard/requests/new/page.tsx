import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { ROUTES } from "@/config/routes";
import { creditService } from "@/services/CreditService";
import { CREDITS_CONFIG } from "@/config/credits";
import { NewRequestForm } from "@/features/requests/components/NewRequestForm";

export const metadata: Metadata = { title: "New Request — RClipper" };

export default async function NewRequestPage() {
  const user = await requireRole(Role.Requester);
  const balance = await creditService.getBalance(user.id);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-slate-500">
        <Link href={ROUTES.DASHBOARD} className="hover:text-slate-700">
          Dashboard
        </Link>
        <span>/</span>
        <Link href={ROUTES.REQUESTS} className="hover:text-slate-700">
          My Requests
        </Link>
        <span>/</span>
        <span className="text-slate-700 font-medium">New Request</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">New Clip Request</h1>
        <p className="mt-2 text-slate-500 text-sm">
          Fill out the form below to submit a new clip request. Each around-10-seconds
          clip costs {CREDITS_CONFIG.REQUEST_COST_CREDITS} credits. Our team will review your
          brief and begin production once accepted.
        </p>
      </div>

      <NewRequestForm creditBalance={balance} />
    </div>
  );
}
