/**
 * The switch-over from the server pipeline to the phone studio.
 *
 * Two flags, flipped in this order once the new app builds are live in BOTH
 * stores (see docs in the RClipper project, "studio_pipeline_rollout"):
 *
 *   STUDIO_ONLY=true
 *     Every new video is made in the studio and rendered on the phone. The
 *     submit route refuses anything else (409 `app_update_required`), the web
 *     request form redirects to the studio, and no new work reaches the Mac
 *     Mini or the droplet's inline renderer. Requests already on the server
 *     pipeline finish there. Before the flag, an app build that announces the
 *     render plugin (RClipperRender/6) already gets the studio; older builds
 *     keep the web form.
 *
 *   BROWSER_MARKETING_ONLY=true
 *     A web browser (no `RClipperNative/` in the user agent) sees the marketing
 *     site. Requester pages redirect to "get the app", except account, credits
 *     and pricing (Stripe top-ups stay available in a browser). Admin pages,
 *     sign-in, email links and every callback/webhook are untouched.
 *
 * Read at request time (not build time) so the droplet can flip them with an
 * env change and a restart.
 */
export function isStudioOnly(): boolean {
  return process.env.STUDIO_ONLY === "true";
}

export function isBrowserMarketingOnly(): boolean {
  return process.env.BROWSER_MARKETING_ONLY === "true";
}

/**
 * Store links, from the environment only (.env.local on the droplet):
 *
 *   NEXT_PUBLIC_APP_STORE_URL   the RClipper App Store listing
 *   NEXT_PUBLIC_PLAY_STORE_URL  the RClipper Google Play listing
 *
 * NEXT_PUBLIC_* values are inlined by `next build`, so rebuild after changing
 * them. A missing value is null: StoreButtons / StudioAppGate then show
 * "coming soon" for that store instead of a dead link.
 */
export const APP_STORE_URL: string | null =
  process.env.NEXT_PUBLIC_APP_STORE_URL?.trim() || null;

export const PLAY_STORE_URL: string | null =
  process.env.NEXT_PUBLIC_PLAY_STORE_URL?.trim() || null;
