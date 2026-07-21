"use client";

import { Capacitor } from "@capacitor/core";

export type MobilePlatform = "ios" | "android" | "web";

function nativeUserAgentPlatform(): MobilePlatform {
  if (typeof navigator === "undefined") return "web";
  if (navigator.userAgent.includes("RClipperNative/ios")) return "ios";
  if (navigator.userAgent.includes("RClipperNative/android")) return "android";
  return "web";
}

export function getMobilePlatform(): MobilePlatform {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android"
    ? platform
    : nativeUserAgentPlatform();
}

export function isNativeMobile(): boolean {
  // The remote Next.js page can hydrate before Capacitor's bridge has finished
  // reporting its platform. The native shell's immutable user-agent suffix is
  // available immediately and prevents the first OAuth attempt from falling
  // back to an unsafe in-WKWebView redirect.
  return Capacitor.isNativePlatform() || nativeUserAgentPlatform() !== "web";
}
