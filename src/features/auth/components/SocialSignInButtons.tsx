"use client";

import {
  isSignInOffered,
  useSignInAvailability,
} from "@/lib/mobile/useSignInAvailability";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { AppleSignInButton } from "./AppleSignInButton";

interface SocialSignInButtonsProps {
  /** Where to land after a successful sign-in. */
  callbackUrl?: string;
  /** Copy on the separator, e.g. "หรือ" or "หรือสมัครด้วยอีเมล". */
  dividerLabel: string;
  /**
   * Which side of the buttons the separator sits on. Login puts it above the
   * providers ("or"); signup leads with the providers and puts it below
   * ("or sign up with email").
   */
  dividerPlacement: "before" | "after";
  googleLabel: string;
  appleLabel: string;
}

/**
 * The third-party sign-in block: whichever provider buttons can actually work on
 * this surface, plus its separator.
 *
 * This owns the separator on purpose. Each button hides itself when its provider
 * has no in-app path (iOS without a Google iOS client ID, an app build predating
 * the SocialLogin plugin, and so on), so a separator rendered by the parent form
 * would be left stranded above an empty gap. Deciding here means the whole block
 * disappears together, and the form falls back cleanly to email and password —
 * which is entirely in-app and always available.
 */
export function SocialSignInButtons({
  callbackUrl,
  dividerLabel,
  dividerPlacement,
  googleLabel,
  appleLabel,
}: SocialSignInButtonsProps) {
  const google = useSignInAvailability("google");
  const apple = useSignInAvailability("apple");

  if (!isSignInOffered(google) && !isSignInOffered(apple)) return null;

  const divider = (
    <div className="relative flex items-center gap-3">
      <div className="flex-1 border-t border-slate-200" />
      <span className="text-xs text-slate-400">{dividerLabel}</span>
      <div className="flex-1 border-t border-slate-200" />
    </div>
  );

  return (
    <>
      {dividerPlacement === "before" && divider}
      <GoogleSignInButton label={googleLabel} callbackUrl={callbackUrl} />
      <AppleSignInButton label={appleLabel} callbackUrl={callbackUrl} />
      {dividerPlacement === "after" && divider}
    </>
  );
}
