import { SOURCE_EDIT_PLUGIN_VERSION } from "./deviceRenderPluginVersion";

/**
 * Who is asking: the RClipper app, or a web browser — read from the user agent.
 *
 * Server-safe (no Capacitor import), so middleware, pages and routes can all
 * use it. The native shells append two immutable markers (capacitor.config.ts):
 *
 *   RClipperNative/<ios|android>   every app build ever shipped
 *   RClipperRender/<n>             builds from the studio release on — the
 *                                  phone-render plugin version the build carries
 *
 * An app WITHOUT the second marker is an older store build: it signs in, lists
 * requests, downloads and publishes, but it cannot make a video on the phone.
 * The page script can still ask the plugin directly (deviceRenderBridge); this
 * is the answer available before any script runs.
 */
export interface AppClient {
  /** "ios" / "android" inside the app shell; null in a web browser. */
  platform: "ios" | "android" | null;
  /** The phone-render plugin version the app announced; 0 when it announced none. */
  renderPluginVersion: number;
}

export function parseAppUserAgent(userAgent: string | null | undefined): AppClient {
  const ua = userAgent ?? "";
  const platformMatch = /RClipperNative\/(ios|android)/.exec(ua);
  const renderMatch = /RClipperRender\/(\d+)/.exec(ua);
  return {
    platform: platformMatch ? (platformMatch[1] as "ios" | "android") : null,
    renderPluginVersion: renderMatch ? Number(renderMatch[1]) : 0,
  };
}

/** Is this request coming from inside the RClipper app (any build)? */
export function isAppUserAgent(userAgent: string | null | undefined): boolean {
  return parseAppUserAgent(userAgent).platform !== null;
}

/**
 * Can this app build make videos in the studio, judged from the user agent?
 *
 * `false` for a browser and for an app build that announced no (or an older)
 * render plugin. Only a hint for routing and copy — the studio re-checks the
 * plugin itself, and the server re-checks at claim time.
 */
export function appCanUseStudio(userAgent: string | null | undefined): boolean {
  const client = parseAppUserAgent(userAgent);
  return client.platform !== null && client.renderPluginVersion >= SOURCE_EDIT_PLUGIN_VERSION;
}
