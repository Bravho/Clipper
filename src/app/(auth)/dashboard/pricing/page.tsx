import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";
import { ROUTES } from "@/config/routes";
import { Card } from "@/components/ui/Card";
import { creditService } from "@/services/CreditService";
import { videoQuotaService } from "@/services/VideoQuotaService";
import {
  managementAccessPassRepository,
  managementProductRepository,
  managementPurchaseRepository,
  managementUploadBundleRepository,
  videoAllowanceWindowRepository,
} from "@/repositories";
import { findManagementProduct, isManagementEnabledFor } from "@/config/management";
import { PACKAGE_TIER_REQUESTS } from "@/config/packageTiers";
import { ManagementPurchaseStatus } from "@/domain/models/ManagementPurchase";
import { PackageTiers } from "@/features/pricing/components/PackageTiers";
import { EntitlementSummary } from "@/features/pricing/components/EntitlementSummary";
import {
  PurchaseHistory,
  type PurchaseHistoryRow,
} from "@/features/pricing/components/PurchaseHistory";
import { managementPackageCopy } from "@/features/pricing/packageCopy";
import {
  FREE_REQUESTS_PER_WINDOW,
  FREE_WINDOW_DAYS,
  findVideoPackage,
} from "@/config/videoPackages";
import { getServerI18n } from "@/i18n/server";

export const metadata: Metadata = { title: "แพ็กเกจและราคา — RClipper" };
export const dynamic = "force-dynamic";

/**
 * Packages and pricing.
 *
 * ONE page for everything a requester can buy, and everything they already
 * bought. A user who has just hit their monthly limit needs a single place to
 * go — splitting video packages, Channel Management packages and bundles across
 * three screens means they find none.
 *
 * The page reads top to bottom as one argument: what you have (balance), what
 * that entitles you to and until when (status), what more costs (the three
 * pickers), and what you have already paid for (history).
 *
 * EVERY user-visible string is localised. Product copy comes from the i18n
 * catalogue via `managementPackageCopy`, never from the English `name` /
 * `description` columns on `management_products`, which exist so the row is
 * readable in a database console.
 *
 * DATES ARE FORMATTED HERE, on the server, and passed down as strings. Formatting
 * inside a client component would use the browser's locale and timezone instead
 * of the app's and produce a hydration mismatch.
 *
 * Bundle savings are computed from the two catalogues rather than written into
 * copy, so a reprice cannot leave the page claiming a saving that no longer
 * exists.
 */
