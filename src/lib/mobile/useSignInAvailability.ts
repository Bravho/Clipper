"use client";

import { useEffect, useState } from "react";
import { isNativeMobile } from "@/lib/mobile/platform";
import {
  supportsNativeSignIn,
  type NativeProvider,
} from "@/lib/mobile/nativeSocialAuth";

/**
 * Whether a third-party sign-in button should be offered on this surface.
 *
 *  - `pending`      — not resolved yet (server render and the first client
 *                     render). Callers render nothing.
 *  - `web`          — ordinary browser; the NextAuth redirect flow is fine.
 *  - `native-ready` — native app with a working in-app path for this provider.
 *  - `unavailable`  — native app with **no** in-app path. The button must not be
 *                     shown at all.
 */
export type SignInAvailability = "pending" | "web" | "native-ready" | "unavailable";

/**
 * Decide, per provider, whether its button can be offered.
 *
 * Why a hook and not a plain call: `supportsNativeSignIn()` reads the Capacitor
 * bridge and the user agent, neither of which exists during SSR. Resolving it in
 * an effect keeps the server render and the first client render identical, so
 * there is no hydration mismatch.
 *
 * Why the `pending` state renders nothing rather than rendering the button
 * optimistically: on iOS an unusable button is the exact thing App Store review
 * rejected the app for (Guideline 4 — it fell back to opening a browser). A
 * button that is briefly tappable before being hidden reintroduces that risk for
 * one frame. A button that appears one tick late costs nothing.
 */
export function useSignInAvailability(provider: NativeProvider): SignInAvailability {
  const [availability, setAvailability] = useState<SignInAvailability>("pending");

  useEffect(() => {
    if (!isNativeMobile()) {
      setAvailability("web");
      return;
    }
    setAvailability(supportsNativeSignIn(provider) ? "native-ready" : "unavailable");
  }, [provider]);

  return availability;
}

/** Convenience: should this provider's button be rendered at all? */
export function isSignInOffered(availability: SignInAvailability): boolean {
  return availability === "web" || availability === "native-ready";
}
