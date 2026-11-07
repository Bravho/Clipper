/**
 * Browser preparation of one lab source. Reuses the studio's own probe
 * (`probeVideo` in editorState: duration and a poster frame drawn on a canvas,
 * with its own 20 s timeout and its own cleanup of its element and URL).
 *
 * This file adds what the lab needs on top:
 *  - a preview object URL for the studio's source record, revoked by release();
 *  - a bounded wait (timeoutMs) and cancellation (signal), either of which
 *    revokes the preview URL and rejects;
 *  - a hard rule that the FILE is never deleted or revoked here. Only the
 *    temporary object URL is released.
 */

export interface ProbeResult {
  durationSeconds: number;
  posterUrl: string | null;
}

export interface PrepareLabSourceDeps {
  probe(file: File): Promise<ProbeResult>;
  createObjectURL(file: File): string;
  revokeObjectURL(url: string): void;
  timeoutMs: number;
  /** Set by the caller to cancel. Read when the probe resolves and before starting. */
  isCancelled(): boolean;
}

export interface PreparedLabSource {
  previewUrl: string;
  posterUrl: string;
  durationSeconds: number;
  /** Revokes the preview URL only. Idempotent. Never touches the file. */
  release(): void;
}

export class LabMediaPrepError extends Error {
  constructor(readonly reason: "timeout" | "cancelled" | "probe_failed" | "no_poster" | "no_duration") {
    super(`lab media preparation: ${reason}`);
    this.name = "LabMediaPrepError";
  }
}

export async function prepareLabSource(file: File, deps: PrepareLabSourceDeps): Promise<PreparedLabSource> {
  if (deps.isCancelled()) throw new LabMediaPrepError("cancelled");

  const previewUrl = deps.createObjectURL(file);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    deps.revokeObjectURL(previewUrl);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LabMediaPrepError("timeout")), deps.timeoutMs);
    });
    const probed = await Promise.race([deps.probe(file).catch(() => Promise.reject(new LabMediaPrepError("probe_failed"))), timedOut]);

    if (deps.isCancelled()) throw new LabMediaPrepError("cancelled");
    if (probed.durationSeconds === null || !(probed.durationSeconds > 0)) throw new LabMediaPrepError("no_duration");
    if (!probed.posterUrl) throw new LabMediaPrepError("no_poster");

    return { previewUrl, posterUrl: probed.posterUrl, durationSeconds: probed.durationSeconds, release };
  } catch (error) {
    release();
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
