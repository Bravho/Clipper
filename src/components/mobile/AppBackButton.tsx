"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

import { useI18n } from "@/i18n/client";
import { isTopLevelPath, parentPath } from "./appBackPaths";

/**
 * A back button in the app bar of the iOS app (Tho, 13 Oct).
 *
 * Android has a system back button; an iPhone has none, so a page reached from the menu or a link (Pricing from
 * the studio, a request's detail, Credits, Channel Management…) left the user
 * with only the hamburger to get out. Every page except the top-level ones
 * gets a "‹" before the logo.
 *
 * It goes back in history when there is somewhere to go back to inside the
 * app; otherwise (the app was opened straight onto this page by a push
 * notification or a link) it goes up one level instead.
 *
 * Renders nothing on the web and on Android, and nothing during the server
 * render — the platform is only known after mount.
 */

export function AppBackButton() {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [isIosApp, setIsIosApp] = useState(false);

  useEffect(() => {
    setIsIosApp(Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios");
  }, []);

  if (!isIosApp || isTopLevelPath(pathname)) return null;

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(parentPath(pathname ?? "/dashboard"));
  };

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={t("common.back")}
      className="-ml-2 flex h-10 min-w-[2.5rem] flex-shrink-0 items-center justify-center rounded-md px-2 text-2xl leading-none text-slate-700 hover:bg-slate-100 active:bg-slate-200"
    >
      <span aria-hidden="true">‹</span>
    </button>
  );
}
