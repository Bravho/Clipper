"use client";

import { useEffect, useState } from "react";
import { isNativeMobile } from "@/lib/mobile/platform";
import { MANIFEST_RENDER_PLUGIN_VERSION } from "@/lib/mobile/deviceRenderPluginVersion";
import { useStudioT } from "./studioI18n";

/**
 * The editor's framing: which server it is talking to, and what this app build
 * can do.
 *
 * Both exist because of the same class of confusion. The app is a native shell
 * around a remote site, so "where is this data coming from" and "is this code
 * as new as the server's" are invisible from the inside — and both have bitten:
 * a build pointed at a laptop that shows a blank page off the office Wi-Fi, and
 * an installed app running today's JavaScript against last month's native
 * plugin.
 */

/** Where the app is actually loading from, in words a tester can act on. */
export function ServerBadge() {
  const t = useStudioT();
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    // window.location is the honest answer: it is the origin the WebView really
    // loaded, whatever the build was meant to target.
    setOrigin(window.location.origin);
  }, []);

  if (!origin) return null;

  let host = origin;
  try {
    host = new URL(origin).host;
  } catch {
    // An origin that will not parse is worth showing verbatim rather than
    // hiding — it is the sort of thing that explains a broken build.
  }

  // A private/LAN address means this app is tied to one machine on one network.
  const isLocal =
    /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    origin.startsWith("http://");

  // The live server needs no badge now that the studio is the product; only a
  // LAN/debug build is worth pointing out.
  if (!isLocal) return null;

  return (
    <span
      className="studio-eyebrow"
      title={isLocal ? t("studio.chrome.lanTitle") : t("studio.chrome.liveTitle")}
    >
      <span
        className="studio-live-dot"
        style={isLocal ? { background: "var(--s-warning)" } : undefined}
        aria-hidden
      />
      {isLocal ? t("studio.chrome.lanBuild", { host }) : host}
    </span>
  );
}

export interface StudioCapability {
  isNative: boolean;
  pluginVersion: number | null;
  canRender: boolean;
  freeBytes: number | null;
}

/**
 * What this build can do, said once, at the top, before anyone taps Render.
 *
 * A web deploy cannot update the native plugin inside an installed app, so the
 * JavaScript running here can be newer than the code that has to do the work.
 * Without this the symptom is a render button that throws a sentence about a
 * missing method — which reads like a bug in the editor rather than an app that
 * needs updating.
 */
export function CapabilityNotice({ capability }: { capability: StudioCapability | null }) {
  const t = useStudioT();
  if (!capability) {
    return <p className="studio-note">{t("studio.chrome.checking")}</p>;
  }

  if (!capability.isNative) {
    return (
      <div className="studio-note studio-note-warning">
        <strong>{t("studio.chrome.browserTitle")}</strong>
        <br />
        {t("studio.chrome.browserBody")}
      </div>
    );
  }

  if (!capability.canRender) {
    return (
      <div className="studio-note studio-note-warning">
        <strong>{t("studio.chrome.oldTitle")}</strong>
        <br />
        {t("studio.chrome.oldBody", {
          have: capability.pluginVersion ?? "?",
          need: MANIFEST_RENDER_PLUGIN_VERSION,
        })}
      </div>
    );
  }

  const gigabytes =
    capability.freeBytes != null ? (capability.freeBytes / 1e9).toFixed(1) : null;

  return (
    <details className="studio-note">
      <summary style={{ cursor: "pointer", fontWeight: 650, color: "var(--s-text)" }}>
        {t("studio.chrome.editingHere")}
        {gigabytes ? t("studio.chrome.free", { gb: gigabytes }) : ""}
      </summary>
      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        <p style={{ margin: 0 }}>{t("studio.chrome.privacy")}</p>
      </div>
    </details>
  );
}

/** How long to wait for the native bridge before trusting a "no plugin" answer. */
const BRIDGE_WAIT_MS = 4_000;
const BRIDGE_POLL_MS = 250;

/**
 * Read the native capability once, for the whole screen.
 *
 * The app loads this page from the server, and the page can hydrate BEFORE
 * Capacitor's bridge has finished reporting the platform and its plugins. Asked
 * too early, `Capacitor.isNativePlatform()` says "web" and the render plugin
 * looks missing — which showed "get the app" inside the installed app (26 Sep).
 * So "is this the app?" also accepts the shell's immutable user-agent marker
 * (`isNativeMobile`), and inside the app the plugin is asked again for a few
 * seconds before a missing plugin is believed.
 */
export function useStudioCapability(): StudioCapability | null {
  const [capability, setCapability] = useState<StudioCapability | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const isNative = isNativeMobile();
      if (!isNative) {
        if (!cancelled) {
          setCapability({ isNative: false, pluginVersion: null, canRender: false, freeBytes: null });
        }
        return;
      }
      const [{ getNativeRenderCapabilities }, { supportsManifestRender }] = await Promise.all([
        import("@/lib/mobile/deviceVideoRender"),
        import("@/lib/mobile/deviceRenderBridge"),
      ]);
      let native = await getNativeRenderCapabilities();
      const deadline = Date.now() + BRIDGE_WAIT_MS;
      while (!native && !cancelled && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, BRIDGE_POLL_MS));
        native = await getNativeRenderCapabilities();
      }
      const canRender = native ? await supportsManifestRender() : false;
      if (cancelled) return;
      setCapability({
        isNative: true,
        pluginVersion: native?.nativePluginVersion ?? null,
        canRender,
        freeBytes: native?.freeBytes ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return capability;
}
