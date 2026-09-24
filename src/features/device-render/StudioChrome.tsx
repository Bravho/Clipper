"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { MANIFEST_RENDER_PLUGIN_VERSION } from "@/lib/mobile/deviceRenderPluginVersion";

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

  return (
    <span
      className="studio-eyebrow"
      title={isLocal ? "This build only works next to that machine" : "Connected to the live server"}
    >
      <span
        className="studio-live-dot"
        style={isLocal ? { background: "var(--s-warning)" } : undefined}
        aria-hidden
      />
      {isLocal ? `LAN build · ${host}` : host}
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
  if (!capability) {
    return <p className="studio-note">Checking what this phone can do…</p>;
  }

  if (!capability.isNative) {
    return (
      <div className="studio-note studio-note-warning">
        <strong>You are in a browser, not the app.</strong>
        <br />
        You can lay out the timeline here, but rendering needs the installed app — a
        browser has no video encoder this editor can drive.
      </div>
    );
  }

  if (!capability.canRender) {
    return (
      <div className="studio-note studio-note-warning">
        <strong>This app version cannot render yet.</strong>
        <br />
        It has render plugin v{capability.pluginVersion ?? "?"}; the editor needs v
        {MANIFEST_RENDER_PLUGIN_VERSION}. Install the current build — updating the website
        cannot update the native part of an app that is already on your phone. Until then
        your videos are uploaded and rendered on the server, exactly as before.
      </div>
    );
  }

  const gigabytes =
    capability.freeBytes != null ? (capability.freeBytes / 1e9).toFixed(1) : null;

  return (
    <details className="studio-note">
      <summary style={{ cursor: "pointer", fontWeight: 650, color: "var(--s-text)" }}>
        Editing on this phone{gigabytes ? ` · ${gigabytes} GB free` : ""}
      </summary>
      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        <p style={{ margin: 0 }}>
          Your photos and clips stay on this phone. Only the finished video is uploaded,
          and only after the server has checked it. Scripts, the speaking voice and
          publishing still come from the server — they are small, text-sized requests.
        </p>
        <p style={{ margin: 0, color: "var(--s-text)", fontWeight: 650 }}>
          Not identical to a server render:
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
          <li>Template decoration is drawn still; the server animates it.</li>
          <li>Captions use this phone&apos;s system font, so the weight is a touch lighter.</li>
          <li>
            On Android, if the dissolving composition will not export, scenes are joined
            with hard cuts — the result tells you when that happened.
          </li>
          <li>Voice loudness is matched in one pass rather than two, so it can differ by about a decibel.</li>
        </ul>
      </div>
    </details>
  );
}

/** Read the native capability once, for the whole screen. */
export function useStudioCapability(): StudioCapability | null {
  const [capability, setCapability] = useState<StudioCapability | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const isNative = Capacitor.isNativePlatform();
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
      const native = await getNativeRenderCapabilities();
      const canRender = await supportsManifestRender();
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
