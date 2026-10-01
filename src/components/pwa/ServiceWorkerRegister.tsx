"use client";

import { useEffect } from "react";

import { isNativeMobile } from "@/lib/mobile/platform";
import { purgeAppShellCaches } from "@/lib/client/appRecovery";

/**
 * sessionStorage flag: this app session already dropped a service worker and
 * reloaded once. Guards against a reload loop if unregistering ever fails.
 */
const NATIVE_SW_RELOAD_KEY = "clipper:nativeSwRemoved";

/**
 * Registers the service worker (public/sw.js) — in a WEB BROWSER only.
 *
 * ── Why the app never gets a service worker ─────────────────────────────────
 * The server tells "the app" from "a browser" by the user-agent marker the
 * native shell appends (`RClipperNative/<platform>`, capacitor.config.ts).
 * Android's WebView applies that custom user agent to the page's own requests
 * but NOT to requests made by a service worker, which use the WebView's stock
 * user agent. sw.js intercepts navigations (`fetch(request)` for the offline
 * fallback), so once it was installed every full page load in the app reached
 * the server looking like mobile Chrome: `/` rendered the marketing page with
 * the App Store / Google Play buttons, the middleware sent requester pages to
 * /get-the-app, and the studio / "New video" routing picked the browser path.
 * The first launch after an install looked fine (no worker yet), every later
 * launch did not.
 *
 * The app needs nothing from the worker (push is native, and HTML is not
 * cached anyway), so inside the app it is not registered — and an install that
 * already has one drops it and reloads once, so the page is re-requested from
 * the server with the app's real user agent.
 *
 * Production only in a browser: a stale SW during `next dev` hides local
 * changes.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    if (isNativeMobile()) {
      void removeWorkerInsideApp();
      return;
    }

    if (process.env.NODE_ENV !== "production") return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          // Non-fatal: the app still works without offline support.
          console.error("[pwa] service worker registration failed:", err);
        });
    };

    // `load` may already have fired by the time this effect runs.
    if (document.readyState === "complete") {
      onLoad();
      return;
    }
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}

async function removeWorkerInsideApp(): Promise<void> {
  let hadWorker = Boolean(navigator.serviceWorker.controller);
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    hadWorker = hadWorker || registrations.length > 0;
  } catch {
    /* storage restricted — treat as no worker */
  }
  if (!hadWorker) return;

  await purgeAppShellCaches();

  // This document was fetched by the worker, i.e. with the WebView's stock user
  // agent, so the server may have answered it as "a browser". Ask again once.
  if (!navigator.serviceWorker.controller) return;
  try {
    if (window.sessionStorage.getItem(NATIVE_SW_RELOAD_KEY)) return;
    window.sessionStorage.setItem(NATIVE_SW_RELOAD_KEY, "1");
  } catch {
    return; // no sessionStorage: cannot guard a reload, so do not reload
  }
  console.warn("[pwa] removed service worker inside the app; reloading with the app user agent");
  window.location.reload();
}