export default async function PricingPage() {
  const { t, locale } = getServerI18n();
  const user = await requireRole(Role.Requester);

  const managementEnabled = isManagementEnabledFor({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  const now = new Date();

  const [balance, quota, windows, managementProducts, managementPurchases, passes, tokensRemaining] =
    await Promise.all([
      creditService.getBalance(user.id),
      videoQuotaService.getQuota(user.id),
      videoAllowanceWindowRepository.findByUserId(user.id),
      managementEnabled ? managementProductRepository.listActive() : [],
      managementEnabled ? managementPurchaseRepository.findByUserId(user.id) : [],
      managementEnabled ? managementAccessPassRepository.findByUserId(user.id) : [],
      managementEnabled
        ? managementUploadBundleRepository.countSpendableTokens(user.id, now)
        : 0,
    ]);

  const dateFmt = new Intl.DateTimeFormat(locale === "th" ? "th-TH" : locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const fmt = (d: Date) => dateFmt.format(d);

  // ── Entitlement status ────────────────────────────────────────────────────
  const liveExpiries = windows
    .filter((w) => w.expiresAt.getTime() > now.getTime())
    .map((w) => w.expiresAt.getTime());
  const videoActiveUntil =
    liveExpiries.length > 0 ? fmt(new Date(Math.max(...liveExpiries))) : null;

  const livePass = passes
    .filter((p) => p.expiresAt.getTime() > now.getTime() && !p.revokedAt)
    .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0];

  const managementStatus = managementEnabled
    ? {
        kind: livePass ? ("pass" as const) : tokensRemaining > 0 ? ("tokens" as const) : ("none" as const),
        activeUntil: livePass ? fmt(livePass.expiresAt) : null,
        tokensRemaining,
      }
    : null;

  // ── Purchase history ──────────────────────────────────────────────────────
  // A video purchase is the run of allowance windows sharing a purchase_id;
  // there is no separate purchases table for them. Group them back into one row.
  const videoPurchases = new Map<
    string,
    { productCode: string; boughtAt: Date; coverUntil: Date }
  >();
  for (const w of windows) {
    const existing = videoPurchases.get(w.purchaseId);
    if (!existing) {
      videoPurchases.set(w.purchaseId, {
        productCode: w.productCode,
        boughtAt: w.createdAt,
        coverUntil: w.expiresAt,
      });
      continue;
    }
    if (w.createdAt < existing.boughtAt) existing.boughtAt = w.createdAt;
    if (w.expiresAt > existing.coverUntil) existing.coverUntil = w.expiresAt;
  }

  const history: PurchaseHistoryRow[] = [];

  for (const [purchaseId, p] of videoPurchases) {
    const pkg = findVideoPackage(p.productCode as never);
    // A bundle grants video windows too, but it is already listed from
    // management_purchases — skip it here so one payment is not shown twice.
    if (!pkg) continue;
    history.push({
      id: `video:${purchaseId}`,
      date: fmt(p.boughtAt),
      name: t(pkg.nameKey as never),
      credits: pkg.priceCredits,
      kind: "video",
      coverage: t("pricing.history.coverUntil", { date: fmt(p.coverUntil) }),
    });
  }

  for (const purchase of managementPurchases) {
    if (purchase.status !== ManagementPurchaseStatus.Paid) continue;
    // Retired products are no longer in listActive(), so their name comes
    // from the catalogue, which keeps every product ever sold.
    const product =
      managementProducts.find((m) => m.code === purchase.productCode) ??
      findManagementProduct(purchase.productCode);
    const copy = product
      ? managementPackageCopy(t, product)
      : { name: purchase.productCode, description: "", terms: "" };
    const pass = passes.find((x) => x.purchaseId === purchase.id);
    history.push({
      id: `mgmt:${purchase.id}`,
      date: fmt(purchase.paidAt ?? purchase.createdAt),
      name: copy.name,
      credits: purchase.amountCredits,
      kind: product?.videoMonths ? "bundle" : "publishing",
      coverage: pass
        ? t("pricing.history.coverUntil", { date: fmt(pass.expiresAt) })
        : null,
    });
  }

  // Newest first, sorted on the real timestamps rather than the formatted
  // strings above — "12 ต.ค. 2569" does not sort chronologically as text.
  const timeOf = (row: PurchaseHistoryRow): number => {
    if (row.id.startsWith("video:")) {
      return videoPurchases.get(row.id.slice(6))?.boughtAt.getTime() ?? 0;
    }
    const purchase = managementPurchases.find((p) => `mgmt:${p.id}` === row.id);
    return (purchase?.paidAt ?? purchase?.createdAt)?.getTime() ?? 0;
  };
  history.sort((a, b) => timeOf(b) - timeOf(a));

  // ── Package cards ─────────────────────────────────────────────────────────
  // One kind of package since 2026-09-27: video making + Channel Management,
  // in two tiers (config/packageTiers.ts). The video-only packages and the
  // publishing-only passes are retired; the ones people hold still show in the
  // status card and the history below.
  const ladderVars = {
    freeTotal: FREE_REQUESTS_PER_WINDOW,
    days: FREE_WINDOW_DAYS,
    starterTotal: PACKAGE_TIER_REQUESTS.starter,
    proTotal: PACKAGE_TIER_REQUESTS.pro,
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8 sm:py-10">
      <header className="mb-6">
        <Link
          href={ROUTES.DASHBOARD}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← {t("nav.dashboard")}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{t("pricing.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("pricing.subtitle", ladderVars)}</p>
      </header>

      {/* Balance first: every package below is bought with credits, and the
          real-money price of a credit depends on where the user tops up. */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-slate-900">
              {t("pricing.balance", { balance: balance.toLocaleString() })}
            </p>
            <p className="mt-0.5 text-sm text-slate-500">{t("pricing.balanceHint")}</p>
          </div>
          <Link
            href={`${ROUTES.CREDITS}?returnTo=${encodeURIComponent(ROUTES.PRICING)}`}
          >
            <button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
              {t("pricing.topUp")}
            </button>
          </Link>
        </div>
      </Card>

      {/* What the balance already bought, and until when. */}
      <EntitlementSummary
        video={{
          paid: quota.tier === RequestPricingTier.Paid,
          remaining: quota.remaining,
          total: quota.total,
          activeUntil: videoActiveUntil,
          freeWindowDays: FREE_WINDOW_DAYS,
        }}
        management={managementStatus}
      />

      {/* The packages: Starter, then Pro. Hidden only for a user Channel
          Management is not enabled for (it is on for everyone in production),
          because every package includes it and checkout goes through it. */}
      {managementEnabled && (
        <div className="mb-10">
          <PackageTiers
            t={t}
            rows={managementProducts}
            balanceCredits={balance}
            returnTo={ROUTES.PRICING}
          />
        </div>
      )}

      <PurchaseHistory rows={history} />
    </div>
  );
}
