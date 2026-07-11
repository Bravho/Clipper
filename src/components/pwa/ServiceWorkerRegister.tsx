"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (public/sw.js) on the client, in production only.
 * Rendered once from the root layout. Keeps registration out of server components
 * and avoids interfering with the dev server / HMR.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Only register in production builds — a stale SW cache during `next dev`
    // makes local changes invisible and is a common footgun.
    if (process.env.NODE_ENV !== "production") return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          // Non-fatal: the app still works without offline support.
          console.error("[pwa] service worker registration failed:", err);
        });
    };

    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
