import { NextResponse } from "next/server";
import { decodeJwt } from "jose";
import {
  APPLE_ANDROID_DEEP_LINK,
  appleAndroidClientId,
  appleAndroidRedirectUrl,
  isAppleAndroidConfigured,
} from "@/lib/auth/appleAndroid";
import { rememberAppleName } from "@/lib/auth/appleNameMemo";

/**
 * Apple's callback for the **Android** Sign in with Apple flow.
 *
 * The device opens Apple's authorize page in a Chrome Custom Tab with
 * `response_mode=form_post` and this route as `redirect_uri`, so Apple POSTs the
 * authorization code here — to the server, not to the app. This route exchanges
 * that code for tokens and hands the identity token back to the app through the
 * `com.rclipper.app://apple-login` deep link, which is what
 * `@capgo/capacitor-social-login`'s `AppleProvider.handleUrl()` expects.
 *
 * The app then exchanges that identity token for a session via the
 * `apple-native` provider — a request the WebView makes itself, so the session
 * cookie lands in the WebView's jar and the app is genuinely signed in. The
 * Custom Tab only ever carries the OAuth handshake; it never holds the session.
 *
 * **The client secret never leaves this server.** The plugin also accepts a
 * redirect carrying `code` + `client_secret` and will do the exchange on the
 * device — that mode is not used here, because it would ship the Apple client
 * secret (a signed ES256 JWT valid for months, for the whole team) to every
 * install.
 *
 * ## Known limitations
 *
 * **Scheme hijacking.** The identity token travels in a custom-scheme URL, and
 * Android lets any app register any scheme, so a malicious app installed on the
 * same device could receive it and use it to sign in as that user within the
 * token's ~5 minute window. The proper fix is an https App Link, which is
 * verified against `assetlinks.json` and cannot be claimed by another app — but
 * that file still carries the local upload key's fingerprint rather than Play
 * App Signing's, so verification currently fails on Play builds. Fix that first,
 * then switch `APPLE_ANDROID_DEEP_LINK` to an https URL. The refresh token is
 * deliberately *not* forwarded, so the blast radius stays inside that window.
 *
 * **No state check.** The plugin generates its own `state`, keeps it on the
 * device and never verifies it on return, so there is nothing this route can
 * compare against. That leaves login-CSRF (a victim signed in as the attacker)
 * theoretically open; it cannot leak the victim's account or data.
 */

// Apple POSTs here from its own origin: never prerender, never cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;
// jose and the token exchange need the Node runtime, not the edge runtime.
export const runtime = "nodejs";

const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";

