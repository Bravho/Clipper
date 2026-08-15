"use client";

/**
 * Fetch the native sign-in client IDs from the server at runtime.
 *
 * The build-time `NEXT_PUBLIC_*` values are kept as a fallback, so a failed
 * fetch degrades to today's behaviour rather than hiding every provider. But the
 * server's answer wins when it has one: `NEXT_PUBLIC_*` is frozen into the JS
 * bundle by `next build`, so it reflects the build machine's environment, not
 * the running server's. See src/app/api/mobile/auth-config/route.ts.
 */

export interface NativeAuthConfig {
  googleWebClientId: string;
  googleIosClientId: string;
  appleServerConfigured: boolean;
  /** Where these values came from — surfaced in the sign-in diagnostics log. */
  source: "server" | "bundle";
}

function bundleFallback(): NativeAuthConfig {
  return {
    googleWebClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "",
    googleIosClientId: process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? "",
    // Unknowable from the bundle; assume yes so Apple is not hidden on a
    // transient network failure. A genuinely unconfigured server rejects the
    // token with `AudienceNotConfigured`, which is a visible, diagnosable error
    // rather than a silently missing button.
    appleServerConfigured: true,
    source: "bundle",
  };
}

let cached: Promise<NativeAuthConfig> | undefined;

/**
 * Cached for the lifetime of the page. The values change only on a server
 * restart, and the WebView reloads on navigation, so there is nothing to
 * invalidate — but a failed fetch is not cached, so a flaky first request does
 * not disable Google sign-in until the app is restarted.
 */
export function loadNativeAuthConfig(): Promise<NativeAuthConfig> {
  cached ??= fetchConfig().catch((error) => {
    console.warn("[auth] auth-config fetch failed, using bundled values", error);
    cached = undefined;
    return bundleFallback();
  });
  return cached;
}

async function fetchConfig(): Promise<NativeAuthConfig> {
  const response = await fetch("/api/mobile/auth-config", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`auth-config responded ${response.status}`);

  const data = (await response.json()) as {
    google?: { webClientId?: unknown; iosClientId?: unknown };
    apple?: { serverConfigured?: unknown };
  };

  const fallback = bundleFallback();
  const str = (value: unknown, orElse: string) =>
    typeof value === "string" && value.trim() ? value.trim() : orElse;

  return {
    googleWebClientId: str(data.google?.webClientId, fallback.googleWebClientId),
    googleIosClientId: str(data.google?.iosClientId, fallback.googleIosClientId),
    appleServerConfigured: data.apple?.serverConfigured !== false,
    source: "server",
  };
}

/** Test seam / diagnostics: drop the cache so the next call refetches. */
export function resetNativeAuthConfigCache(): void {
  cached = undefined;
}
