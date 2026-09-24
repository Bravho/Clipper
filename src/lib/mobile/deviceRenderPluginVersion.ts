/**
 * The native plugin version that can render a whole manifest end to end.
 *
 * Its own module because both sides need it and they cannot share a file: the
 * bridge that uses it on the client is `"use client"` and imports Capacitor,
 * which a server route cannot pull in, and the submit route has to check the
 * same number before it agrees to let a clip stay on a phone.
 *
 * Bump this when a change makes an older build unable to render a manifest the
 * current server would issue. Do NOT bump it for a change older builds can
 * ignore — every bump makes an installed app fall back to uploading, which is
 * the cost this whole path exists to avoid.
 */
export const MANIFEST_RENDER_PLUGIN_VERSION = 5;

/**
 * The native plugin version that renders a master or final STRAIGHT FROM THE
 * ORIGINALS — the whole edit, mix, template and captions in one encode — and
 * draws the styled render's templates and captions (`remotion/TemplatedVideo`).
 *
 * Not a bump of {@link MANIFEST_RENDER_PLUGIN_VERSION}: a v5 build can still do
 * everything it did, from downloaded intermediates, so it keeps rendering. The
 * server simply sends a from-sources manifest only to builds at or above this.
 */
export const SOURCE_EDIT_PLUGIN_VERSION = 6;

/** Can a build reporting this version render a master or final from sources? */
export function canRenderFromSources(nativePluginVersion: number | null | undefined): boolean {
  return (nativePluginVersion ?? 0) >= SOURCE_EDIT_PLUGIN_VERSION;
}

/** Can a build reporting this version keep moving footage on the device? */
export function canRenderManifestOnDevice(nativePluginVersion: number | null | undefined): boolean {
  return (nativePluginVersion ?? 0) >= MANIFEST_RENDER_PLUGIN_VERSION;
}
