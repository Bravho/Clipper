import type { Metadata } from "next";
import { headers } from "next/headers";
import { isAppUserAgent } from "@/lib/mobile/appUserAgent";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/config/studioRollout";
import { getServerI18n } from "@/i18n/server";
import { CampaignQuickVideo } from "@/features/campaigns/CampaignQuickVideo";

export const metadata: Metadata = { title: "Shop video — RClipper", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * /c/<slug>?k=<qr key> — a shop campaign's customer page. No login.
 *
 * Reached from a scanned campaign QR only: without the right `k` the API
 * refuses every call, so the page shows "scan the QR at the shop again". The
 * video is rendered on the phone, so a web browser gets "open this in the
 * RClipper app" instead (in `next dev` a desktop browser is let through).
 */
export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { k?: string };
}) {
  const { t } = getServerI18n();
  const inApp =
    isAppUserAgent(headers().get("user-agent")) || process.env.NODE_ENV === "development";

  if (!inApp) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10 text-center">
        <h1 className="text-xl font-bold text-slate-900">{t("campaign.browser.title")}</h1>
        <p className="text-sm leading-relaxed text-slate-600">{t("campaign.browser.body")}</p>
        <div className="mt-2 flex flex-col gap-2">
          {APP_STORE_URL && (
            <a href={APP_STORE_URL} className="min-h-[48px] rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
              App Store
            </a>
          )}
          {PLAY_STORE_URL && (
            <a href={PLAY_STORE_URL} className="min-h-[48px] rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
              Google Play
            </a>
          )}
        </div>
      </div>
    );
  }

  return <CampaignQuickVideo slug={params.slug} qrKey={searchParams.k ?? ""} />;
}