interface AppleTokenResponse {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

function str(value: FormDataEntryValue | string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The name Apple sends on first authorization, as a JSON blob in the `user`
 * field: `{"name":{"firstName":"…","lastName":"…"},"email":"…"}`.
 *
 * Malformed JSON is not an error worth failing sign-in over — the name is
 * cosmetic — so anything unparseable yields no name.
 */
function parseUserName(userField: string): string | undefined {
  if (!userField) return undefined;

  try {
    const parsed = JSON.parse(userField) as {
      name?: { firstName?: unknown; lastName?: unknown };
    };
    const parts = [parsed.name?.firstName, parsed.name?.lastName]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .map((part) => part.trim());

    return parts.length > 0 ? parts.join(" ") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hand a result back to the app.
 *
 * An HTML page rather than a 302 to the custom scheme: Chrome is increasingly
 * reluctant to follow a server redirect straight into an external-scheme intent,
 * and a silent block would look exactly like a hung sign-in. The page navigates
 * itself and leaves a button behind for the case where the automatic hop is
 * refused, so the user is never stranded on a blank tab.
 *
 * `AppleProvider.handleUrl()` reads `success`, `id_token` and `access_token`
 * from the query string; anything else on the URL is ignored by the plugin.
 */
function respondToApp(params: Record<string, string>): NextResponse {
  const deepLink = new URL(APPLE_ANDROID_DEEP_LINK);
  for (const [key, value] of Object.entries(params)) {
    if (value) deepLink.searchParams.set(key, value);
  }

  // `URL.searchParams` percent-encodes the values, so the only escaping left is
  // for the two contexts the URL is dropped into: an HTML attribute and a JS
  // string literal. Belt and braces — an identity token is base64url and a
  // reason code comes from Apple — but neither is worth hand-waving.
  const target = deepLink.toString();
  const escaped = target.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const forScript = JSON.stringify(target);
  const ok = params.success === "true";

  const body = `<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RClipper</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a;
             color: #e2e8f0; display: flex; min-height: 100vh; margin: 0;
             align-items: center; justify-content: center; text-align: center; }
      a { display: inline-block; margin-top: 1.5rem; padding: 0.75rem 1.5rem;
          border-radius: 0.5rem; background: #38bdf8; color: #0f172a;
          font-weight: 600; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <p>${ok ? "กำลังกลับสู่แอป RClipper…" : "เข้าสู่ระบบด้วย Apple ไม่สำเร็จ"}</p>
      <a href="${escaped}">เปิดแอป RClipper</a>
    </main>
    <script>window.location.replace(${forScript});</script>
  </body>
</html>`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The URL carries an identity token: keep it out of every cache.
      "Cache-Control": "no-store, no-cache, must-revalidate",
      // The identity token is in this page's own URL bar target; do not let it
      // leak to anything the page might touch.
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function exchangeCode(code: string): Promise<AppleTokenResponse> {
  const response = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      // Must match the authorize request byte for byte, hence the shared helper.
      redirect_uri: appleAndroidRedirectUrl(),
      client_id: appleAndroidClientId(),
      client_secret: process.env.APPLE_CLIENT_SECRET?.trim() ?? "",
    }),
    cache: "no-store",
  });

  return (await response.json()) as AppleTokenResponse;
}

async function handle(
  params: (key: string) => string
): Promise<NextResponse> {
  if (!isAppleAndroidConfigured()) {
    console.error("[auth] apple android callback hit but server is not configured");
    return respondToApp({ success: "false", reason: "server_not_configured" });
  }

  const error = params("error");
  const code = params("code");

  if (error || !code) {
    // Includes the ordinary case of the user cancelling on Apple's page.
    console.info("[auth] apple android callback without a code", { error });
    return respondToApp({ success: "false", reason: error || "missing_code" });
  }

  let tokens: AppleTokenResponse;
  try {
    tokens = await exchangeCode(code);
  } catch (cause) {
    console.error("[auth] apple token exchange failed", cause);
    return respondToApp({ success: "false", reason: "exchange_failed" });
  }

  if (!tokens.id_token) {
    // `invalid_client` here almost always means the redirect_uri, the Services
    // ID, or the client secret's expiry — logged in full because the device sees
    // only a generic failure.
    console.error("[auth] apple token exchange returned no id_token", {
      error: tokens.error,
      description: tokens.error_description,
    });
    return respondToApp({ success: "false", reason: tokens.error || "no_id_token" });
  }

  // Apple sends the display name only on the very first authorization, and only
  // here. Park it for the session exchange that follows within seconds.
  const name = parseUserName(params("user"));
  if (name) {
    try {
      const sub = decodeJwt(tokens.id_token).sub;
      if (typeof sub === "string") rememberAppleName(sub, name);
    } catch (cause) {
      // Cosmetic only — the token itself is verified properly on the exchange.
      console.warn("[auth] could not read sub from apple id_token", cause);
    }
  }

  return respondToApp({
    success: "true",
    id_token: tokens.id_token,
    // The plugin only takes its "tokens already exchanged" branch when an
    // access token is present; without it, it would try to exchange the code
    // itself and expect a client secret in the URL.
    access_token: tokens.access_token ?? "",
    // refresh_token is deliberately omitted — see "Known limitations" above.
  });
}

/** Apple's `response_mode=form_post` callback. */
export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  return handle((key) => str(form.get(key)));
}

/**
 * Not used by Apple, which always posts here, but harmless and useful: opening
 * the URL in a browser returns the "not configured"/"missing code" page rather
 * than a 405, which makes a misconfigured Return URL easy to spot by hand.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  return handle((key) => str(searchParams.get(key)));
}
