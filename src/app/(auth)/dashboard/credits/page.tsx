import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { ROUTES, requestDetailPath } from "@/config/routes";
import { creditService } from "@/services/CreditService";
import { TransactionType } from "@/domain/enums/TransactionType";
import { PACKAGE_TIER_REQUESTS } from "@/config/packageTiers";
import {
  FREE_REQUESTS_PER_WINDOW,
  FREE_WINDOW_DAYS,
} from "@/config/videoPackages";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CreditPurchaseOptions } from "@/features/credits/components/CreditPurchaseOptions";


export const metadata: Metadata = { title: "Credits — RClipper" };

const TRANSACTION_LABELS: Record<TransactionType, string> = {
  [TransactionType.SignupBonus]: "Signup Bonus",
  [TransactionType.RequestCharge]: "Request Charge",
  [TransactionType.RequestRefund]: "Refund",
  [TransactionType.AdminCredit]: "Credit Grant",
  [TransactionType.AdminDebit]: "Credit Deduction",
  [TransactionType.DiscountApplied]: "Discount Applied",
  [TransactionType.TopUp]: "Stripe Top-up",
  [TransactionType.ManagementPurchase]: "Channel Management",
  [TransactionType.ManagementRefund]: "Management Refund",
};

const TRANSACTION_VARIANTS: Record<
  TransactionType,
  "green" | "red" | "blue" | "default"
> = {
  [TransactionType.SignupBonus]: "green",
  [TransactionType.RequestCharge]: "red",
  [TransactionType.RequestRefund]: "green",
  [TransactionType.AdminCredit]: "blue",
  [TransactionType.AdminDebit]: "red",
  [TransactionType.DiscountApplied]: "blue",
  [TransactionType.TopUp]: "green",
  [TransactionType.ManagementPurchase]: "red",
  [TransactionType.ManagementRefund]: "green",
};

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const user = await requireRole(Role.Requester);
  const query = await searchParams;
  const [balance, transactions] = await Promise.all([
    creditService.getBalance(user.id),
    creditService.getTransactionHistory(user.id),
  ]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl px-4 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-slate-500">
        <Link href={ROUTES.DASHBOARD} className="hover:text-slate-700">
          Dashboard
        </Link>
        <span>/</span>
        <span className="font-medium text-slate-700">Credits</span>
      </nav>

      <h1 className="mb-8 text-2xl font-bold text-slate-900">Credits</h1>

      {/* Balance card */}
      <Card className="mb-6">
        <div className="flex items-center gap-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-700 text-white font-bold text-2xl flex-shrink-0">
            {balance}
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900">
              {balance} credit{balance !== 1 ? "s" : ""} available
            </p>
            <p className="text-sm text-slate-500">
              Credits buy video packages and Channel Management packages. Making a
              video costs no credits — it uses your monthly allowance. 1 credit =
              ฿1 on web; store prices differ.
            </p>
          </div>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-5">
          <Link href={ROUTES.PRICING}>
            <button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
              See packages and pricing →
            </button>
          </Link>
        </div>
      </Card>

      {/* Pricing info */}
      <Card className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">How credits work</h2>
        <ul className="flex flex-col gap-2 text-sm text-slate-600">
          <li className="flex items-start gap-2">
            <span className="text-blue-500 font-bold mt-0.5">i</span>
            Credits are purchased in supported packages through the payment
            method available on this platform.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-red-500 font-bold mt-0.5">−</span>
            Credits are spent on packages, never on individual videos.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-500 font-bold mt-0.5">+</span>
            Every account gets {FREE_REQUESTS_PER_WINDOW} free videos per{" "}
            {FREE_WINDOW_DAYS} days. A Starter package gives{" "}
            {PACKAGE_TIER_REQUESTS.starter} a month and a Pro package{" "}
            {PACKAGE_TIER_REQUESTS.pro}, both with Channel Management included.
          </li>
        </ul>
      </Card>

      <div className="mb-6">
        <CreditPurchaseOptions
          returnTo={query.returnTo}
        />
      </div>


      {/* Transaction history */}
      <div>
        <h2 className="mb-4 text-base font-semibold text-slate-900">
          Transaction History
        </h2>

        {transactions.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-400 text-center py-4">
              No transactions yet.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {transactions.map((txn) => (
              <div
                key={txn.id}
                className="flex items-start justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant={TRANSACTION_VARIANTS[txn.type]}>
                      {TRANSACTION_LABELS[txn.type]}
                    </Badge>
                  </div>
                  {txn.referenceId ? (
                    <Link href={requestDetailPath(txn.referenceId)}>
                      <p className="text-sm text-blue-600 hover:underline cursor-pointer">
                        {txn.description}
                      </p>
                    </Link>
                  ) : (
                    <p className="text-sm text-slate-700">{txn.description}</p>
                  )}
                  <p className="text-xs text-slate-400">
                    {txn.createdAt.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <p
                  className={`text-sm font-semibold flex-shrink-0 ml-4 ${
                    txn.amount > 0 ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {txn.amount > 0 ? "+" : ""}
                  {txn.amount}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
