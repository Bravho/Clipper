import type { Metadata } from "next";
import { headers } from "next/headers";
import { isAppUserAgent } from "@/lib/mobile/appUserAgent";
import { getServerI18n } from "@/i18n/server";
import { QrScanner } from "@/features/campaigns/QrScanner";

export const metadata: Metadata = { title: "Scan shop QR — RClipper", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * /scan — the app's QR scanner for shop campaigns (menu: "Scan shop QR").
 * No login. A web browser is told to use the app (the phone camera app can
 * scan a printed QR on its own).
 */
export default function ScanPage() {
  const { t } = getServerI18n();
  const inApp =
    isAppUserAgent(headers().get("user-agent")) || process.env.NODE_ENV === "development";
  if (!inApp) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-10 text-center">
        <h1 className="text-xl font-bold text-slate-900">{t("campaign.browser.title")}</h1>
        <p className="text-sm text-slate-600">{t("campaign.browser.body")}</p>
      </div>
    );
  }
  return <QrScanner />;
}
