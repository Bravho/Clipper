/**
 * Upload diagnostics — a timestamped record of what the browser did to the
 * files the user picked, and exactly when each one stopped being readable.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Uploads fail with Chromium's `NotReadableError`:
 *
 *     The requested file could not be read, typically due to permission
 *     problems that have occurred after a reference to a file was acquired.
 *
 * That is thrown inside `arrayBuffer()`, before any network call, so the
 * server logs cannot see it — and the part PUTs go browser → Spaces directly,
 * so they never reach our server either. The evidence has to be collected on
 * the device.
 *
 * ── What it answers ────────────────────────────────────────────────────────
 *
 * The open question is not *what* the error is but *when and why the handles
 * die*. So the centrepiece is `startHandleMonitor`: every few seconds it reads
 * one kilobyte from every still-live file and records the first moment each one
 * fails. That timeline, cross-referenced with the page-lifecycle events from
 * `watchPageLifecycle`, distinguishes the candidate causes:
 *
 *   • all handles die at once, right after `VISIBILITY hidden` / `FREEZE`
 *       → the WebView was backgrounded and Android reclaimed the provider.
 *   • all handles die at once with the page still visible, during the video
 *     probes
 *       → memory/decoder pressure (the C2_NO_MEMORY hypothesis).
 *   • handles die one at a time as each file's own upload reaches it
 *       → per-file, not a group event; the whole model is wrong.
 *   • the error is `NotFoundError`, not `NotReadableError`
 *       → the file was moved or deleted, not a permission lapse.
 *   • nothing dies until the upload touches it
 *       → the read itself is the trigger, not elapsed time.
 *
 * Each of those points at a different fix, which is why this ships before one.
 *
 * ── Getting the log back ───────────────────────────────────────────────────
 *
 * Everything is mirrored to `console.info` under `[upload:diag]` (visible via
 * `adb logcat -s Capacitor/Console:V`) AND kept in memory, so the form can offer
 * a copy button. A phone in the field is not usually attached to a laptop.
 */

/** Ring-buffer cap. Long enough for a 10-file batch over a slow uplink. */
const MAX_LINES = 600;

/** Bytes read per liveness check. One block is as conclusive as a whole file:
 *  a lapsed grant fails on the first read, not partway through. */
const PROBE_BYTES = 1024;

let lines: string[] = [];
let startedAt = 0;

