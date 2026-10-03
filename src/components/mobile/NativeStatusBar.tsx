"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

/**
 * Dark status-bar text for the light app bar.
 *
 * The app bar used to be dark slate, and the phone drew its clock and battery
 * in white to match. Now that the bar is white, white icons would vanish, so
 * the style is set to `Style.Light` ("dark text for light backgrounds") as
 * soon as the page loads. `capacitor.config.ts` sets the same style natively,
 * which covers the moment before this runs; this covers installed apps whose
 * native config predates the change. Renders nothing; does nothing on the web.
 */
export function NativeStatusBar() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("StatusBar")) return;
    void StatusBar.setStyle({ style: Style.Light }).catch(() => undefined);
    if (Capacitor.getPlatform() === "android") {
      void StatusBar.setBackgroundColor({ color: "#ffffff" }).catch(() => undefined);
    }
  }, []);
  return null;
}
