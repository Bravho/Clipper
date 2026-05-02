import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { adminCreditService } from "@/services/admin/AdminCreditService";

export const metadata: Metadata = { title: "Credit Management — Admin" };

export default async function AdminCreditsPage() {
  await requireRole(Role.Admin);

  const [summaries, platformStats] = await Promise.all([
    adminCreditService.getAllRequesterCreditSummaries(),
    adminCreditService.getPlatformCreditStats(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Credit Management</h1>
        <p className="mt-1 text-sm text-slate-500">
          Monitor credit balances, usage, and grants across all requesters.
        </p>
      </div>

      {/* Platform stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-3xl font-bold text-slate-900">
            {platformStats.totalSignupCreditsGranted}
          </p>
          <p className="mt-1 text-sm text-slate-500">Signup Credits Granted</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-3xl font-bold text-slate-900">
            {platformStats.totalAdminCreditsGranted}
          </p>
          <p className="mt-1 text-sm text-slate-500">Admin Credits Granted</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-3xl font-bold text-slate-900">
            {platformStats.totalCreditsUsed}
          </p>
          <p className="mt-1 text-sm text-slate-500">Total Credits Used</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-3xl font-bold text-slate-900">
            {platformStats.totalActiveBalance}
          </p>
          <p className="mt-1 text-sm text-slate-500">Active Balance (all requesters)</p>
        </div>
      </div>

      {/* Per-requester credit table */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Requester Credit Balances
        </h2>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Requester</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Total Granted</th>
                <th className="px-4 py-3">Total Used</th>
                <th className="px-4 py-3">Transactions</th>
                <th className="px-4 py-3">Last Transaction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summaries.map((s) => (
                <tr key={s.user.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{s.user.name}</p>
                    <p className="text-xs text-slate-400">{s.user.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-bold ${
                        s.balance < 10 ? "text-amber-600" : "text-slate-900"
                      }`}
                    >
                      {s.balance}
                    </span>
                    {s.balance < 10 && (
                      <span className="ml-1 text-xs text-amber-500">low</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">+{s.totalGranted}</td>
                  <td className="px-4 py-3 text-slate-600">{s.totalUsed}</td>
                  <td className="px-4 py-3 text-slate-600">{s.transactionCount}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {s.lastTransactionAt
                      ? s.lastTransactionAt.toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Placeholder for future credit grant UI */}
      <div className="rounded-lg border border-dashed border-slate-200 bg-white p-5 text-sm text-slate-500 space-y-1">
        <p className="font-medium text-slate-700">Future Capabilities (Placeholder)</p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>Grant credits to a specific requester (admin credit adjustment)</li>
          <li>Refund credits for cancelled or errored requests</li>
          <li>Credit purchase / top-up integration (future payment system)</li>
          <li>Full transaction history per user (accessible via user detail page)</li>
          <li>TODO: PostgreSQL — CreditService.grantCredits() is already implemented; wire to admin UI</li>
        </ul>
      </div>
    </div>
  );
}
