"use client";

import Link from "next/link";

import { StudioI18nProvider, useStudioT } from "./studioI18n";

/**
 * The note above the studio, in the studio's language (the menu's choice, else
 * the phone's) so the screen does not open in two languages at once.
 */
export function StudioBanner({ requestsHref }: { requestsHref: string }) {
  return (
    <StudioI18nProvider>
      <BannerText requestsHref={requestsHref} />
    </StudioI18nProvider>
  );
}

function BannerText({ requestsHref }: { requestsHref: string }) {
  const t = useStudioT();
  return (
    <div className="mx-auto max-w-3xl px-4 pt-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm text-amber-900">{t("renderTest.banner")}</p>
        <Link
          href={requestsHref}
          className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-amber-900 underline"
        >
          {t("renderTest.goToRequests")}
        </Link>
      </div>
    </div>
  );
}
