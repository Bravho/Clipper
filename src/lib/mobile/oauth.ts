"use client";

import { signIn } from "next-auth/react";
import { Browser } from "@capacitor/browser";
import { isNativeMobile } from "@/lib/mobile/platform";

export async function startOAuth(
  provider: "google" | "apple",
  callbackUrl: string
): Promise<void> {
  if (!isNativeMobile()) {
    await signIn(provider, { callbackUrl });
    return;
  }

  const result = await signIn(provider, {
    callbackUrl,
    redirect: false,
  });
  if (!result?.url) throw new Error("OAuth provider returned no authorization URL.");
  await Browser.open({
    url: result.url,
    presentationStyle: "popover",
    toolbarColor: "#0f172a",
  });
}

