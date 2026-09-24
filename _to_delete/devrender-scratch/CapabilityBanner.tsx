"use client";

import { MANIFEST_RENDER_PLUGIN_VERSION } from "@/lib/mobile/deviceRenderBridge";

/**
 * What this build of the app can actually do, said out loud.
 *
 * The web layer is served from the production host, so an app installed months
 * ago can load today's JavaScript and be missing today's native plugin. Without
 * this banner the symptom is a render button that throws a sentence about a
 * method that does not exist — which reads like a bug in the editor rather than
 * an app that needs updating.
 *
 * It also states the two things about a phone render that are NOT like the Mac's
 * output, because a tester comparing exports needs to know where to look and
 * everyone else deserves not to be surprised.
 */
export function CapabilityBanner({
  nativeReady,
  pluginVersion,
  freeBytes,
  isNative,
}: {
  nativeReady: boolean | null;
  pluginVersion: number | null;
  freeBytes: number | null;
  isNative: boolean;
}) {
  if (nativeReady === null) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
        Checking what this phone can do…
      </p>
    );
  }

  if (!isNative) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">This is the browser, not the app.</p>
        <p className="mt-1">
          You can arrange the timeline here, but rendering needs the installed iOS or Android
          app — a browser has no video encoder this editor can drive.
        </p>
      </div>
    );
  }

  if (!nativeReady) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">This app build cannot render yet.</p>
        <p className="mt-1">
          It has render plugin v{pluginVersion ?? "?"}; the editor needs v
          {MANIFEST_RENDER_PLUGIN_VERSION}. Install the current build — a web deploy cannot
          update the native plugin inside an app that is already installed.
        </p>
      </div>
    );
  }

  const gigabytes = freeBytes != null ? (freeBytes / 1e9).toFixed(1) : null;

  return (
    <details className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
      <summary className="cursor-pointer font-semibold text-slate-800">
        This phone can render {gigabytes ? `· ${gigabytes} GB free` : ""}
      </summary>
      <div className="mt-2 space-y-2 text-slate-600">
        <p>
          Your photos and clips stay on this phone. Only the finished video is uploaded, and
          only after the server has checked it.
        </p>
        <p className="font-semibold text-slate-800">Not identical to a server render:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Decorated templates are drawn in their settled state — the server animates their
            decor, this does not.
          </li>
          <li>
            Captions use this phone&apos;s system font rather than Sarabun and Noto Sans SC, so
            the weight is slightly lighter.
          </li>
          <li>
            On Android, if the dissolving composition will not export, the montage falls back to
            hard cuts. The render tells you when that happened.
          </li>
          <li>
            Voice loudness is matched in one pass rather than the server&apos;s two, so the level
            can differ by about a decibel.
          </li>
        </ul>
      </div>
    </details>
  );
}
