"use client";

import { useEffect } from "react";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { isNativeMobile } from "@/lib/mobile/platform";

export function NativeDeepLinkHandler() {
  useEffect(() => {
    if (!isNativeMobile()) return;
    let active = true;
    let remove: (() => Promise<void>) | undefined;

    void App.addListener("appUrlOpen", (event) => {
      if (!active) return;
      try {
        const url = new URL(event.url);
        if (url.hostname !== "app.rclipper.com" && !url.hostname.endsWith(".rclipper.com")) {
          return;
        }
        void Browser.close().catch(() => undefined);
        window.location.assign(`${url.pathname}${url.search}${url.hash}`);
      } catch {
        // Ignore malformed or non-web deep links.
      }
    }).then((listener) => {
      remove = () => listener.remove();
    });

    return () => {
      active = false;
      if (remove) void remove();
    };
  }, []);

  return null;
}