function stamp(): string {
  return `t=${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

/** Begin a new timeline. Called when files are first selected. */
export function diagReset(): void {
  lines = [];
  startedAt = Date.now();
}

export function diagLog(event: string, detail = ""): void {
  if (startedAt === 0) diagReset();
  const line = `${stamp()} ${event}${detail ? ` ${detail}` : ""}`;
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  // Mirrored to the console so adb logcat sees it even if the app is killed
  // before the user can copy anything out.
  console.info(`[upload:diag] ${line}`);
}

export function diagDump(): string {
  return lines.join("\n");
}

export function diagLineCount(): number {
  return lines.length;
}

/**
 * A readable one-line description of a thrown value.
 *
 * The `name` matters as much as the message here: `NotReadableError` (the grant
 * lapsed, or the file was re-stated) and `NotFoundError` (the file was moved or
 * deleted) look identical to a user and point at completely different causes.
 */
export function describeError(err: unknown): string {
  if (err === null || err === undefined) return "<none>";
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String((err as { name?: unknown }).name ?? "")
      : "";
  const ctor =
    typeof err === "object" && err !== null && err.constructor
      ? err.constructor.name
      : typeof err;
  const message = err instanceof Error ? err.message : String(err);
  return `${name || ctor}: ${message}`;
}

/**
 * Does this failure mean the file's bytes are no longer reachable?
 *
 * `NotReadableError` is the stale-reference case; `NotFoundError` its sibling,
 * where the file was moved or deleted after being picked. Neither is retryable —
 * there is nothing to retry against — so the caller must stop rather than loop.
 *
 * Matched three ways because the shape varies by engine and by how far the error
 * has been re-wrapped: a real `DOMException`, a duck-typed `name`, and finally
 * the message text, which is all that survives serialisation.
 */
export function isUnreadableFileError(err: unknown): boolean {
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String((err as { name?: unknown }).name ?? "")
      : "";
  if (name === "NotReadableError" || name === "NotFoundError") return true;

  const message = err instanceof Error ? err.message : String(err ?? "");
  return /NotReadableError|NotFoundError|could not be read|permission problems that have occurred/i.test(
    message
  );
}

/**
 * One-off snapshot of the device and browser.
 *
 * Deliberately includes OPFS availability and free origin storage. Copying each
 * file into origin-private storage at selection is the leading candidate fix,
 * and it is only viable where OPFS exists and the device has room — so this
 * says, from the actual failing device, whether that fix could even apply,
 * without shipping it.
 */
export async function envSnapshot(): Promise<string> {
  const bits: string[] = [];
  try {
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { effectiveType?: string; downlink?: number; rtt?: number };
    };
    const cap = (window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    }).Capacitor;
    // Which shell this actually ran in has never been confirmed, and it decides
    // whether a native fix is even on the table.
    bits.push(
      `shell=${
        cap ? `capacitor/${cap.getPlatform?.() ?? "?"}${cap.isNativePlatform?.() ? "/native" : "/web"}` : "browser"
      }`
    );
    bits.push(`deviceMemory=${nav.deviceMemory ?? "?"}GB cores=${navigator.hardwareConcurrency ?? "?"}`);
    const c = nav.connection;
    if (c) bits.push(`net=${c.effectiveType ?? "?"} rtt=${c.rtt ?? "?"}ms down=${c.downlink ?? "?"}Mbps`);
    const opfs = typeof navigator.storage?.getDirectory === "function";
    bits.push(`opfs=${opfs ? "yes" : "no"}`);
    if (typeof navigator.storage?.estimate === "function") {
      const est = await navigator.storage.estimate();
      if (typeof est.quota === "number" && typeof est.usage === "number") {
        bits.push(`originFree=${Math.round((est.quota - est.usage) / (1024 * 1024))}MB`);
      }
    }
    bits.push(`ua="${navigator.userAgent}"`);
  } catch (err) {
    bits.push(`envError=${describeError(err)}`);
  }
  return bits.join(" ");
}

export interface MonitoredFile {
  id: string;
  file: File;
  /**
   * True once this file's bytes have been copied into origin-private storage.
   * The OS reference may then die at any time — backgrounding the app reliably
   * kills every one of them — without affecting the upload, which reads the
   * copy. Recorded so the timeline distinguishes "a handle died and the upload
   * is now doomed" from "a handle died and nothing depends on it any more".
   */
  snapshotted?: boolean;
}

/**
 * Poll every picked file for readability and record the moment each one dies.
 *
 * This is the measurement the whole investigation turns on. Without it we only
 * learn a handle was dead when an upload happened to reach it, minutes later —
 * which cannot distinguish "died at 04:12 when the screen locked" from "died
 * the instant it was read".
 *
 * Reads are 1 KB and a few seconds apart, so the cost is nil, and a read does
 * not renew an Android grant — observing does not change what is observed.
 *
 * Returns a stop function.
 */
export function startHandleMonitor(
  getFiles: () => MonitoredFile[],
  intervalMs = 10_000
): () => void {
  const dead = new Set<string>();
  let stopped = false;
  let ticking = false;

  const tick = async () => {
    // A slow tick must not overlap the next one, or the log interleaves and the
    // timestamps stop meaning anything.
    if (stopped || ticking) return;
    ticking = true;
    try {
      const files = getFiles();
      if (files.length === 0) return;

      let alive = 0;
      let deadButProtected = 0;
      const newlyDead: string[] = [];
      for (const { id, file, snapshotted } of files) {
        if (dead.has(id)) continue;
        try {
          await file.slice(0, Math.min(PROBE_BYTES, file.size)).arrayBuffer();
          alive += 1;
        } catch (err) {
          dead.add(id);
          if (snapshotted) deadButProtected += 1;
          newlyDead.push(
            `${file.name}${snapshotted ? " [snapshotted — upload unaffected]" : ""} [${describeError(err)}]`
          );
        }
      }

      if (newlyDead.length > 0) {
        // The headline event. How MANY died at once is the discriminator:
        // several at once is a process-wide reclaim, one at a time is not.
        // `protected` says how many of them no longer matter.
        diagLog(
          "HANDLES-DIED",
          `${newlyDead.length} died (${deadButProtected} protected by a snapshot) · ` +
            `${alive}/${files.length} still readable · ` +
            `visibility=${document.visibilityState} · ${newlyDead.join(" | ")}`
        );
      } else {
        diagLog("HANDLES-OK", `${alive}/${files.length} readable · visibility=${document.visibilityState}`);
      }
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  void tick(); // establish the t≈0 baseline immediately

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Record page-lifecycle and connectivity events.
 *
 * These are the candidate triggers. If `HANDLES-DIED` lands within a second or
 * two of `VISIBILITY hidden` or `FREEZE`, the cause is the app being
 * backgrounded and the fix is about holding the bytes before that can happen.
 * If the handles die with the page visible and the network fine, it is not.
 */
export function watchPageLifecycle(): () => void {
  const onVisibility = () => diagLog("VISIBILITY", document.visibilityState);
  const onPageHide = () => diagLog("PAGEHIDE");
  const onPageShow = () => diagLog("PAGESHOW");
  const onFreeze = () => diagLog("FREEZE");
  const onResume = () => diagLog("RESUME");
  const onOnline = () => diagLog("ONLINE");
  const onOffline = () => diagLog("OFFLINE");

  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("freeze", onFreeze);
  document.addEventListener("resume", onResume);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("freeze", onFreeze);
    document.removeEventListener("resume", onResume);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}
