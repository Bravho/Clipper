"use client";

import { useEffect } from "react";
import { isStaleShellError, recoverStaleShell } from "@/lib/client/appRecovery";

/**
 * Catches stale-shell failures that never reach a React error boundary.
 *
 * `error.tsx` / `global-error.tsx` only see errors thrown *during render*. The
 * most common way a superseded deployment breaks the long-lived WebView is
 * outside render entirely:
 *
 *   - the App Router prefetches a route and its `import()` rejects
 *     → an unhandled promise rejection, no render, no boundary;
 *   - a `<script src="/_next/static/chunks/…">` tag 404s
 *     → a resource-level `error` event on `window`, no boundary;
 *   - a `next/dynamic` component's chunk fails while the user is idle
 *     → an unhandled rejection.
 *
 * Any of those leaves the app in a half-loaded state where the next
 * interaction throws the white "Application error" page. Reacting to them
 * directly means the shell heals before the user notices. `recoverStaleShell`
 * enforces a once-per-minute cooldown, so this can never become a reload loop.
 *
 * Renders nothing.
 */
export function ChunkErrorRecovery() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isStaleShellError(event.reason)) return;
      const reason =
        event.reason instanceof Error ? event.reason.message : String(event.reason);
      void recoverStaleShell(`unhandled rejection: ${reason}`);
    };

    const onError = (event: ErrorEvent) => {
      // A failed <script>/<link> load surfaces as an error event whose target is
      // the element itself, with no `error` object attached — so the message
      // checks below would never match it.
      const target = event.target;
      if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) {
        const src = target instanceof HTMLScriptElement ? target.src : target.href;
        if (typeof src === "string" && src.includes("/_next/static/")) {
          void recoverStaleShell(`static asset failed to load: ${src}`);
          return;
        }
      }
      if (isStaleShellError(event.error) || isStaleShellError(event.message)) {
        void recoverStaleShell(`window error: ${event.message}`);
      }
    };

    window.addEventListener("unhandledrejection", onRejection);
    // Capture phase: resource-load errors do not bubble.
    window.addEventListener("error", onError, true);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError, true);
    };
  }, []);

  return null;
}
