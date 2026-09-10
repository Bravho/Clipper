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
import { isManagementEnabledFor } from "@/config/management";
import { ManagementPurchaseStatus } from "@/domain/models/ManagementPurchase";
import {
  PackagePicker,
  type PackageOption,
} from "@/features/management/components/PackagePicker";
import { VideoPackagePicker } from "@/features/pricing/components/VideoPackagePicker";
import { EntitlementSummary } from "@/features/pricing/components/EntitlementSummary";
import {
  PurchaseHistory,
  type PurchaseHistoryRow,
} from "@/features/pricing/components/PurchaseHistory";
import { managementPackageCopy } from "@/features/pricing/packageCopy";
import {
  FREE_REQUESTS_PER_WINDOW,
  FREE_WINDOW_DAYS,
  REQUESTS_PER_PAID_MONTH,
  VIDEO_PACKAGES,
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
    const product = managementProducts.find((m) => m.code === purchase.productCode);
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
  const entryPrice = Math.min(...VIDEO_PACKAGES.map((p) => p.priceCredits));
  const ladderVars = {
    freeTotal: FREE_REQUESTS_PER_WINDOW,
    days: FREE_WINDOW_DAYS,
    paidTotal: REQUESTS_PER_PAID_MONTH,
    price: entryPrice,
  };

  /** What the same term costs bought as two separate packages. */
  const separatePriceFor = (months: number | null): number | null => {
    const videoPkg = VIDEO_PACKAGES.find((v) => v.months === months);
    const pass = managementProducts.find(
      (m) => m.videoMonths == null && m.durationMonths === months
    );
    if (!videoPkg || !pass) return null;
    return videoPkg.priceCredits + pass.priceCredits;
  };

  const toOption = (p: (typeof managementProducts)[number]): PackageOption => {
    const copy = managementPackageCopy(t, p);
    const separate = p.videoMonths ? separatePriceFor(p.durationMonths) : null;
    return {
      code: p.code,
      name: copy.name,
      description: copy.description,
      terms: copy.terms,
      productType: p.productType,
      durationMonths: p.durationMonths,
      uploadAllowance: p.uploadAllowance,
      accessWindowDays: p.accessWindowDays,
      videoMonths: p.videoMonths,
      badge:
        separate && separate > p.priceCredits
          ? t("pricing.bundleSaving", { amount: separate - p.priceCredits })
          : null,
      priceCredits: p.priceCredits,
      fullPriceCredits: p.fullPriceCredits,
    };
  };

  const bundleOptions = managementProducts
    .filter((p) => p.videoMonths != null)
    .map(toOption);
  // The entry upload bundle is no longer offered for sale. It stays in the
  // catalogue (and in `managementProducts` above) so purchase history and any
  // unspent tokens still resolve to a name — it is only withheld from the
  // picker.
  const publishingOptions = managementProducts
    .filter((p) => p.videoMonths == null)
    .filter((p) => p.code !== "management_single_video")
    .map(toOption);

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

      {/* 1. Video generation on its own. */}
      <div className="mb-10">
        <VideoPackagePicker balanceCredits={balance} activeUntil={videoActiveUntil} />
      </div>

      {/* 2. Channel Management on its own. Hidden entirely for users it is not
          enabled for, rather than shown as something they cannot buy. */}
      {managementEnabled && publishingOptions.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-semibold text-slate-900">
            {t("pricing.managementHeading")}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {t("pricing.managementSubheading")}
          </p>
          <div className="mt-4">
            <PackagePicker
              balanceCredits={balance}
              returnTo={ROUTES.PRICING}
              chrome={false}
              products={publishingOptions}
            />
          </div>
        </section>
      )}

      {/* 3. Both together, last — by now the reader knows what the two halves
          cost separately, so the saving badge is checkable rather than a claim. */}
      {managementEnabled && bundleOptions.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-slate-900">
            {t("pricing.bundleHeading")}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {t("pricing.bundleSubheading", { paidTotal: REQUESTS_PER_PAID_MONTH })}
          </p>
          <div className="mt-4">
            <PackagePicker
              balanceCredits={balance}
              returnTo={ROUTES.PRICING}
              chrome={false}
              products={bundleOptions}
            />
          </div>
          <p className="mt-3 text-xs text-slate-400">{t("pricing.bundleFootnote")}</p>
        </section>
      )}

      <PurchaseHistory rows={history} />
    </div>
  );
}
