"use client";

import { App } from "@capacitor/app";

/**
 * The Android Sign in with Apple return leg, decoupled from the plugin.
 *
 * ## Why this exists
 *
 * Android has no Sign in with Apple SDK, so the flow leaves the app: a Chrome
 * Custom Tab goes to Apple, Apple `form_post`s the authorization code to
 * `/api/auth/apple/android-callback`, that route exchanges it server-side and
 * bounces the identity token back through `com.rclipper.app://apple-login?…`.
 *
 * Everything waiting for that bounce — `@capgo/capacitor-social-login`'s pending
 * `lastcall`, the JS promise behind it, the React state behind the button —
 * lives only in this process's memory, and the process is in the **background**
 * for the whole Apple leg. If Android reclaims it (routine for a remote-URL
 * WebView shell while Chrome is in front), the deep link *cold-starts* the app
 * rather than resuming it. The plugin then has no Apple provider registered and
 * no call to settle, so it logs into `catch (Throwable)` and drops the identity
 * token. The user sees the app apparently restart itself, still signed out, with
 * no error anywhere — the exact bug this module fixes.
 *
 * ## The fix
 *
 * Capacitor's Bridge captures the launch intent's URI when it is constructed
 * (`Bridge.java`: `this.intentUri = intent.getData()`), so `App.getLaunchUrl()`
 * still returns the apple-login URL after a cold start. The identity token is
 * therefore recoverable from the web layer alone, with no dependence on the
 * plugin's in-memory state:
 *
 *  - **warm** — `appUrlOpen` fires; {@link watchAppleReturn} hands the token
 *    straight to the sign-in that is still waiting for it.
 *  - **cold** — the button's promise died with the process;
 *    {@link takeLaunchAppleReturn} finds the token at boot and
 *    `AppleReturnRecovery` completes the sign-in.
 *
 * The two paths are independent on purpose: whichever one is still alive wins,
 * and the consumed-token guard below stops them both acting on the same token.
 */

/**
 * Mirror of `APPLE_ANDROID_DEEP_LINK` in src/lib/auth/appleAndroid.ts, and of
 * the `<intent-filter>` in android/app/src/main/AndroidManifest.xml.
 *
 * Duplicated rather than imported so this client module does not pull the
 * server-side Apple config (and its `process.env` reads) into the browser
 * bundle. Change it in all three places or the return leg goes nowhere.
 */
const APPLE_RETURN_SCHEME = "com.rclipper.app:";
const APPLE_RETURN_HOST = "apple-login";

/** Marks identity tokens already acted on, so a reload cannot replay one. */
const CONSUMED_STORAGE_KEY = "rclipper.appleReturn.consumed";

export type AppleReturn =
  | { ok: true; idToken: string }
  /** The callback route reported a failure; `reason` is its `reason` param. */
  | { ok: false; reason: string };

/**
 * Recognise and decode an apple-login deep link.
 *
 * Parsed by hand rather than with `URL.searchParams`: the URL has a custom
 * scheme and an opaque path, and support for reading a query off one of those
 * has been inconsistent across the WebView versions this ships to. The query
 * string is unambiguous, so splitting it is both simpler and safer.
 *
 * Returns `null` for anything that is not our return link — App Links for
 * app.rclipper.com come through the same `appUrlOpen` channel and must fall
 * through to `NativeDeepLinkHandler` untouched.
 */
export function parseAppleReturn(url: string | null | undefined): AppleReturn | null {
  if (!url) return null;

  const lower = url.toLowerCase();
  if (!lower.startsWith(`${APPLE_RETURN_SCHEME}//${APPLE_RETURN_HOST}`)) return null;

  const queryStart = url.indexOf("?");
  const params = new URLSearchParams(queryStart >= 0 ? url.slice(queryStart + 1) : "");

  const idToken = params.get("id_token")?.trim();
  if (params.get("success") === "true" && idToken) {
    return { ok: true, idToken };
  }

  return { ok: false, reason: params.get("reason")?.trim() || "unknown" };
}

/**
 * A short, non-reversible fingerprint of an identity token.
 *
 * Only ever compared against itself, so a cheap string hash is enough — and it
 * keeps the token itself out of `sessionStorage`, which the whole web app can
 * read.
 */
function fingerprint(idToken: string): string {
  let hash = 0;
  for (let i = 0; i < idToken.length; i += 1) {
    hash = (hash * 31 + idToken.charCodeAt(i)) | 0;
  }
  return `${hash}:${idToken.length}`;
}

function readConsumed(): string[] {
  try {
    const raw = window.sessionStorage.getItem(CONSUMED_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Whether this identity token has already been acted on.
 *
 * `App.getLaunchUrl()` keeps returning the launch URL for the life of the
 * process, so without this a WebView reload — which resets every module-level
 * flag but not `sessionStorage` — would try to sign in again with a token that
 * has already been spent.
 */
export function isAppleReturnConsumed(idToken: string): boolean {
  return readConsumed().includes(fingerprint(idToken));
}

/** Record an identity token as spent. Best-effort; storage may be unavailable. */
export function markAppleReturnConsumed(idToken: string): void {
  try {
    // Two entries is plenty: one live attempt plus the one before it. Keeping
    // the list short stops a long-lived WebView accumulating dead fingerprints.
    const next = [...readConsumed(), fingerprint(idToken)].slice(-2);
    window.sessionStorage.setItem(CONSUMED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private-mode or a disabled store: replay protection degrades to the
    // module-level guard, and a replayed token fails server-side on `exp`.
  }
}

let launchUrlTaken = false;

/**
 * The apple-login result the app was **launched** with, if any — once.
 *
 * Call this at boot on Android. A non-null `ok: true` here means the sign-in
 * that started this flow no longer exists (the process was restarted mid-flow),
 * so the caller owns completing it.
 */
export async function takeLaunchAppleReturn(): Promise<AppleReturn | null> {
  if (launchUrlTaken) return null;
  launchUrlTaken = true;

  let launchUrl: string | undefined;
  try {
    launchUrl = (await App.getLaunchUrl())?.url;
  } catch {
    // Not a Capacitor host, or the plugin is unavailable in this binary.
    return null;
  }

  const parsed = parseAppleReturn(launchUrl);
  if (parsed?.ok && isAppleReturnConsumed(parsed.idToken)) return null;
  return parsed;
}

/**
 * Watch for an apple-login deep link arriving while the app is running.
 *
 * The returned promise never rejects and never resolves on its own — race it
 * against whatever else might settle the sign-in, and always call `dispose()`.
 */
export function watchAppleReturn(): {
  arrived: Promise<AppleReturn>;
  dispose: () => void;
} {
  let settle: ((value: AppleReturn) => void) | undefined;
  const arrived = new Promise<AppleReturn>((resolve) => {
    settle = resolve;
  });

  let removeListener: (() => void) | undefined;
  let disposed = false;

  void App.addListener("appUrlOpen", (event) => {
    const parsed = parseAppleReturn(event.url);
    if (parsed) settle?.(parsed);
  })
    .then((listener) => {
      if (disposed) {
        void listener.remove();
        return;
      }
      removeListener = () => void listener.remove();
    })
    .catch(() => undefined);

  return {
    arrived,
    dispose: () => {
      disposed = true;
      removeListener?.();
    },
  };
}
