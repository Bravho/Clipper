import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { ROUTES } from "@/config/routes";
import { creditService } from "@/services/CreditService";
import { TransactionType } from "@/domain/enums/TransactionType";
import { CREDITS_CONFIG } from "@/config/credits";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Credits — RClipper" };

const TRANSACTION_LABELS: Record<TransactionType, string> = {
  [TransactionType.SignupBonus]: "Signup Bonus",
  [TransactionType.RequestCharge]: "Request Charge",
  [TransactionType.AdminCredit]: "Credit Grant",
  [TransactionType.AdminDebit]: "Credit Deduction",
};

const TRANSACTION_VARIANTS: Record<
  TransactionType,
  "green" | "red" | "blue" | "default"
> = {
  [TransactionType.SignupBonus]: "green",
  [TransactionType.RequestCharge]: "red",
  [TransactionType.AdminCredit]: "blue",
  [TransactionType.AdminDebit]: "red",
};

export default async function CreditsPage() {
  const user = await requireRole(Role.Requester);
  const [balance, transactions] = await Promise.all([
    creditService.getBalance(user.id),
    creditService.getTransactionHistory(user.id),
  ]);

  const canAfford = balance >= CREDITS_CONFIG.REQUEST_COST_CREDITS;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
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
              Each around-10-seconds clip request costs{" "}
              {CREDITS_CONFIG.REQUEST_COST_CREDITS} credits.
            </p>
            {!canAfford && (
              <p className="mt-1 text-sm font-medium text-yellow-700">
                Insufficient credits for a new request. Please contact support.
              </p>
            )}
          </div>
        </div>

        {canAfford && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <Link href={ROUTES.REQUESTS_NEW}>
              <button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
                Submit a new request →
              </button>
            </Link>
          </div>
        )}
      </Card>

      {/* Pricing info */}
      <Card className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">How credits work</h2>
        <ul className="flex flex-col gap-2 text-sm text-slate-600">
          <li className="flex items-start gap-2">
            <span className="text-green-500 font-bold mt-0.5">+</span>
            New accounts receive {CREDITS_CONFIG.SIGNUP_BONUS_CREDITS} free credits on signup.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-red-500 font-bold mt-0.5">−</span>
            Each clip request (around 10 seconds) costs{" "}
            {CREDITS_CONFIG.REQUEST_COST_CREDITS} credits.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-500 font-bold mt-0.5">i</span>
            If you need more credits, please contact our support team.
          </li>
        </ul>
        {/* TODO: Future — add paid top-up section here when billing is implemented. */}
      </Card>

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
                  <p className="text-sm text-slate-700">{txn.description}</p>
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
