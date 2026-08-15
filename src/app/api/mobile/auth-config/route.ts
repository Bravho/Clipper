import { NextResponse } from "next/server";

/**
 * Client IDs the native apps need, read at **request time**.
 *
 * Why this exists rather than `NEXT_PUBLIC_*` alone: those are inlined into the
 * JS bundle by `next build`, so the value is whatever was in `.env.local` on the
 * build machine at build time. Editing the env var and restarting the server
 * changes nothing — the old value stays baked into the chunks. That failure is
 * invisible from the outside and has already cost this project two rounds: an
 * empty `NEXT_PUBLIC_GOOGLE_CLIENT_ID` silently disabled native Google on
 * Android, and a missing `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` hid the Google
 * button on iOS after App Store review had already rejected the browser
 * fallback it used to hide behind.
 *
 * Reading `process.env` here means a restart is enough, and — because this is a
 * plain GET — you can open it in a browser to see exactly what the running
 * server has, instead of inferring it from a button that isn't there.
 *
 * Nothing secret is returned. OAuth **client IDs** are public by design; they
 * already ship inside the JS bundle. Client *secrets* are never touched here.
 */

// Never prerender or cache: the whole point is that this reflects the running
// process's environment, not the environment at build time.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export async function GET() {
  const webClientId = env("NEXT_PUBLIC_GOOGLE_CLIENT_ID") || env("GOOGLE_CLIENT_ID");
  const iosClientId = env("NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID") || env("GOOGLE_IOS_CLIENT_ID");

  return NextResponse.json(
    {
      google: {
        // Android Credential Manager's serverClientId, and the iOS SDK's
        // serverClientID. Always the *web* client ID.
        webClientId,
        // Native Google on iOS is offered only when this is set. It must match
        // the reversed URL scheme in ios/App/App/Info.plist.
        iosClientId,
      },
      apple: {
        // Native Sign in with Apple needs no client ID on the device — the
        // identity token's `aud` is the bundle ID. This only reports whether the
        // *server* is configured to accept it, so a misconfigured server shows
        // up here rather than as a sign-in that fails after the sheet.
        serverConfigured: Boolean(env("APPLE_NATIVE_CLIENT_ID")),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
