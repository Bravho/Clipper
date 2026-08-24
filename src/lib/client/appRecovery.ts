/**
 * Client-side recovery from a stale application shell.
 *
 * WHY THIS EXISTS
 * ---------------
 * RClipper runs inside a long-lived Capacitor WebView pointed at the deployed
 * site, with a service worker in front of it. That combination has a specific
 * failure mode that a normal browser tab almost never hits:
 *
 *   1. The WebView keeps one document alive for days. It is never hard-reloaded.
 *   2. Android kills the WebView renderer under memory pressure (e.g. while the
 *      screen is locked during a large upload). On resume the document reloads.
 *   3. That reload can be served the *previous deployment's* HTML — either from
 *      the service worker's runtime cache (network-first falls back to cache
 *      when the radio is still waking from doze) or from the WebView's own
 *      back-forward cache.
 *   4. Next.js HTML is build-coupled: it references `/_next/static/chunks/<hash>`
 *      URLs that no longer exist after a deploy. Those requests 404 (and the
 *      404 body is HTML, not JS), so `import()` rejects with a ChunkLoadError
 *      or the parser throws "Unexpected token '<'".
 *   5. With no error boundary, React unmounts the whole tree and Next's built-in
 *      root boundary paints the bare white
 *      "Application error: a client-side exception has occurred" page.
 *
 * The failure is *sticky*: every subsequent open re-reads the same poisoned
 * cache, which is why reopening the request kept showing the same screen.
 *
 * The cure is always the same — throw away the cached shell and load a fresh
 * document from the network — so it is worth doing automatically rather than
 * asking the user to clear app data.
 */

/** Errors whose only real cure is re-fetching the application shell. */
export function isStaleShellError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name ?? "";
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";

  return (
    name === "ChunkLoadError" ||
    // webpack/Next chunk failures
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Loading CSS chunk/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    // A 404/offline HTML page returned where a JS module was expected.
    /Unexpected token '<'/i.test(message) ||
    /expected expression, got '<'/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

/**
 * Drop every service-worker cache and unregister the worker.
 *
 * Deliberately unregisters rather than only clearing caches: an old worker
 * script can itself hold the stale routing logic that caused the problem, and a
 * fresh registration happens on the next load from the root layout.
 * Never throws — recovery must not fail on a WebView with storage restricted.
 */
export async function purgeAppShellCaches(): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)));
    }
  } catch {
    /* storage unavailable — nothing to purge */
  }

  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map((registration) => registration.unregister().catch(() => false))
      );
    }
  } catch {
    /* no service worker support — nothing to unregister */
  }
}

/**
 * sessionStorage key holding the timestamp of the last automatic recovery
 * reload. A reload loop is far worse than the error page it replaces — if the
 * fresh shell *also* throws, the user would be stuck watching the app reload
 * forever — so recovery is allowed at most once per RELOAD_COOLDOWN_MS.
 */
const RELOAD_MARK_KEY = "clipper:shellRecovery:lastReloadAt";
const RELOAD_COOLDOWN_MS = 60_000;

function readLastReloadAt(): number {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_MARK_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markReloaded(): void {
  try {
    window.sessionStorage.setItem(RELOAD_MARK_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * Purge the cached shell and hard-reload, at most once per cooldown window.
 * Returns false when the cooldown blocked it, so the caller can fall back to
 * showing a manual "reload" button instead of silently doing nothing.
 */
export async function recoverStaleShell(reason: string): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const since = Date.now() - readLastReloadAt();
  if (since < RELOAD_COOLDOWN_MS) {
    console.error(
      `[recovery] stale-shell recovery suppressed (last attempt ${Math.round(
        since / 1000
      )}s ago): ${reason}`
    );
    return false;
  }

  console.warn(`[recovery] purging app shell and reloading: ${reason}`);
  markReloaded();
  await purgeAppShellCaches();

  // Cache-busting query so neither the WebView's HTTP cache nor a
  // still-controlling worker can hand back the same stale document.
  const url = new URL(window.location.href);
  url.searchParams.set("_r", String(Date.now()));
  window.location.replace(url.toString());
  return true;
}

/** Manual recovery for a "try again" button — always purges, always reloads. */
export async function forceReloadFresh(): Promise<void> {
  await purgeAppShellCaches();
  const url = new URL(window.location.href);
  url.searchParams.set("_r", String(Date.now()));
  window.location.replace(url.toString());
}
