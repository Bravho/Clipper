/* RClipper service worker.
 *
 * ── Why this file is conservative about HTML ──────────────────────────────────
 * The previous version cached every successful navigation into a hand-versioned
 * runtime cache and served it whenever the network failed. In a browser tab that
 * is a reasonable offline story. In the Capacitor WebView it was the source of a
 * hard, sticky failure:
 *
 *   Next.js HTML is build-coupled — it names `/_next/static/chunks/<buildhash>/…`
 *   files that only exist for the deployment that produced it. Once the site is
 *   redeployed those URLs 404. Serving yesterday's cached HTML therefore hands
 *   the app a document whose scripts cannot load, which surfaces as a
 *   ChunkLoadError (or "Unexpected token '<'", because a 404 body is HTML) and,
 *   with no error boundary, the bare white "Application error: a client-side
 *   exception has occurred" page. Every subsequent open re-read the same cached
 *   HTML, so the app stayed broken until its data was cleared.
 *
 *   The WebView reaches that fallback far more often than a browser does: Android
 *   kills the renderer under memory pressure (locking the screen during a large
 *   upload is a reliable way to trigger it) and reloads the document while the
 *   radio is still coming out of doze — network-first fails, cache answers.
 *
 * So: HTML is never cached. Offline navigation gets the offline page instead of
 * a stale shell. Only content-addressed assets — `/_next/static/*` filenames
 * contain a build hash and are immutable — are cached, and only when the
 * response is actually OK (the old version happily cached 404 pages, which
 * poisoned the cache further).
 *
 * Strategy:
 *   - /api/*              -> network-only (never cache authenticated data)
 *   - navigations         -> network-only, offline page as the failure fallback
 *   - RSC / _next/data    -> not intercepted (build-coupled, must stay live)
 *   - /_next/static/*     -> cache-first (immutable, content-hashed)
 *   - icons/images/fonts  -> cache-first with background refresh
 *   - everything else     -> not intercepted
 *
 * Bump CACHE_VERSION to force clients onto a fresh cache.
 */
const CACHE_VERSION = "rclipper-v3";
const PRECACHE = `${CACHE_VERSION}-precache`;
const RUNTIME = `${CACHE_VERSION}-runtime`;
/** Self-contained offline fallback: no scripts, no stylesheets, nothing that can
 *  be tied to a particular build. The button re-issues the navigation, which is
 *  all the user needs once the radio is back. */
const OFFLINE_HTML = `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ออฟไลน์ — RClipper</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f8fafc;color:#0f172a;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans Thai',sans-serif">
<div style="max-width:340px;text-align:center">
<h1 style="font-size:18px;font-weight:600;margin:0 0 8px">ไม่มีการเชื่อมต่ออินเทอร์เน็ต</h1>
<p style="font-size:14px;color:#64748b;margin:0 0 20px">ข้อมูลและไฟล์ที่อัปโหลดไว้แล้วยังอยู่ครบ เชื่อมต่อแล้วลองใหม่อีกครั้ง</p>
<button type="button" onclick="location.reload()" style="border:0;border-radius:6px;background:#1d4ed8;color:#fff;font-size:14px;padding:10px 16px">ลองอีกครั้ง</button>
</div></body></html>`;

/**
 * NOTE: no HTML here on purpose. A precached `/offline` document would itself go
 * stale across deployments and reference dead `_next/static` chunks — the exact
 * problem this worker now exists to avoid. The offline fallback below is
 * script-free inline HTML instead, so it can never break.
 */
const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/logo.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(CACHE_VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** Let the page purge everything and take a new worker immediately — used by the
 *  client-side stale-shell recovery in @/lib/client/appRecovery. */
self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (type === "CLEAR_CACHES") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

/**
 * Immutable, content-addressed build output. The build hash is in the path, so a
 * cache hit can never be "stale" — a changed file is a different URL.
 */
function isImmutableBuildAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

/**
 * Static media that is safe to serve from cache while it refreshes in the
 * background. Deliberately NOT a bare `\.js$|\.css$` test: that matched
 * top-level scripts (including /sw.js itself) whose contents change in place
 * between deployments without their URL changing.
 */
function isCacheableMedia(url) {
  return (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/logo.png" ||
    url.pathname === "/manifest.webmanifest" ||
    /\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf)$/.test(url.pathname)
  );
}

/** Only store real, complete, same-origin successes. Caching an opaque or error
 *  response is what turns one bad deploy into a permanently broken client. */
function isCacheable(response) {
  return Boolean(
    response &&
      response.ok &&
      response.status === 200 &&
      (response.type === "basic" || response.type === "default")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Never cache API traffic — always hit the network.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            JSON.stringify({ error: "offline", message: "No network connection." }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          )
      )
    );
    return;
  }

  // React Server Component payloads and Next data requests are tied to the
  // running build exactly like HTML is. Leave them to the browser: a cached
  // payload from an older build cannot be rendered by the current one.
  if (
    request.headers.get("RSC") === "1" ||
    request.headers.get("Next-Router-Prefetch") === "1" ||
    url.pathname.startsWith("/_next/data/") ||
    url.searchParams.has("_rsc")
  ) {
    return;
  }

  // Navigations: network only. On failure show the offline page rather than a
  // cached document from a superseded deployment (see the header comment).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(OFFLINE_HTML, {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
      )
    );
    return;
  }

  // Immutable build output: cache-first, and let a genuine failure BE a failure
  // so the app's stale-shell recovery can see it and reload onto a fresh build.
  if (isImmutableBuildAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (isCacheable(response)) {
            const copy = response.clone();
            caches.open(RUNTIME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Icons/images/fonts: cache-first with background refresh.
  if (isCacheableMedia(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (isCacheable(response)) {
              const copy = response.clone();
              caches.open(RUNTIME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Anything else: don't intercept. The previous default branch could resolve to
  // `undefined` on a cache miss, which respondWith turns into a network error —
  // i.e. it broke requests it was meant to pass through.
});

/* ── Web Push ──────────────────────────────────────────────────────────────
 * The server (PushNotificationService.sendWeb) posts a VAPID push whose payload
 * is { title, body, data: { path, requestId, eventKey } }. Render it, and on tap
 * focus an existing tab (or open one) at the request's page. */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = {};
  }
  const title = payload.title || "RClipper";
  const data = payload.data || {};
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { path: data.path || "/dashboard/requests" },
    // Collapse repeat notifications for the same pipeline event.
    tag: data.eventKey || undefined,
    renotify: Boolean(data.eventKey),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path =
    (event.notification.data && event.notification.data.path) || "/dashboard/requests";
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if (client.url.includes(path) && "focus" in client) return client.focus();
      }
      for (const client of clientList) {
        if ("navigate" in client && "focus" in client) {
          await client.navigate(path).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(path);
    })()
  );
});
