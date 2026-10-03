import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { ROUTES, requestDetailPath } from "@/config/routes";
import { creditService } from "@/services/CreditService";
import { TransactionType } from "@/domain/enums/TransactionType";
import { PlanComparison } from "@/features/pricing/components/PlanLimits";
import { getServerI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CreditPurchaseOptions } from "@/features/credits/components/CreditPurchaseOptions";


export const metadata: Metadata = { title: "เครดิต — RClipper" };

const TRANSACTION_LABELS: Record<TransactionType, MessageKey> = {
  [TransactionType.SignupBonus]: "credits.txn.signupBonus",
  [TransactionType.RequestCharge]: "credits.txn.requestCharge",
  [TransactionType.RequestRefund]: "credits.txn.refund",
  [TransactionType.AdminCredit]: "credits.txn.adminCredit",
  [TransactionType.AdminDebit]: "credits.txn.adminDebit",
  [TransactionType.DiscountApplied]: "credits.txn.discount",
  [TransactionType.TopUp]: "credits.txn.topUp",
  [TransactionType.ManagementPurchase]: "credits.txn.packagePurchase",
  [TransactionType.ManagementRefund]: "credits.txn.packageRefund",
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
  const { t, locale } = getServerI18n();
  const user = await requireRole(Role.Requester);
  const query = await searchParams;
  const [balance, transactions] = await Promise.all([
    creditService.getBalance(user.id),
    creditService.getTransactionHistory(user.id),
  ]);

  const dateFmt = new Intl.DateTimeFormat(locale === "th" ? "th-TH" : locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl px-4 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-slate-500">
        <Link href={ROUTES.DASHBOARD} className="hover:text-slate-700">
          {t("nav.dashboard")}
        </Link>
        <span>/</span>
        <span className="font-medium text-slate-700">{t("credits.title")}</span>
      </nav>

      <h1 className="mb-8 text-2xl font-bold text-slate-900">{t("credits.title")}</h1>

      {/* Balance card */}
      <Card className="mb-6">
        <div className="flex items-center gap-5">
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-blue-700 text-2xl font-bold text-white">
            {balance}
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold text-slate-900">
              {t("credits.available", { balance: balance.toLocaleString() })}
            </p>
            <p className="text-sm text-slate-500">{t("credits.balanceHint")}</p>
          </div>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-5">
          <Link href={ROUTES.PRICING}>
            <button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
              {t("credits.seePackages")}
            </button>
          </Link>
        </div>
      </Card>

      {/* How credits work */}
      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("credits.how.title")}</h2>
        <ul className="flex flex-col gap-2 text-sm text-slate-600">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 font-bold text-blue-500">i</span>
            <span className="min-w-0">{t("credits.how.buy")}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 font-bold text-red-500">−</span>
            <span className="min-w-0">{t("credits.how.spend")}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 font-bold text-amber-600">!</span>
            <span className="min-w-0">{t("credits.how.noRefund")}</span>
          </li>
        </ul>
      </Card>

      {/* What the credits buy, and the limits that come with it — here too,
          because this is where people pay, not only where they choose. */}
      <div className="mb-8">
        <PlanComparison t={t} />
      </div>

      <div className="mb-6">
        <CreditPurchaseOptions
          returnTo={query.returnTo}
        />
      </div>


      {/* Transaction history */}
      <div>
        <h2 className="mb-4 text-base font-semibold text-slate-900">
          {t("credits.history.title")}
        </h2>

        {transactions.length === 0 ? (
          <Card>
            <p className="py-4 text-center text-sm text-slate-400">
              {t("credits.history.empty")}
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {transactions.map((txn) => (
              <div
                key={txn.id}
                className="flex items-start justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant={TRANSACTION_VARIANTS[txn.type]}>
                      {t(TRANSACTION_LABELS[txn.type])}
                    </Badge>
                  </div>
                  {txn.referenceId ? (
                    <Link href={requestDetailPath(txn.referenceId)}>
                      <p className="cursor-pointer text-sm text-blue-600 hover:underline">
                        {txn.description}
                      </p>
                    </Link>
                  ) : (
                    <p className="text-sm text-slate-700">{txn.description}</p>
                  )}
                  <p className="text-xs text-slate-400">{dateFmt.format(txn.createdAt)}</p>
                </div>
                <p
                  className={`ml-4 flex-shrink-0 text-sm font-semibold ${
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
