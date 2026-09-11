import type { HeadlessBrowser } from "@remotion/renderer";
import { RENDER_TUNING } from "@/config/renderTuning";

/**
 * One headless Chromium, shared across a batch of Remotion renders.
 *
 * WHY THIS EXISTS. `selectComposition` and `renderMedia` each launch their own
 * browser when no `puppeteerInstance` is passed, and the montage path calls
 * both once PER SCENE — then repeats the whole thing for every aspect ratio
 * (`_renderMontageBaseAtRatio`). A six-scene video across four ratios paid for
 * roughly 48 Chromium cold starts, none of them doing any rendering work. The
 * 5-minute render timeout in `remotionService` is generous specifically because
 * of those cold starts.
 *
 * Scoped to a step rather than to the process: a browser held for days would
 * accumulate memory on a 16 GB machine, and a crashed one would poison every
 * later render with no way back.
 */

/**
 * Runs `fn` with a shared browser, closing it afterwards no matter how `fn`
 * ends.
 *
 * `fn` receives `undefined` when a shared browser could not be opened, or when
 * REMOTION_SHARED_BROWSER=false. Callers pass that straight through to
 * Remotion, which then opens its own browser per render exactly as before — so
 * this is an optimisation that can always degrade to the old behaviour rather
 * than a dependency.
 */
/**
 * Whether a Chromium is known to be present, so `openBrowser` will start one
 * rather than going off to download it.
 *
 * This gate exists because `openBrowser` on a machine with no browser tries to
 * fetch one from remotion.media, and when that fetch fails Remotion emits a
 * TRANSIENT UNHANDLED REJECTION before the error reaches our `catch` — which
 * Node terminates the process for by default. `onBrowserDownload` does not
 * prevent it (verified: the download runs regardless). So rather than risk the
 * worker dying over an optimisation, nothing is opened until a startup check
 * has confirmed a browser is already there.
 *
 * Left false in the web server and in tests, so both keep the old
 * browser-per-render behaviour exactly.
 */
let sharedBrowserReady = false;

/**
 * Confirm a Chromium is available, downloading one if not, and enable the
 * shared-browser optimisation for the rest of the process.
 *
 * Called once from the render worker's startup, where a one-off download is
 * acceptable and the network is there. Never throws: failing only means the
 * optimisation stays off and every render opens its own browser, as before.
 */
export async function prepareSharedBrowser(): Promise<boolean> {
  if (!RENDER_TUNING.sharedBrowserEnabled) return false;
  try {
    const { ensureBrowser } = await import("@remotion/renderer");
    await ensureBrowser({ chromeMode: "headless-shell" });
    sharedBrowserReady = true;
  } catch (err) {
    console.error("[remotion] no shared browser available, using one per render:", err);
    sharedBrowserReady = false;
  }
  return sharedBrowserReady;
}

export async function withSharedBrowser<T>(
  label: string,
  fn: (browser: HeadlessBrowser | undefined) => Promise<T>
): Promise<T> {
  if (!RENDER_TUNING.sharedBrowserEnabled || !sharedBrowserReady) return fn(undefined);

  let browser: HeadlessBrowser | undefined;
  try {
    const { openBrowser } = await import("@remotion/renderer");
    browser = await openBrowser("chrome", { chromeMode: "headless-shell" });
  } catch (err) {
    // Opening failed — carry on without a shared browser rather than failing a
    // render that would have worked.
    console.error(`[remotion] shared browser unavailable for ${label}, using per-render browsers:`, err);
    browser = undefined;
  }

  try {
    return await fn(browser);
  } finally {
    if (browser) {
      // Closing must never mask the render's own error, and a browser that
      // already died closes with a throw.
      await browser.close({ silent: true }).catch(() => {});
    }
  }
}
