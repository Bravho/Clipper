"use client";

import { Capacitor } from "@capacitor/core";

export type MobilePlatform = "ios" | "android" | "web";

export function getMobilePlatform(): MobilePlatform {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? platform : "web";
}

export function isNativeMobile(): boolean {
  return Capacitor.isNativePlatform();
}

