"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  submitClipRequestSchema,
  SubmitClipRequestValues,
} from "@/features/requests/validation/clipRequestSchema";
import { Platform } from "@/domain/enums/Platform";
import {
  MAX_UPLOAD_COUNT,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  MAX_UPLOAD_SIZE_BYTES,
  MAX_CLIP_DURATION_SECONDS,
  ACCEPTED_MIME_TYPES,
  ACCEPTED_IMAGE_MIME_TYPES,
  ACCEPTED_VIDEO_MIME_TYPES,
} from "@/domain/enums/AssetType";
import {
  validateTotalUploadSize,
  validateClipDuration,
} from "@/features/requests/validation/clipRequestSchema";
import { CREDITS_CONFIG, PIPELINE_STEP_COSTS } from "@/config/credits";
import { ROUTES, requestDetailPath } from "@/config/routes";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { useI18n } from "@/i18n/client";
import {
  getMobilePlatform,
  type MobilePlatform,
} from "@/lib/mobile/platform";
import {
  DRAFT_ID_KEY,
  clearDraftPersistence,
  clearMpuSession,
  getMpuSession,
  loadMpuMap,
  lsGet,
  lsSet,
  saveMpuSession,
} from "@/features/requests/draftStorage";
import {
  describeError,
  diagDump,
  diagLog,
  diagReset,
  envSnapshot,
  isUnreadableFileError,
  startHandleMonitor,
  watchPageLifecycle,
} from "@/features/requests/uploadDiagnostics";

const GoogleMapLocationPicker = dynamic(() =>
  import("@/features/requests/components/GoogleMapLocationPicker").then(
    (module) => module.GoogleMapLocationPicker
  )
);

interface PendingFile {
  id: string;
  file: File;
  /** Blocking problem — the file is excluded from upload until the user acts. */
  error?: string;
  /**
   * The browser could not decode this clip well enough to measure its length,
   * so the ≤MAX_CLIP_DURATION_SECONDS rule could not be checked locally. Not an
   * error: the clip may well be fine, and the server's ffprobe is authoritative.
   * Surfaced so an eventual server rejection is not a surprise.
   */
  durationUnverified?: boolean;
  /**
   * The SERVER rejected this file on a business rule (e.g. over the length cap).
   * Distinct from a network failure: re-uploading identical bytes will be
   * rejected identically, so retry must skip it instead of looping for ever.
   */
  rejected?: string;
}

/** A source file already uploaded to a resumed draft — shown as done, not re-uploaded. */
export interface ResumeUploadedAsset {
  fileName: string;
  fileSizeBytes: number;
  assetType: "image" | "video";
  thumbnailUrl?: string;
  storageUrl?: string;
}

interface NewRequestFormProps {
  creditBalance: number;
  /**
   * True when this will be the user's free trial (first) request — submission
   * is free (pay-to-download later), so the credit gate must not block it.
   */
  trialAvailable?: boolean;
  /** When true, only image uploads are accepted (no video files). */
  imageOnly?: boolean;
  /** Override the credit cost shown and validated. Defaults to REQUEST_COST_CREDITS. */
  creditCost?: number;
  /** Called whenever duration or platform count changes so parent can update the pipeline estimate. */
  onCreditParamsChange?: (durationSeconds: number, platformCount: number) => void;
  /**
   * Resume mode (draft opened from the dashboard): reuse this request id instead
   * of creating a new one, so files already uploaded to it are kept and only the
   * missing ones are sent.
   */
  existingRequestId?: string;
  /** Prefill values for a resumed draft. */
  initialValues?: Partial<SubmitClipRequestValues>;
  /** Files already uploaded to the resumed draft — shown as done; not re-uploaded. */
  uploadedAssets?: ResumeUploadedAsset[];
}

const MAX_IMAGE_SIZE_MB = MAX_IMAGE_SIZE_BYTES / (1024 * 1024);
const MAX_VIDEO_SIZE_MB = MAX_VIDEO_SIZE_BYTES / (1024 * 1024);
const MAX_UPLOAD_SIZE_MB = Math.round(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024));

/**
 * Serialise every `<video>` decode this form performs.
 *
 * WHY THIS QUEUE EXISTS — this is the root cause of "some clips can never be
 * uploaded, however many times I retry".
 *
 * A phone's hardware video decoder is a fixed, shared resource. Android's
 * Codec2 layer allows only a handful of concurrent decoder instances, and HEVC
 * (H.265) — what OPPO/OnePlus cameras record by default — is the most expensive
 * of them. `addFiles` used to open TWO detached `<video>` elements per selected
 * file (one to read the duration, one to grab a poster frame) and start them all
 * at once, in unbounded parallel `for` loops. Ten clips meant twenty simultaneous
 * decoder instances, which the SoC answers with:
 *
 *     QC2Comp  [hvcD_243][ERROR] entered
 *     OplusFeedback  PkgName#com.rclipper.app#ErrorCode#C2_NO_MEMORY
 *     chromium  PipelineStatus::PIPELINE_ERROR_DECODE
 *
 * Whichever clips lost that race got `onerror`, so `readVideoDuration` resolved
 * NaN — and NaN is deliberately treated as "unknown, don't block". The
 * client-side length check was therefore SILENTLY SKIPPED for exactly those
 * files. They uploaded in full, and only then did the server's ffprobe measure
 * them and reject anything over the cap, which the UI could only show as a bare
 * "ผิดพลาด". Retrying re-ran the identical race and re-uploaded the identical
 * file to the identical rejection, for ever.
 *
 * One decode at a time makes the probe deterministic, so an over-length clip is
 * caught at selection instead of after a 100 MB upload.
 */
let videoProbeChain: Promise<unknown> = Promise.resolve();
function queueFilePrep<T>(task: () => Promise<T>): Promise<T> {
  const run = videoProbeChain.then(task, task);
  // Never let one rejection poison the chain for every later probe.
  videoProbeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export interface VideoProbeResult {
  /** Seconds, or NaN when the browser could not decode the clip at all. */
  durationSeconds: number;
  /** JPEG data URL of a frame ~0.5s in, or null when extraction failed. */
  poster: string | null;
}

/**
 * Read a clip's duration AND poster frame from ONE `<video>` element.
 *
 * Previously these were two independent functions, each opening its own element
 * and its own object URL — doubling decoder pressure for no benefit, since the
 * poster pass already has to load metadata to seek. Sharing the element halves
 * the cost and guarantees the two values describe the same decode.
 *
 * Always resolves; never rejects. `preload="metadata"` (not `"auto"`, which the
 * duration path used to request) is enough for both jobs and avoids pulling a
 * whole 300 MB clip through the decoder just to learn how long it is.
 */
function probeVideo(file: File): Promise<VideoProbeResult> {
  return new Promise((resolve) => {
    let url: string | null = null;
    let video: HTMLVideoElement | null = null;
    let settled = false;

    const finish = (result: VideoProbeResult) => {
      if (settled) return;
      settled = true;
      if (url) URL.revokeObjectURL(url);
      if (video) {
        // Detach the source and load() the empty element so Chromium releases
        // the decoder NOW rather than at some later GC. Without this the queue
        // would still pile up instances and defeat the whole point.
        video.removeAttribute("src");
        video.srcObject = null;
        try {
          video.load();
        } catch {
          /* nothing to release */
        }
        video = null;
      }
      resolve(result);
    };

    try {
      url = URL.createObjectURL(file);
      video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;

      const capture = (durationSeconds: number) => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video?.videoWidth || 320;
          canvas.height = video?.videoHeight || 180;
          const ctx = canvas.getContext("2d");
          if (!ctx || !video) return finish({ durationSeconds, poster: null });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish({ durationSeconds, poster: canvas.toDataURL("image/jpeg", 0.7) });
        } catch {
          finish({ durationSeconds, poster: null });
        }
      };

      video.onloadedmetadata = () => {
        // Duration is known here even if the frame grab later fails, so a clip
        // whose codec cannot be rendered is still length-checked.
        const durationSeconds = video?.duration ?? NaN;
        if (!video) return finish({ durationSeconds, poster: null });
        video.onseeked = () => capture(durationSeconds);
        video.onerror = () => finish({ durationSeconds, poster: null });
        const target = Math.min(0.5, (Number.isFinite(durationSeconds) ? durationSeconds : 1) / 2);
        try {
          video.currentTime = target;
        } catch {
          capture(durationSeconds);
        }
      };
      video.onerror = () => finish({ durationSeconds: NaN, poster: null });
      // Safety net if metadata/seek never fires — without it a wedged decoder
      // would stall the whole serial queue behind it.
      setTimeout(() => finish({ durationSeconds: NaN, poster: null }), 15_000);
      video.src = url;
      video.load();
    } catch {
      finish({ durationSeconds: NaN, poster: null });
    }
  });
}

/**
 * Client-side multipart part size — MUST stay ≤ the ~8–15 MB single-request cap
 * imposed by the HTTPS-inspecting network intermediary (see lib/spaces.ts) and
 * ≥ the 5 MB S3 minimum part size. Files larger than this upload in chunks;
 * smaller ones use a single presigned PUT. The server echoes its own partSize on
 * initiate, which is what actually drives slicing — this is only the threshold.
 */
const MULTIPART_THRESHOLD_BYTES = 5 * 1024 * 1024;

/**
 * Fallback part size, used only when a session carries no recorded partSize —
 * i.e. one persisted by a build before partSize was stored. Should match the
 * server's MULTIPART_PART_SIZE (5 MB), because that is what those older sessions
 * were sliced at.
 *
 * The live value now comes from the server's initiate response and is persisted
 * in the MpuSession, so a resume re-slices at exactly the boundaries its stored
 * parts used rather than at whatever this constant currently says.
 */
const MULTIPART_PART_SIZE = 5 * 1024 * 1024;

// ── Resume support ──────────────────────────────────────────────────────────
// Uploads are made resumable so a dropped connection (frequent on mobile) does
// not force a restart. Durable state lives in two places:
//   • server: the Draft request + confirmed assets (survive anything)
//   • localStorage: the draft id + per-file multipart session ids (survive a
//     reload / the app being backgrounded on iOS/Android WebView)
// The one thing that CANNOT be persisted is the File's bytes — so a file that
// never finished must be re-selected by the user; we then resume it via ListParts.

/** Stable per-file signature (client only) for matching a re-selected file to a
 *  persisted multipart session.
 *
 *  DELIBERATELY EXCLUDES `lastModified`. It used to be part of this key, which
 *  defeated the entire resume feature on the platform it exists for: Android's
 *  gallery provider re-stats a clip when it is re-picked, so the same file comes
 *  back with a *different* lastModified. The session lookup then missed, the
 *  client initiated a brand-new multipart upload, and a video that was 90%
 *  uploaded restarted from zero — while leaving another orphaned Pending record
 *  behind. Name + size + type is what actually survives a re-pick, and it is the
 *  same identity the server already uses to match an asset (nameSizeSig). */
const fileSig = (f: File) => `${f.name}::${f.size}::${f.type}`;
/** name+size signature — used to match a local file to a server-side asset (the
 *  server records no MIME-independent identity beyond these two). */
const nameSizeSig = (name: string, size: number) => `${name}::${size}`;

const hostOf = (u: string) => {
  try {
    return new URL(u, window.location.origin).host;
  } catch {
    return u;
  }
};

/** fetch() that annotates a thrown (network/CORS/CSP) failure with the step and
 *  host, so the on-screen error names exactly which request died — a bare
 *  "Failed to fetch" otherwise tells the user nothing. */
async function netFetch(label: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const host = hostOf(url);
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[submit] ${label} → ${host} threw:`, e);
    throw new Error(
      `เชื่อมต่อไม่สำเร็จที่ขั้นตอน "${label}" (${host}: ${detail}). ` +
        `การเชื่อมต่อถูกบล็อกหรือขาดหาย ไม่ใช่ข้อผิดพลาดจากเซิร์ฟเวอร์`
    );
  }
}

/**
 * The SERVER refused this file on a business rule — HTTP 422 from the presign,
 * multipart-initiate, or confirm step. The bytes are irrelevant: it will refuse
 * the identical file identically, every time.
 *
 * This is carried as its own error type because the three rejection points are
 * spread across the upload flow, and the generic `catch` around an upload used
 * to flatten all of them into the same retryable "อัปโหลดไม่สำเร็จ" as a dropped
 * connection. That is what let a permanently-refused clip sit in the retry loop
 * being re-uploaded and re-refused indefinitely.
 *
 * Current 422s: over the per-request total size cap, over the per-file size cap,
 * over the file-count cap, unsupported type, clip longer than the duration cap.
 */
class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

/** Throw the right error type for a failed upload-control response. */
async function throwForUploadResponse(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  const message = typeof body.error === "string" && body.error ? body.error : fallback;
  if (res.status === 422) throw new UploadRejectedError(message);
  throw new Error(message);
}

/** A dropped part on a flaky mobile connection surfaces as XHR onerror with an
 *  empty status → "Failed to fetch" (or a timeout). These are network-layer
 *  blips, not real rejections from Spaces, so they are safe to retry: re-PUTting
 *  the same presigned part URL is idempotent within its TTL. A genuine HTTP
 *  4xx/5xx (e.g. an expired presign → "upload HTTP 403") is NOT matched here and
 *  is thrown immediately so we don't hammer a truly-failing request. */
function isTransientNetworkError(msg: string): boolean {
  return /Failed to fetch|timeout|network error|Load failed|connection|net::/i.test(msg);
}

/** Snapshot the browser's live network condition. This is the single most useful
 *  signal for telling upload failures apart: a CORS/preflight block fails INSTANTLY
 *  with onLine=true, a real connection drop shows onLine flipping false or rtt
 *  spiking, and a throttled link shows a low downlink. The Network Information API
 *  is not on every browser (notably Safari/iOS), so this is fully guarded. */
function connInfo(): string {
  try {
    const nav = navigator as Navigator & {
      connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
    };
    const online = typeof navigator !== "undefined" ? navigator.onLine : "?";
    const c = nav.connection;
    return c
      ? `onLine=${online} net=${c.effectiveType ?? "?"} down=${c.downlink ?? "?"}Mbps rtt=${c.rtt ?? "?"}ms${c.saveData ? " saveData" : ""}`
      : `onLine=${online} (no NetworkInformation API)`;
  } catch {
    return "conn=?";
  }
}

/** Run an upload step with bounded exponential-backoff retries on transient
 *  network failures. This is what turns a single dropped part on a 4K mobile
 *  upload (many sequential ≤5 MB PUTs) into an automatic recovery instead of a
 *  whole-file "Failed to fetch" that forces the user to press the retry button.
 *  Non-transient errors bubble up on the first occurrence. `label` is threaded
 *  into the retry log so we can see exactly which part is flaking. */
async function withNetworkRetry<T>(fn: () => Promise<T>, attempts = 3, label = ""): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (i === attempts - 1 || !isTransientNetworkError(msg)) {
        console.error(
          `[upload] ${label} giving up after attempt ${i + 1}/${attempts}: ${msg} — ${connInfo()}`
        );
        throw e;
      }
      const backoff = 800 * 2 ** i;
      console.warn(
        `[upload] ${label} transient error attempt ${i + 1}/${attempts}, retrying in ${backoff}ms: ${msg} — ${connInfo()}`
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/** Read a byte range of a File into an in-memory Blob, detached from the on-disk
 *  file.
 *
 *  WHY DETACH: on mobile — notably Android/OPPO camera HEVC clips — the file's
 *  on-disk modification time can shift between selection and the actual PUT (the
 *  gallery provider re-stats or touches it). Chrome then aborts the upload with
 *  net::ERR_UPLOAD_FILE_CHANGED, which XHR can only surface as a bare onerror /
 *  "Failed to fetch" with sent=0 — exactly the symptom seen (one file uploads,
 *  the next fails instantly on a healthy 4G link). Uploading from an in-memory
 *  copy removes that send-time re-validation entirely.
 *
 *  WHY A RANGE AND NOT THE WHOLE FILE: this used to snapshot each entire file,
 *  and `addFiles` kicked those reads off for EVERY selected file the moment the
 *  picker returned. The old comment claimed peak memory was "bounded to a single
 *  clip"; it was not — every snapshot was retained in `fileBlobPromises` until
 *  submit, so peak was the sum of the whole batch (up to MAX_UPLOAD_SIZE_BYTES,
 *  500 MB), and `arrayBuffer()` → `new Blob()` transiently doubles each file on
 *  top of that. A handful of camera clips was enough to push the Android WebView
 *  renderer over its memory budget; locking the screen mid-upload then gave
 *  Android every reason to kill it, losing the upload and forcing a cold reload.
 *
 *  Reading one range at a time keeps peak memory at ~2× the part size (10 MB)
 *  regardless of batch size, and makes the detach *stronger*: the bytes are read
 *  moments before their own PUT instead of minutes earlier. */
/**
 * The file's BYTES are gone — the OS reference died between selection and this
 * read. On Android that is either the SAF `content://` grant lapsing (it is
 * scoped to the Activity that received the picker result) or the gallery
 * provider re-stating the clip so Blink's `(size, lastModified)` snapshot no
 * longer validates. Chromium reports both as `NotReadableError`.
 *
 * Carried as its own type because it is the exact opposite of a transient
 * network failure, and used to be treated as one. There is nothing to retry
 * against: the web layer cannot re-open a `content://` URI whose grant it no
 * longer holds, so every retry re-reads the same dead reference and fails
 * identically — which is precisely why a batch of clips looked permanently
 * un-uploadable however many times the user pressed "ลองอัปโหลดต่อ".
 *
 * The only real recovery is re-selecting the file, which resumes rather than
 * restarts: the multipart session is keyed on `fileSig` (name+size+type), so the
 * parts that already landed are still credited.
 */
class FileUnreadableError extends Error {
  readonly fileName: string;
  constructor(fileName: string) {
    super(
      "อ่านไฟล์นี้จากเครื่องไม่ได้แล้ว (สิทธิ์เข้าถึงไฟล์หมดอายุระหว่างอัปโหลด) — " +
        "กรุณาลบไฟล์นี้ออกแล้วเลือกใหม่อีกครั้ง ระบบจะอัปโหลดต่อจากส่วนที่ค้างไว้ ไม่เริ่มใหม่"
    );
    this.name = "FileUnreadableError";
    this.fileName = fileName;
  }
}

async function materializeRange(file: File, start: number, end: number): Promise<Blob> {
  try {
    const buf = await file.slice(start, end).arrayBuffer();
    return new Blob([buf], { type: file.type });
  } catch (err) {
    // Distinguish "this file is gone" from a genuine I/O hiccup BEFORE the
    // retry machinery sees it — withNetworkRetry and the multipart round loop
    // both treat an unclassified throw as worth another attempt.
    if (isUnreadableFileError(err)) {
      // The exact byte range and moment a handle stopped working — the single
      // most useful line in the whole timeline.
      diagLog("READ-FAIL@upload", `${file.name} bytes=${start}-${end} ${describeError(err)}`);
      throw new FileUnreadableError(file.name);
    }
    throw err;
  }
}

/** Whole-file variant. Only ever used for files below MULTIPART_THRESHOLD_BYTES
 *  (5 MB), which upload in a single PUT — larger files go part by part. */
async function materializeFile(file: File): Promise<Blob> {
  return materializeRange(file, 0, file.size);
}

/** Bytes read at selection to prove a file is actually present on the device.
 *  A cloud/SD placeholder (Google Photos "free up space", an unmounted SD card)
 *  throws NotReadableError on the very first read, so a small slice detects it
 *  just as reliably as a full read — and costs nothing. */
const READABILITY_PROBE_BYTES = 256 * 1024;

/** Fail fast at selection time when a file's bytes cannot be read at all, so the
 *  user can re-pick it immediately instead of discovering it mid-upload after a
 *  long wait. Resolves on success, rejects on an unreadable file. */
async function probeReadable(file: File): Promise<void> {
  await file.slice(0, Math.min(READABILITY_PROBE_BYTES, file.size)).arrayBuffer();
}

/** PUT one blob (whole file or one part), annotating a thrown network error with
 *  the target host so the on-screen failure names it (e.g. Spaces). */
async function putPart(
  url: string,
  blob: Blob,
  onProgress: (loaded: number, total: number) => void,
  contentType?: string,
  ctx = "PUT"
): Promise<string> {
  try {
    return await putBlobWithProgress(url, blob, onProgress, contentType, ctx);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`${hostOf(url)}: ${detail}`);
  }
}

/**
 * PUT a Blob (a whole file, or one multipart chunk) to a presigned Spaces URL via
 * XMLHttpRequest so we can report real upload progress (fetch() exposes no
 * upload-progress events). Resolves with the response ETag (needed to complete a
 * multipart upload; the bucket CORS rule exposes it), rejects otherwise.
 * `onProgress` receives (loadedBytes, totalBytes) so callers can aggregate across
 * parts. A network/CORS/CSP block surfaces as xhr.onerror with an empty status,
 * which we translate to the same "Failed to fetch" wording the diagnostic wrapper
 * labels. `contentType` is set only for single-file PUTs (whose presign signs it);
 * multipart part URLs are not signed with a content type, so it's omitted there.
 */
function putBlobWithProgress(
  url: string,
  blob: Blob,
  onProgress: (loaded: number, total: number) => void,
  contentType?: string,
  ctx = "PUT"
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startedAt = Date.now();
    const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    // Track whether ANY bytes actually left the device before a failure. This is
    // the key discriminator: a CORS/preflight block fails with sent=0 almost
    // instantly, whereas a genuine mid-transfer drop fails after sent>0.
    let sent = 0;
    xhr.open("PUT", url, true);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    // Bound each part so a dead connection surfaces as a loggable timeout instead
    // of hanging forever. Scaled to the blob so a slow-but-alive link isn't cut
    // off: ~40 KB/s floor, minimum 60s (a 5 MB part allows ~125s).
    xhr.timeout = Math.max(60_000, Math.ceil(blob.size / 40));
    xhr.upload.onprogress = (ev) => {
      sent = ev.loaded;
      if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag") ?? "";
        console.info(
          `[upload] ${ctx} OK http=${xhr.status} in ${elapsed()} etag=${etag ? "yes" : "MISSING"} size=${blob.size}B`
        );
        onProgress(blob.size, blob.size);
        resolve(etag);
      } else {
        // A real HTTP response reached us — status + body ARE the root cause.
        // 403 = presign expired/invalid or bad signature; 400 with an HTML body =
        // the ~8-15 MB intermediary/proxy page (see lib/spaces.ts); 4xx AccessDenied
        // = bucket policy. All far more informative than "Failed to fetch".
        const body = (xhr.responseText || "").slice(0, 400);
        const headers = xhr.getAllResponseHeaders().replace(/\r?\n/g, " | ").trim();
        console.error(
          `[upload] ${ctx} HTTP ${xhr.status} ${xhr.statusText} in ${elapsed()} sent=${sent}B/${blob.size}B` +
            `\n  responseHeaders: ${headers}` +
            `\n  responseBody: ${body}`
        );
        reject(new Error(`upload HTTP ${xhr.status}`));
      }
    };
    // Empty-status onerror is the browser blocking/aborting the request before any
    // response — CORS preflight rejection, TLS failure, or a network drop. The
    // sent-bytes + elapsed + connInfo snapshot below is what tells these apart:
    //   sent=0 & elapsed≈0 & onLine=true → almost certainly CORS/preflight
    //   sent>0 (bytes flowed, then died)  → genuine connection drop
    xhr.onerror = () => {
      console.error(
        `[upload] ${ctx} NETWORK-FAIL http=${xhr.status} readyState=${xhr.readyState} ` +
          `sent=${sent}B/${blob.size}B in ${elapsed()} — ${connInfo()} — ` +
          `${sent === 0 ? "no bytes left device (suspect ERR_UPLOAD_FILE_CHANGED / file touched on disk, or CORS/preflight/TLS — check the Network tab's net:: reason)" : "bytes flowed then dropped (suspect connection loss)"}`
      );
      reject(new Error("Failed to fetch"));
    };
    xhr.ontimeout = () => {
      console.error(
        `[upload] ${ctx} TIMEOUT after ${elapsed()} sent=${sent}B/${blob.size}B (limit ${xhr.timeout}ms) — ${connInfo()}`
      );
      reject(new Error("upload timeout"));
    };
    xhr.send(blob);
  });
}

type UploadStage = "pending" | "uploading" | "done" | "error" | "rejected";
interface UploadItemProgress {
  pct: number;
  stage: UploadStage;
}

type SubmitPhase = "form" | "submitting";

export function NewRequestForm({ creditBalance, trialAvailable = false, imageOnly = false, creditCost, onCreditParamsChange, existingRequestId, initialValues, uploadedAssets }: NewRequestFormProps) {
  const { t } = useI18n();
  const COST = creditCost ?? CREDITS_CONFIG.REQUEST_COST_CREDITS;
  const acceptedTypes = imageOnly ? ACCEPTED_IMAGE_MIME_TYPES : ACCEPTED_MIME_TYPES;

  const router = useRouter();
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [phase, setPhase] = useState<SubmitPhase>("form");
  const [uploadProgress, setUploadProgress] = useState<Record<string, UploadItemProgress>>({});
  const [mapOpen, setMapOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [mobilePlatform, setMobilePlatform] = useState<MobilePlatform>("web");

  /**
   * Local picker rows that the server has confirmed as Uploaded. They remain in
   * the grid so the user can see what succeeded, but must not be added to the
   * server totals a second time after reconciliation.
   */
  const [confirmedItemIds, setConfirmedItemIds] = useState<Set<string>>(
    () => new Set()
  );

  // Resume state. draftIdRef holds the single reused draft id (never recreated on
  // retry). When resuming a draft opened from the dashboard, it starts as that
  // draft's id. canRetry shows the "resume upload" button after a partial failure.
  // resumeInfo shows the banner when a returning user has an unfinished draft.
  const draftIdRef = useRef<string | null>(existingRequestId ?? null);
  // Guards against concurrent submits (double-tap / retry racing itself), which
  // could otherwise double-charge credits.
  const submittingRef = useRef(false);
  const [canRetry, setCanRetry] = useState(false);
  /** Latest pendingFiles, so the handle monitor can poll without re-subscribing. */
  const pendingFilesRef = useRef<PendingFile[]>([]);
  /** In-flight selection probes, awaited before any byte is uploaded. */
  const prepTasksRef = useRef<Map<string, Promise<void>>>(new Map());
  /** Reveals the diagnostic timeline so it can be copied off the device. */
  const [showDiag, setShowDiag] = useState(false);
  /**
   * An unfinished draft found via localStorage but NOT yet adopted.
   *
   * The mount effect used to adopt it outright (`draftIdRef.current = saved`),
   * which quietly turned "create a new request" into "keep filling in the old
   * one". A user who abandoned a half-finished upload and came back to start
   * fresh got the previous request's already-uploaded files attached to what
   * they believed was a new request — with no way to tell, because the id is
   * never shown. Nothing is adopted now until the user says so.
   */
  const [recoverableDraft, setRecoverableDraft] = useState<{
    draftId: string;
    uploadedNames: string[];
    uploadedBytes: number;
  } | null>(null);
  const [discardingDraft, setDiscardingDraft] = useState(false);
  /**
   * Bytes ALREADY stored on the server for this draft. Counts toward the
   * per-request total cap exactly as it does server-side, so the selection check
   * and the presign check agree. Seeded from a resumed draft's assets and
   * refreshed from the reconcile fetch on every submit/retry. A ref, not state:
   * addFiles reads it synchronously while building the accepted list.
   */
  const serverUploadedBytesRef = useRef(
    (uploadedAssets ?? []).reduce((sum, a) => sum + (Number(a.fileSizeBytes) || 0), 0)
  );
  /**
   * COUNT of files already stored on this request — the count half of the same
   * problem as serverUploadedBytesRef. MAX_UPLOAD_COUNT is a per-request cap, so
   * the picker's own list is not the whole story on a resumed draft.
   */
  const serverUploadedCountRef = useRef((uploadedAssets ?? []).length);
  const [resumeInfo, setResumeInfo] = useState<{ uploadedNames: string[] } | null>(
    existingRequestId
      ? { uploadedNames: (uploadedAssets ?? []).map((a) => a.fileName) }
      : null
  );

  const setItemProgress = useCallback((id: string, patch: Partial<UploadItemProgress>) => {
    setUploadProgress((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setFocus,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SubmitClipRequestValues>({
    resolver: zodResolver(submitClipRequestSchema),
    defaultValues: {
      // Prefill from the resumed draft when present, else the standard defaults.
      title: initialValues?.title,
      placeName: initialValues?.placeName,
      latitude: initialValues?.latitude,
      longitude: initialValues?.longitude,
      description: initialValues?.description,
      targetAudience: initialValues?.targetAudience,
      targetPlatforms: (initialValues?.targetPlatforms ?? [
        Platform.TravyApp,
      ]) as SubmitClipRequestValues["targetPlatforms"],
      durationSeconds: initialValues?.durationSeconds ?? PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS,
      creditConfirmed: undefined,
      rightsConfirmed: undefined,
      aiProcessingConfirmed: undefined,
    },
  });

  const watchedPlatforms = watch("targetPlatforms") ?? [];
  const watchedDuration = watch("durationSeconds") ?? PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS;
  const watchedPlaceName = watch("placeName");
  const watchedLatitude = watch("latitude");
  const watchedLongitude = watch("longitude");
  const creditConfirmed = watch("creditConfirmed") === true;
  const rightsConfirmed = watch("rightsConfirmed") === true;
  const aiProcessingConfirmed = watch("aiProcessingConfirmed") === true;
  const allConfirmationsAccepted =
    creditConfirmed && rightsConfirmed && aiProcessingConfirmed;

  const isPendingFileCounted = useCallback(
    (item: PendingFile) =>
      !item.error &&
      !item.rejected &&
      !confirmedItemIds.has(item.id) &&
      uploadProgress[item.id]?.stage !== "error" &&
      uploadProgress[item.id]?.stage !== "rejected",
    [confirmedItemIds, uploadProgress]
  );

  useEffect(() => {
    setMobilePlatform(getMobilePlatform());
  }, []);

  useEffect(() => {
    if (!confirmationOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmationOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [confirmationOpen]);

  useEffect(() => {
    const duration = typeof watchedDuration === "number" && !isNaN(watchedDuration)
      ? watchedDuration
      : PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS;
    const platformCount = (watchedPlatforms as Platform[]).length || PIPELINE_STEP_COSTS.RESIZE_FREE_CHANNELS;
    onCreditParamsChange?.(duration, platformCount);
  }, [watchedDuration, watchedPlatforms]); // eslint-disable-line react-hooks/exhaustive-deps



  const handleFileDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      addFiles(Array.from(e.dataTransfer.files));
    },
    [pendingFiles] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    // Allow selecting the same photo/video again after it has been removed.
    e.target.value = "";
  };

  const addFiles = (files: File[]) => {
    // Running total of bytes against the per-request cap, enforced as files are
    // added so the cap is hit HERE rather than mid-upload.
    //
    // It must start from the bytes already stored on the server, not from zero.
    // The server checks `sumUploadedBytes(requestId) + thisFile` against the same
    // cap, and on a resumed or partly-uploaded draft those stored bytes are
    // invisible to this list — so the two sides disagreed. The client waved
    // everything through; the server then refused each file whose turn came after
    // the cap was reached, one at a time, mid-batch. Because a *smaller* file can
    // still fit under the remaining headroom while a large one cannot, the
    // refusals interleaved with successes rather than forming a clean cut-off,
    // which made them look like random per-file failures instead of one budget
    // running out. And the refusal is permanent: the stored bytes stay stored, so
    // every retry hits the identical wall.
    let runningBytes =
      serverUploadedBytesRef.current +
      pendingFiles
        .filter(isPendingFileCounted)
        .reduce((sum, f) => sum + f.file.size, 0);

    // Running FILE COUNT against MAX_UPLOAD_COUNT, on the same basis the server
    // uses: files already stored on this request PLUS the ones staged here.
    //
    // This was `pendingFiles.length + files.indexOf(file)` — the picker's list
    // alone, starting from zero. On a resumed draft the server already holds N
    // uploaded files that this list knows nothing about, so the client happily
    // accepted a full batch of 10 while the server counted its own stored files
    // too and refused with "Maximum 10 files per request." the moment the true
    // total crossed the cap. Exactly the same client/server divergence as the
    // byte budget above, and permanent for the same reason: the stored files stay
    // stored, so every retry re-computes the identical count and refuses again.
    let runningCount =
      serverUploadedCountRef.current +
      pendingFiles.filter(isPendingFileCounted).length;

    const newItems: PendingFile[] = files.map((file) => {
      const id = crypto.randomUUID();
      let error: string | undefined;

      const isVideo = ACCEPTED_VIDEO_MIME_TYPES.includes(
        file.type as (typeof ACCEPTED_VIDEO_MIME_TYPES)[number]
      );

      if (imageOnly && isVideo) {
        error = "แพ็กเกจนี้รับเฉพาะไฟล์รูปภาพเท่านั้น";
      } else if (runningCount >= MAX_UPLOAD_COUNT) {
        error =
          serverUploadedCountRef.current > 0
            ? `คำขอนี้มีไฟล์ครบ ${MAX_UPLOAD_COUNT} ไฟล์แล้ว (อัปโหลดไว้ก่อนหน้า ${serverUploadedCountRef.current} ไฟล์)`
            : `อัพโหลดได้สูงสุด ${MAX_UPLOAD_COUNT} ไฟล์`;
      } else if (file.size > (isVideo ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES)) {
        error = `ไฟล์เกินขนาดสูงสุด ${isVideo ? MAX_VIDEO_SIZE_MB : MAX_IMAGE_SIZE_MB} MB`;
      } else if (!acceptedTypes.includes(file.type as never)) {
        error = "ประเภทไฟล์ไม่รองรับ";
      } else if (validateTotalUploadSize(runningBytes, file.size)) {
        error = `ขนาดไฟล์รวมเกิน ${MAX_UPLOAD_SIZE_MB} MB ต่อคำขอ`;
      }

      if (!error) {
        runningBytes += file.size;
        runningCount += 1;
      }
      return { id, file, error };
    });

    // The hard slice must leave room for what the server already holds, or it
    // would silently re-admit files the count check just rejected. Rejected and
    // errored entries are kept: they carry the reason the user needs to see.
    setPendingFiles((prev) => {
      const combined = [...prev, ...newItems];
      const room = Math.max(0, MAX_UPLOAD_COUNT - serverUploadedCountRef.current);
      let kept = 0;
      return combined.filter((f) => {
        if (f.error || f.rejected) return true;
        if (
          confirmedItemIds.has(f.id) ||
          uploadProgress[f.id]?.stage === "error" ||
          uploadProgress[f.id]?.stage === "rejected"
        ) {
          return true;
        }
        kept += 1;
        return kept <= room;
      });
    });

    // Open (or extend) the diagnostic timeline for this selection.
    if (pendingFiles.length === 0) {
      diagReset();
      void envSnapshot().then((env) => diagLog("ENV", env));
    }
    diagLog(
      "SELECT",
      newItems
        .map(
          (i) =>
            `${i.file.name} ${(i.file.size / 1e6).toFixed(1)}MB ${i.file.type || "unknown"}` +
            (i.error ? ` [not accepted: ${i.error}]` : "")
        )
        .join(" | ")
    );

    // Baseline liveness: read a slice of every accepted file IMMEDIATELY, in
    // parallel, while the picker's reference is as fresh as it will ever be.
    // This is the t≈0 datum the rest of the timeline is measured against —
    // without it a handle that died at t=90s is indistinguishable from one that
    // was never readable (a cloud/SD placeholder that is not on the device).
    for (const item of newItems) {
      if (item.error) continue;
      const at = Date.now();
      void probeReadable(item.file).then(
        () => diagLog("READ-OK@select", `${item.file.name} (${Date.now() - at}ms)`),
        (err) => {
          diagLog("READ-FAIL@select", `${item.file.name} ${describeError(err)}`);
          console.error(`[upload] readability probe ${item.file.name} failed at selection:`, err);
          setPendingFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    error:
                      "อ่านไฟล์นี้ไม่สำเร็จ (ไฟล์อาจไม่ได้อยู่ในเครื่อง) กรุณาเปิดไฟล์ในแกลเลอรีให้ดาวน์โหลดลงเครื่องก่อน แล้วเลือกใหม่",
                  }
                : f
            )
          );
        }
      );
    }

    // Images: an object URL is enough, and costs no decoder.
    for (const item of newItems) {
      if (item.error) continue;
      if (item.file.type.startsWith("image/")) {
        const objUrl = URL.createObjectURL(item.file);
        setPreviews((prev) => ({ ...prev, [item.id]: objUrl }));
      }
    }

    // Videos: ONE queued probe per clip yields both the poster frame and the
    // duration, one decode at a time — firing every clip's probe at once
    // exhausted the phone's hardware decoder (see queueFilePrep).
    //
    // Every probe's outcome AND duration is now recorded, because the decoder is
    // a prime suspect for killing the file handles. If HANDLES-DIED lands during
    // this phase, decoder pressure is the trigger; if the handles sail through
    // it and die later, it is not, and the C2_NO_MEMORY lead is dead.
    for (const item of newItems) {
      if (item.error) continue;
      const isVideo = ACCEPTED_VIDEO_MIME_TYPES.includes(
        item.file.type as (typeof ACCEPTED_VIDEO_MIME_TYPES)[number]
      );
      if (!isVideo) continue;

      const task = queueFilePrep(async () => {
        const at = Date.now();
        const { durationSeconds, poster } = await probeVideo(item.file);
        diagLog(
          "PROBE",
          `${item.file.name} ` +
            `duration=${Number.isFinite(durationSeconds) ? `${durationSeconds.toFixed(1)}s` : "FAILED"} ` +
            `poster=${poster ? "yes" : "no"} (${Date.now() - at}ms)`
        );

        // Computed outside the updater: a state updater can be invoked more than
        // once (StrictMode), and createObjectURL inside it would leak a URL on
        // every extra call.
        const preview = poster ?? URL.createObjectURL(item.file);
        setPreviews((prev) => {
          const previous = prev[item.id];
          if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
          return { ...prev, [item.id]: preview };
        });

        const tooLong = validateClipDuration(durationSeconds);
        if (tooLong) {
          setPendingFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    error:
                      `คลิปยาว ${Math.round(durationSeconds)} วินาที ` +
                      `เกินกำหนด ${MAX_CLIP_DURATION_SECONDS} วินาที — กรุณาตัดให้สั้นลงแล้วเลือกใหม่`,
                  }
                : f
            )
          );
          return;
        }

        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          // Could not be measured here. Say so instead of uploading it and
          // letting the server reject it after the bytes are already sent.
          setPendingFiles((prev) =>
            prev.map((f) => (f.id === item.id ? { ...f, durationUnverified: true } : f))
          );
        }
      }).catch((err) => {
        diagLog("PROBE-THREW", `${item.file.name} ${describeError(err)}`);
      });
      prepTasksRef.current.set(item.id, task);
    }
  };

  const removeFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
    setConfirmedItemIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    prepTasksRef.current.delete(id);
    diagLog("REMOVE", id);
  };

  // Drop previews for removed files, revoking any blob: object URLs (image
  // previews). Video thumbnails are data: URLs and need no revocation.
  // Generation happens in addFiles, not here, so async video posters survive.
  useEffect(() => {
    const ids = new Set(pendingFiles.map((f) => f.id));
    setPreviews((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [id, url] of Object.entries(prev)) {
        if (ids.has(id)) {
          next[id] = url;
        } else {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [pendingFiles]);

  useEffect(() => {
    return () => {
      Object.values(previews).forEach((url) => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the monitor's view of the file list current without re-subscribing.
  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  // The measurement this build exists for: poll every picked file for
  // readability, timestamping the moment each one dies, alongside the page
  // lifecycle events that are the candidate triggers. See uploadDiagnostics.
  useEffect(() => {
    const stopLifecycle = watchPageLifecycle();
    const stopMonitor = startHandleMonitor(() =>
      pendingFilesRef.current
        .filter((f) => !f.error && !f.rejected)
        .map((f) => ({ id: f.id, file: f.file }))
    );
    return () => {
      stopLifecycle();
      stopMonitor();
    };
  }, []);

  // On mount, LOOK FOR an unfinished draft (survives reload / app relaunch on
  // iOS/Android) and offer it — but never adopt it silently. If the user does
  // nothing, this page creates a brand-new request on submit, which is what
  // "new request" has to mean. Offline is left intact for a later attempt.
  useEffect(() => {
    // Explicit resume from the dashboard wins — adopt that draft id and don't let
    // a stale localStorage pointer from an earlier draft override it.
    if (existingRequestId) {
      draftIdRef.current = existingRequestId;
      lsSet(DRAFT_ID_KEY, existingRequestId);
      return;
    }
    const saved = lsGet(DRAFT_ID_KEY);
    if (!saved) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/uploads/${saved}`);
        if (!res.ok) {
          clearDraftPersistence(saved);
          return;
        }
        const data = (await res.json()) as {
          status: string;
          assets: { fileName: string; fileSizeBytes: number; uploadStatus: string }[];
        };
        if (cancelled) return;
        if (data.status !== "draft") {
          clearDraftPersistence(saved);
          return;
        }
        const uploaded = (data.assets ?? []).filter((a) => a.uploadStatus === "uploaded");
        const hasMpu = Object.keys(loadMpuMap(saved)).length > 0;
        if (uploaded.length === 0 && !hasMpu) {
          clearDraftPersistence(saved);
          return;
        }
        // Offer it. `draftIdRef` stays null so an untouched form still mints a
        // fresh request — adoption happens in handleResumeDraft, on a click.
        setRecoverableDraft({
          draftId: saved,
          uploadedNames: uploaded.map((a) => a.fileName),
          uploadedBytes: uploaded.reduce(
            (sum, asset) => sum + (Number(asset.fileSizeBytes) || 0),
            0
          ),
        });
      } catch {
        /* offline — keep persistence for a later attempt */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveDraft = async (data: Partial<SubmitClipRequestValues>) => {
    setIsDraftSaving(true);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, isDraft: true }),
      });
      if (!res.ok) throw new Error("Draft save failed.");
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 3000);
    } catch {
      // Silent fail for draft save
    } finally {
      setIsDraftSaving(false);
    }
  };
  // Create the draft ONCE and reuse its id across retries. Previously every
  // submit attempt POSTed /api/requests afresh, minting a new request and
  // orphaning any files already uploaded under the previous id.
  const ensureDraft = async (data: SubmitClipRequestValues): Promise<string> => {
    if (draftIdRef.current) {
      // Resuming an existing draft: persist any edits the user made to the brief
      // before uploading (best-effort — a failure here shouldn't block the upload).
      if (existingRequestId) {
        try {
          await fetch(`/api/requests/${draftIdRef.current}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
        } catch {
          /* non-fatal */
        }
      }
      return draftIdRef.current;
    }
    const res = await netFetch("สร้างคำขอ", "/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, creditConfirmed: true, rightsConfirmed: true, aiProcessingConfirmed: true }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "ไม่สามารถสร้างคำขอได้");
    }
    const { requestId } = await res.json();
    draftIdRef.current = requestId;
    lsSet(DRAFT_ID_KEY, requestId);
    return requestId;
  };

  // Small file → one presigned PUT.
  const uploadSingle = async (requestId: string, item: PendingFile): Promise<string> => {
    const metaRes = await netFetch("ขอที่อยู่อัปโหลด", `/api/uploads/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: item.file.name,
        fileSizeBytes: item.file.size,
        mimeType: item.file.type,
      }),
    });
    if (!metaRes.ok) {
      // 422 here = the server refused the file itself (size caps, count cap,
      // type). Not retryable — see UploadRejectedError.
      await throwForUploadResponse(metaRes, `error ${metaRes.status}`);
    }
    const { assetId, presignedUrl } = await metaRes.json();
    const ctx = `${item.file.name} single-PUT (${(item.file.size / 1e6).toFixed(1)}MB)`;
    // Read the bytes into memory immediately before the PUT, detached from the
    // on-disk file. This path only ever handles files under
    // MULTIPART_THRESHOLD_BYTES (5 MB), so the whole file is safe to hold.
    const body = await materializeFile(item.file);
    console.info(`[upload] ${ctx} → ${hostOf(presignedUrl)} — ${connInfo()}`);
    await withNetworkRetry(
      () =>
        putPart(
          presignedUrl,
          body,
          (loaded, total) => setItemProgress(item.id, { pct: Math.min(99, Math.round((loaded / total) * 100)) }),
          item.file.type,
          ctx
        ),
      3,
      ctx
    );
    return assetId;
  };

  // Large file → chunked, RESUMABLE multipart. Each part is its own ≤partSize PUT
  // (keeps every request under the intermediary's ~8–15 MB body cap). On a repeat
  // attempt we ask Spaces which parts already landed (`resume`) and re-upload only
  // the missing ones — a mostly-done video survives a dropped connection instead
  // of restarting. The session ids are persisted so this also works after the app
  // is backgrounded/relaunched on iOS/Android, once the file is re-selected.
  const uploadMultipart = async (requestId: string, item: PendingFile): Promise<string> => {
    const jsonHeaders = { "Content-Type": "application/json" };
    const mp = (label: string, payload: Record<string, unknown>) =>
      netFetch(label, `/api/uploads/${requestId}/multipart`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(payload),
      });

    const sig = fileSig(item.file);

    // 1) Resume a persisted session if present; otherwise initiate a fresh one.
    let session = getMpuSession(requestId, sig);
    let uploadedParts: { PartNumber: number; ETag: string }[] = [];

    // The bytes and multipart assembly already finished; only application-level
    // confirmation failed or its response was lost. Return the original asset
    // id so finalizeSubmission retries /confirm without uploading any byte.
    if (session?.completed) {
      console.info(`[upload] ${item.file.name} already assembled — retrying confirmation only`);
      return session.assetId;
    }

    if (session) {
      const res = await mp("ตรวจสอบการอัปโหลดเดิม", {
        action: "resume",
        key: session.key,
        uploadId: session.uploadId,
      });
      if (res.ok) {
        const j = (await res.json()) as {
          uploadedParts?: { PartNumber: number; ETag: string }[];
          expired?: boolean;
        };
        if (j.expired) {
          clearMpuSession(requestId, sig);
          session = null;
        } else {
          uploadedParts = j.uploadedParts ?? [];
        }
      } else {
        clearMpuSession(requestId, sig);
        session = null;
      }
    }

    if (!session) {
      const initRes = await mp("เริ่มอัปโหลด", {
        action: "initiate",
        fileName: item.file.name,
        fileSizeBytes: item.file.size,
        mimeType: item.file.type,
      });
      if (!initRes.ok) {
        // Same as the single-PUT path: a 422 is a refusal of this file, not a
        // transport problem, and must not be retried.
        await throwForUploadResponse(initRes, `error ${initRes.status}`);
      }
      const init = (await initRes.json()) as {
        assetId: string;
        key: string;
        uploadId: string;
        partSize?: number;
      };
      session = {
        assetId: init.assetId,
        key: init.key,
        uploadId: init.uploadId,
        // Record the size the SERVER says to slice at, so a later resume
        // reproduces these exact boundaries even if the constant changes.
        partSize:
          typeof init.partSize === "number" && init.partSize > 0
            ? init.partSize
            : MULTIPART_PART_SIZE,
      };
      saveMpuSession(requestId, sig, session);
      uploadedParts = [];
    }

    const { key, uploadId, assetId } = session;
    const partSize = session.partSize ?? MULTIPART_PART_SIZE;
    const partCount = Math.max(1, Math.ceil(item.file.size / partSize));
    // NOTE: the file's bytes are NOT read here. Each part is read from disk into
    // memory immediately before its own PUT (see materializeRange in the part
    // loop below), so a 300 MB clip costs ~10 MB of memory instead of 600 MB.
    console.info(
      `[upload] ${item.file.name} multipart start: ${(item.file.size / 1e6).toFixed(1)}MB in ${partCount} parts, ` +
        `${uploadedParts.length} already landed — ${connInfo()}`
    );

    // 2) Upload the still-missing parts, self-healing across transient outages.
    //    A marginal mobile connection routinely succeeds on one file and then
    //    drops part-way through the next (observed: 1 file passes, the next few
    //    fail). Two layers of recovery keep a whole file from dying on a single
    //    dropped part:
    //      • withNetworkRetry re-PUTs an individual part on a blip.
    //      • the round loop below, if a part still fails, backs off, asks the
    //        server which parts ACTUALLY landed (resume/ListParts), and re-sends
    //        only the genuinely-missing ones — up to MAX_ROUNDS times.
    //    Parts are idempotent, so re-sending never duplicates data, and ListParts
    //    is the source of truth for ETags so we never trust a part we didn't
    //    confirm. Only after all rounds are exhausted does the file surface as
    //    failed (and the manual "retry" button can still resume it later).
    const partBytes = (n: number) => Math.min(partSize, item.file.size - (n - 1) * partSize);
    const missingParts = (landed: { PartNumber: number }[]): number[] => {
      const have = new Set(landed.map((p) => p.PartNumber));
      const out: number[] = [];
      for (let n = 1; n <= partCount; n++) if (!have.has(n)) out.push(n);
      return out;
    };
    const bytesFor = (landed: { PartNumber: number }[]): number =>
      landed.reduce((sum, p) => sum + partBytes(p.PartNumber), 0);

    let etags: { PartNumber: number; ETag: string }[] = [...uploadedParts];
    let missing = missingParts(etags);
    let uploadedBytes = bytesFor(etags);
    setItemProgress(item.id, { pct: Math.min(99, Math.round((uploadedBytes / item.file.size) * 100)) });

    // Three rounds, not two: a phone coming back from a locked screen often
    // needs one whole round just for the radio to settle. Each round is cheap —
    // it re-asks ListParts and re-sends only genuinely-missing parts — so the
    // extra attempt costs a backoff, not a re-upload.
    const MAX_ROUNDS = 3;
    for (let round = 1; missing.length > 0; round++) {
      console.info(
        `[upload] ${item.file.name} round ${round}/${MAX_ROUNDS}: ${missing.length} part(s) still missing — ${connInfo()}`
      );
      try {
        /** Mint presigned URLs for a handful of part numbers, on demand. */
        const signParts = async (
          partNumbers: number[]
        ): Promise<{ partNumber: number; url: string }[]> => {
          const signRes = await mp("ขอที่อยู่อัปโหลด", {
            action: "sign",
            key,
            uploadId,
            partNumbers,
          });
          if (!signRes.ok) {
            const body = await signRes.json().catch(() => ({}));
            throw new Error(body.error ?? `error ${signRes.status}`);
          }
          const { parts } = (await signRes.json()) as {
            parts: { partNumber: number; url: string }[];
          };
          return parts;
        };

        // Sign JUST-IN-TIME, a few parts at a time, instead of minting a URL for
        // every remaining part up front.
        //
        // WHY: presigned URLs carry a fixed TTL (PRESIGNED_URL_TTL, 15 minutes)
        // that starts ticking the moment they are signed, and parts are PUT
        // sequentially. Signing all of a large file's parts at once therefore
        // races the upload against the clock: a 109 MB clip is 22 parts, and on a
        // typical mobile uplink the last parts can easily be reached more than 15
        // minutes after they were signed — at which point Spaces answers 403 for
        // a URL that was valid when the round began. The bigger the file, the
        // more reliably it happens, so the same large clips fail every attempt
        // while smaller ones always succeed. Signing a batch immediately before
        // sending it means every URL is used seconds after it is minted, and the
        // TTL stops being a function of file size.
        const SIGN_BATCH = 4;
        for (let offset = 0; offset < missing.length; offset += SIGN_BATCH) {
          const batch = missing.slice(offset, offset + SIGN_BATCH);
          const partUrls = await signParts(batch);

          for (const { partNumber, url } of partUrls) {
            const start = (partNumber - 1) * partSize;
            // Read THIS part only, right before sending it: bounded memory, and
            // the bytes are detached from disk moments before the PUT so the
            // send-time ERR_UPLOAD_FILE_CHANGED re-validation has nothing to check.
            const chunk = await materializeRange(
              item.file,
              start,
              Math.min(start + partSize, item.file.size)
            );
            const partCtx = `${item.file.name} part ${partNumber}/${partCount} r${round}`;
            const onProgress = (loaded: number) =>
              setItemProgress(item.id, {
                pct: Math.min(99, Math.round(((uploadedBytes + loaded) / item.file.size) * 100)),
              });

            let etag: string;
            try {
              etag = await withNetworkRetry(
                () => putPart(url, chunk, onProgress, undefined, partCtx),
                3,
                partCtx
              );
            } catch (partErr) {
              // A 403 on a part URL means the signature is expired or invalid —
              // NOT a transport failure, so withNetworkRetry (which only retries
              // network-shaped errors) correctly refused to retry it and it would
              // otherwise abort the whole file. But it is trivially recoverable:
              // mint a fresh URL for this one part and send it again. Without
              // this, one expired URL discards every part still to come.
              const partMsg = partErr instanceof Error ? partErr.message : String(partErr);
              if (!/HTTP 403/.test(partMsg)) throw partErr;
              console.warn(
                `[upload] ${partCtx} presign rejected (403) — re-signing this part and retrying`
              );
              const [fresh] = await signParts([partNumber]);
              if (!fresh?.url) throw partErr;
              etag = await withNetworkRetry(
                () => putPart(fresh.url, chunk, onProgress, undefined, `${partCtx} resigned`),
                2,
                partCtx
              );
            }

            if (!etag) throw new Error(`ไม่ได้รับ ETag ของส่วนที่ ${partNumber}`);
            etags.push({ PartNumber: partNumber, ETag: etag });
            uploadedBytes += chunk.size;
          }
        }
        missing = []; // every part uploaded — exit the round loop
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A dead file handle is not a transport failure. There is nothing to
        // reconcile against and nothing to re-send from, so spending the two
        // remaining rounds (and two ListParts round-trips) on it only delays
        // telling the user the one thing that helps: re-pick the file.
        if (err instanceof FileUnreadableError) {
          console.error(
            `[upload] ${item.file.name} ABORTED at ${etags.length}/${partCount} parts — file handle died; rounds skipped`
          );
          throw err;
        }
        if (round >= MAX_ROUNDS) {
          console.error(
            `[upload] ${item.file.name} FAILED after ${MAX_ROUNDS} rounds (${etags.length}/${partCount} parts landed): ${msg} — ${connInfo()}`
          );
          throw err;
        }
        console.warn(
          `[upload] ${item.file.name} round ${round} failed (${msg}); reconciling landed parts then retrying — ${connInfo()}`
        );
        // Back off, then reconcile against what actually landed so the next round
        // re-sends only the genuinely-missing parts.
        await new Promise((r) => setTimeout(r, 1500 * round));
        let landed: { PartNumber: number; ETag: string }[] | null = null;
        try {
          const res = await mp("ตรวจสอบการอัปโหลดเดิม", { action: "resume", key, uploadId });
          if (res.ok) {
            const j = (await res.json()) as {
              uploadedParts?: { PartNumber: number; ETag: string }[];
              expired?: boolean;
            };
            if (j.expired) throw err; // multipart session gone — give up this file
            landed = j.uploadedParts ?? [];
          }
        } catch (reconcileErr) {
          if (reconcileErr === err) throw err; // propagate the expired-session case
          /* transient reconcile failure — ignore and retry the same set next round */
        }
        if (landed) {
          etags = [...landed];
          missing = missingParts(landed);
          uploadedBytes = bytesFor(landed);
          setItemProgress(item.id, {
            pct: Math.min(99, Math.round((uploadedBytes / item.file.size) * 100)),
          });
        }
      }
    }

    // 4) Assemble. NOTE: we deliberately do NOT abort on failure above — keeping
    // the parts is what lets the next attempt resume. The session also remains
    // after assembly until /confirm succeeds; otherwise a confirmation timeout
    // at 100% makes the next attempt upload the entire file again.
    etags.sort((a, b) => a.PartNumber - b.PartNumber);
    const completeRes = await mp("รวมไฟล์", { action: "complete", key, uploadId, parts: etags });
    if (!completeRes.ok) {
      const body = await completeRes.json().catch(() => ({}));
      console.error(
        `[upload] ${item.file.name} complete/assemble failed: HTTP ${completeRes.status} ${body.error ?? ""}`
      );
      throw new Error(body.error ?? `error ${completeRes.status}`);
    }
    console.info(`[upload] ${item.file.name} multipart complete: ${etags.length} parts assembled ✓`);
    saveMpuSession(requestId, sig, { ...session, completed: true });
    return assetId;
  };

  // Upload every not-yet-stored file, then submit. Reused by both the first
  // attempt and the retry button — it reconciles against what already landed on
  // the server so nothing is uploaded twice.
  const finalizeSubmission = async (requestId: string): Promise<void> => {
    const confirmations = getValues();
    if (!confirmations.aiProcessingConfirmed) {
      throw new Error("กรุณาอนุญาตการประมวลผลด้วย AI ก่อนส่งคำขอ");
    }

    // Let any still-running selection probe finish before uploading. A probe
    // that lands mid-upload would otherwise mark a clip over-length after its
    // bytes were already on the wire, and the diagnostic timeline would
    // interleave decode work with upload work, making it far harder to read.
    if (prepTasksRef.current.size > 0) {
      await Promise.allSettled([...prepTasksRef.current.values()]);
    }
    // `rejected` files are excluded alongside `error` ones: the server has
    // already refused these exact bytes on a business rule, so a retry would
    // re-upload the whole clip only to be refused again. Skipping them is what
    // lets the retry button finish the files that CAN succeed.
    const uploadItems = pendingFiles.filter((f) => !f.error && !f.rejected);
    diagLog("SUBMIT", `${uploadItems.length} file(s) queued for upload`);

    // Reconcile with the server: skip any file whose name+size is already an
    // uploaded asset on this request (resume after reload/return).
    const confirmedOnServer = new Set<string>();
    try {
      const listRes = await fetch(`/api/uploads/${requestId}`);
      if (!listRes.ok) {
        throw new Error(`upload reconciliation HTTP ${listRes.status}`);
      }
      const { assets } = (await listRes.json()) as {
        assets: { fileName: string; fileSizeBytes: number; uploadStatus: string }[];
      };
      const stored = assets.filter((a) => a.uploadStatus === "uploaded");
      // Match stored assets to picker rows as a MULTISET. A Set incorrectly
      // treated two same-named, same-sized files as one file: after the first
      // succeeded, a retry skipped both. Consuming one stored occurrence per
      // picker row preserves duplicates while still skipping exactly what is
      // already on the server.
      const storedCounts = new Map<string, number>();
      for (const asset of stored) {
        const sig = nameSizeSig(asset.fileName, asset.fileSizeBytes);
        storedCounts.set(sig, (storedCounts.get(sig) ?? 0) + 1);
      }
      for (const item of uploadItems) {
        const sig = nameSizeSig(item.file.name, item.file.size);
        const available = storedCounts.get(sig) ?? 0;
        if (available <= 0) continue;
        confirmedOnServer.add(item.id);
        storedCounts.set(sig, available - 1);
      }
      setConfirmedItemIds(new Set(confirmedOnServer));
      // Keep the size budget in step with what the server actually holds, so
      // the next addFiles() measures against the same number the presign route
      // will use.
      serverUploadedBytesRef.current = stored.reduce(
        (sum, a) => sum + (Number(a.fileSizeBytes) || 0),
        0
      );
      serverUploadedCountRef.current = stored.length;
    } catch (error) {
      // Never guess after a partial upload. Re-uploading while reconciliation is
      // unavailable can duplicate confirmed files and makes the client/server
      // counters diverge again. Leave the draft intact and let Retry perform a
      // fresh authoritative check.
      console.error("[submit] could not reconcile uploaded files:", error);
      throw new Error(
        "ตรวจสอบไฟล์ที่อัปโหลดไว้แล้วไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วกดลองอัปโหลดต่อ"
      );
    }

    // Pre-flight the per-request total cap for the files about to go up, in the
    // order they will go up. The server enforces this one file at a time and
    // only says "no" when that file's turn arrives — which is why the failures
    // appeared scattered through the batch. Deciding it up front means the user
    // is told which clips do not fit BEFORE anything is uploaded.
    const overBudget = new Map<string, string>();
    {
      let budget = serverUploadedBytesRef.current;
      // Both caps, in the order the server will apply them. The COUNT cap is
      // what produced "Maximum 10 files per request." on a resumed draft: the
      // server counts its own stored files, this list did not.
      let count = serverUploadedCountRef.current;
      for (const item of uploadItems) {
        if (confirmedOnServer.has(item.id)) {
          continue; // already stored, and already counted in the seeds above
        }
        if (count >= MAX_UPLOAD_COUNT) {
          overBudget.set(
            item.id,
            `คำขอนี้รับได้สูงสุด ${MAX_UPLOAD_COUNT} ไฟล์ และมีครบแล้ว — กรุณาลบไฟล์นี้ออก หรือส่งเป็นคำขอใหม่`
          );
          continue;
        }
        const capError = validateTotalUploadSize(budget, item.file.size);
        if (capError) {
          overBudget.set(item.id, capError);
          continue; // does not fit — leave the budget for the files that might
        }
        budget += item.file.size;
        count += 1;
      }
    }
    if (overBudget.size > 0) {
      const totalMb = Math.round(
        (serverUploadedBytesRef.current +
          uploadItems
            .filter((i) => !confirmedOnServer.has(i.id))
            .reduce((sum, i) => sum + i.file.size, 0)) /
          (1024 * 1024)
      );
      console.warn(
        `[submit] ${overBudget.size} file(s) exceed the per-request total cap ` +
          `(${totalMb} MB selected vs ${MAX_UPLOAD_SIZE_MB} MB allowed)`
      );
    }

    // Seed progress: already-uploaded files show done; the rest show 0%.
    setUploadProgress(
      Object.fromEntries(
        uploadItems.map((i) => [
          i.id,
          confirmedOnServer.has(i.id)
            ? { pct: 100, stage: "done" as UploadStage }
            : { pct: 0, stage: "pending" as UploadStage },
        ])
      )
    );

    const failedUploads: string[] = [];
    const rejectedUploads: string[] = [];
    for (const item of uploadItems) {
      if (confirmedOnServer.has(item.id)) continue; // already stored

      // Known ahead of time not to fit — don't spend the user's data uploading
      // a clip the presign route is certain to refuse.
      const capError = overBudget.get(item.id);
      if (capError) {
        setItemProgress(item.id, { stage: "rejected" });
        setPendingFiles((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, rejected: capError } : f))
        );
        rejectedUploads.push(`${item.file.name} — ${capError}`);
        continue;
      }

      console.log(
        `[submit] uploading ${item.file.name} (${(item.file.size / 1e6).toFixed(1)} MB, ${
          item.file.size > MULTIPART_THRESHOLD_BYTES ? "multipart" : "single"
        })`
      );
      setItemProgress(item.id, { stage: "uploading" });
      diagLog(
        "UPLOAD-START",
        `${item.file.name} ${(item.file.size / 1e6).toFixed(1)}MB ` +
          `${item.file.size > MULTIPART_THRESHOLD_BYTES ? "multipart" : "single"}`
      );

      let assetId: string;
      try {
        assetId =
          item.file.size > MULTIPART_THRESHOLD_BYTES
            ? await uploadMultipart(requestId, item)
            : await uploadSingle(requestId, item);
      } catch (uploadErr) {
        const detail = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);

        // The server refused the file before a single byte moved (size caps,
        // count cap, type). Retrying re-asks the identical question.
        if (uploadErr instanceof UploadRejectedError) {
          console.warn(`[submit] ${item.file.name} rejected by the server: ${detail}`);
          setItemProgress(item.id, { stage: "rejected" });
          setPendingFiles((prev) =>
            prev.map((f) => (f.id === item.id ? { ...f, rejected: detail } : f))
          );
          rejectedUploads.push(`${item.file.name} — ${detail}`);
          continue;
        }

        // The file's bytes stopped being reachable partway through. Retrying
        // re-reads the same dead reference and fails identically, so this must
        // NOT arm the retry button — that loop is what made a batch of clips
        // look permanently un-uploadable.
        //
        // Recorded as `rejected` so every existing filter (retry, submit gate,
        // size budget) already skips it, exactly as it does for a server
        // refusal. The difference is only in the message, which tells the user
        // the one thing that works: remove the file and pick it again. The
        // multipart session survives on `fileSig`, so that resumes rather than
        // restarts.
        if (uploadErr instanceof FileUnreadableError) {
          diagLog("UPLOAD-DEAD-HANDLE", item.file.name);
          console.error(`[submit] ${item.file.name} file handle died mid-upload: ${detail}`);
          setItemProgress(item.id, { stage: "rejected" });
          setPendingFiles((prev) =>
            prev.map((f) => (f.id === item.id ? { ...f, rejected: detail } : f))
          );
          rejectedUploads.push(`${item.file.name} — ${detail}`);
          continue;
        }

        console.error(
          `[submit] upload ${item.file.name} failed: ${detail} — ${connInfo()} — scroll up for the per-part [upload] logs that name the root cause`,
          uploadErr
        );
        diagLog("UPLOAD-FAIL", `${item.file.name} ${detail}`);
        setItemProgress(item.id, { stage: "error" });
        failedUploads.push(`${item.file.name} (อัปโหลดไม่สำเร็จ — ${detail})`);
        continue;
      }

      // Reuse the poster frame already captured for the preview grid (a data: URL
      // for videos) so the clip's thumbnail is stored at upload — no server ffmpeg.
      const poster = previews[item.id];
      const posterDataUrl =
        typeof poster === "string" && poster.startsWith("data:image/") ? poster : undefined;

      let confirmRes: Response;
      try {
        confirmRes = await netFetch("ยืนยันไฟล์", `/api/uploads/${requestId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId, posterDataUrl }),
        });
      } catch (confirmError) {
        // Previously this escaped the per-file loop. The whole request then
        // showed a generic failure after the final progress bar reached 100%,
        // with no failed filename — exactly like all new files had disappeared.
        // Keep the assembled multipart session so Retry repeats confirmation
        // only, and identify the affected file in the UI.
        const reason =
          confirmError instanceof Error ? confirmError.message : String(confirmError);
        console.error(`[submit] confirmation ${item.file.name} failed:`, confirmError);
        diagLog("CONFIRM-FAIL", `${item.file.name} ${reason}`);
        setItemProgress(item.id, { stage: "error", pct: 100 });
        failedUploads.push(`${item.file.name} (อัปโหลดครบแล้ว แต่ยืนยันไฟล์ไม่สำเร็จ — ${reason})`);
        continue;
      }
      if (!confirmRes.ok) {
        const body = await confirmRes.json().catch(() => ({}));
        const reason = typeof body?.error === "string" ? body.error : "ยืนยันไฟล์ไม่สำเร็จ";

        // 422 is a BUSINESS rejection (currently: the clip is longer than the
        // cap), not a transport failure. The bytes arrived intact; the server
        // looked at them and said no. Re-sending the same file produces the same
        // answer, so retrying is pure waste — and that is exactly what used to
        // happen: the file was marked "error" alongside genuine network failures,
        // the retry button re-uploaded all of it, and it was rejected again, for
        // ever. Mark it rejected so retry SKIPS it and the reason is shown.
        if (confirmRes.status === 422) {
          clearMpuSession(requestId, fileSig(item.file));
          console.warn(`[submit] ${item.file.name} rejected by the server: ${reason}`);
          setItemProgress(item.id, { stage: "rejected" });
          setPendingFiles((prev) =>
            prev.map((f) => (f.id === item.id ? { ...f, rejected: reason } : f))
          );
          rejectedUploads.push(`${item.file.name} — ${reason}`);
          continue;
        }

        setItemProgress(item.id, { stage: "error" });
        failedUploads.push(`${item.file.name} (${reason})`);
        continue;
      }
      clearMpuSession(requestId, fileSig(item.file));
      setItemProgress(item.id, { stage: "done", pct: 100 });
      confirmedOnServer.add(item.id);
      setConfirmedItemIds((prev) => new Set(prev).add(item.id));
      // Keep the authoritative server seed current during this same attempt.
      // If a later file fails, the form reappears immediately; without these
      // increments its totals are stale until another retry fetch completes.
      serverUploadedBytesRef.current += item.file.size;
      serverUploadedCountRef.current += 1;
      diagLog("UPLOAD-OK", item.file.name);
    }

    // Two very different outcomes, which used to be merged into one unactionable
    // "ผิดพลาด" list:
    //
    //   failedUploads   — transport failures. Retrying genuinely helps, and the
    //                     multipart resume means it continues rather than restarts.
    //   rejectedUploads — the server refused these bytes on a rule. Retrying can
    //                     never help; the user has to remove or trim the clip.
    //
    // A rejected file alone must NOT arm the retry button, or the user is invited
    // to repeat an upload that is guaranteed to fail — which is precisely the loop
    // that made these four clips look un-uploadable.
    if (failedUploads.length > 0 || rejectedUploads.length > 0) {
      setPhase("form");
      setCanRetry(failedUploads.length > 0);

      const parts: string[] = [];
      if (rejectedUploads.length > 0) {
        parts.push(
          `ไฟล์เหล่านี้ระบบไม่รับ กรุณาลบออกหรือตัดให้สั้นลงแล้วเลือกใหม่ ` +
            `(กดอัปโหลดซ้ำก็จะไม่สำเร็จ): ${rejectedUploads.join(" · ")}`
        );
      }
      if (failedUploads.length > 0) {
        parts.push(
          `ไฟล์บางรายการยังอัปโหลดไม่สำเร็จ กด "ลองอัปโหลดต่อ" เพื่ออัปโหลดเฉพาะไฟล์ที่เหลือ ` +
            `(ระบบจะอัปโหลดต่อจากจุดที่ค้างไว้ ไม่เริ่มใหม่): ${failedUploads.join(" · ")}`
        );
      }
      setSubmitError(parts.join("\n\n"));
      return;
    }

    const submitRes = await netFetch("ส่งคำขอ", `/api/requests/${requestId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creditConfirmed: confirmations.creditConfirmed,
        rightsConfirmed: confirmations.rightsConfirmed,
        aiProcessingConfirmed: confirmations.aiProcessingConfirmed,
      }),
    });
    if (!submitRes.ok) {
      const body = await submitRes.json().catch(() => ({}));
      throw new Error(body.error ?? "ไม่สามารถส่งคำขอได้");
    }

    clearDraftPersistence(requestId);
    draftIdRef.current = null;
    router.push(requestDetailPath(requestId));
  };

  const onSubmit = async (data: SubmitClipRequestValues) => {
    setSubmitError(null);
    setCanRetry(false);

    // The free trial request submits without credits — skip the balance gate.
    if (!trialAvailable && creditBalance < COST) {
      setSubmitError(
        `คุณต้องการ ${COST} เครดิตสำหรับค่าบริการครั้งเดียว แต่ปัจจุบันมีเพียง ${creditBalance} เครดิต`
      );
      return;
    }

    if (pendingFiles.some((f) => f.error)) {
      setSubmitError("กรุณาลบไฟล์ที่มีข้อผิดพลาดออกก่อนส่งคำขอ");
      return;
    }

    // In-flight guard: a second submit must not fire while one is running, or two
    // near-simultaneous submits could each pass the server's Draft-status check
    // and double-charge. The server charge is also idempotent, but this stops the
    // race at the source.
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setPhase("submitting");
      const requestId = await ensureDraft(data);
      await finalizeSubmission(requestId);
    } catch (err) {
      setPhase("form");
      setCanRetry(Boolean(draftIdRef.current));
      setSubmitError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
    } finally {
      submittingRef.current = false;
    }
  };

  // Retry after a partial/failed upload — reuses the existing draft, re-uploads
  // only what's missing (resuming interrupted multipart parts), then submits.
  const handleRetryUploads = async () => {
    const requestId = draftIdRef.current;
    if (!requestId) {
      setSubmitError("ไม่พบคำขอที่ค้างอยู่ กรุณาส่งคำขอใหม่");
      return;
    }
    if (pendingFiles.some((f) => f.error)) {
      setSubmitError("กรุณาลบไฟล์ที่มีข้อผิดพลาดออกก่อน");
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitError(null);
    setCanRetry(false);
    try {
      setPhase("submitting");
      await finalizeSubmission(requestId);
    } catch (err) {
      setPhase("form");
      setCanRetry(true);
      setSubmitError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
    } finally {
      submittingRef.current = false;
    }
  };

  /**
   * Delete a draft server-side, with its uploaded files.
   *
   * DELETE /api/requests/[id] → cancelRequest() → deleteAssetsByRequestId(),
   * which removes every object from Spaces and every uploaded_assets row before
   * dropping the request. Without this call the draft and its files simply stay
   * there: invisible on this page, still listed on the dashboard, still holding
   * storage, and still offered back by the resume banner on the next visit.
   *
   * Returns false if the server refused, so the caller can keep the local
   * pointer rather than orphaning a request it failed to delete.
   */
  const deleteDraftOnServer = async (draftId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/requests/${draftId}`, { method: "DELETE" });
      // 404 = already gone, which is the outcome we wanted.
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  };

  /** Adopt the recovered draft: continue filling it in and resume its uploads. */
  const handleResumeDraft = () => {
    if (!recoverableDraft) return;
    draftIdRef.current = recoverableDraft.draftId;
    lsSet(DRAFT_ID_KEY, recoverableDraft.draftId);
    serverUploadedBytesRef.current = recoverableDraft.uploadedBytes;
    serverUploadedCountRef.current = recoverableDraft.uploadedNames.length;
    setResumeInfo({ uploadedNames: recoverableDraft.uploadedNames });
    setRecoverableDraft(null);
    setSubmitError(null);
  };

  /**
   * Discard an unfinished draft and start fresh.
   *
   * This used to clear localStorage only, which left the draft and every file
   * already uploaded to it alive on the server — the user pressed "start a new
   * request" and the old one quietly persisted, files and all. The delete now
   * goes to the server first; local state is only cleared once it succeeds.
   */
  const handleDiscardResume = async () => {
    const draftId = recoverableDraft?.draftId ?? draftIdRef.current;
    if (!draftId) return;

    if (
      !confirm(
        "ล้างข้อมูลที่ค้างไว้และเริ่มคำขอใหม่?\n\n" +
          "ไฟล์ที่อัปโหลดไว้กับคำขอเดิมจะถูกลบถาวร ไม่สามารถย้อนกลับได้"
      )
    ) {
      return;
    }

    setDiscardingDraft(true);
    try {
      const deleted = await deleteDraftOnServer(draftId);
      if (!deleted) {
        setSubmitError(
          "ลบคำขอเดิมไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือลบคำขอนั้นจากหน้ารายการคำขอ"
        );
        return;
      }
      clearDraftPersistence(draftId);
      draftIdRef.current = null;
      setRecoverableDraft(null);
      setResumeInfo(null);
      setCanRetry(false);
      setUploadProgress({});
      setConfirmedItemIds(new Set());
      serverUploadedBytesRef.current = 0;
      serverUploadedCountRef.current = 0;
      setSubmitError(null);
    } finally {
      setDiscardingDraft(false);
    }
  };

  /**
   * "ยกเลิก" — leave the form.
   *
   * This was a bare <Link> to the requests list. Leaving that way abandoned
   * everything in place: the Draft request stayed on the server with every file
   * already uploaded to it, and the localStorage pointer stayed set — so the
   * next visit to "new request" silently re-adopted the abandoned draft and
   * showed its files, including the half-finished ones, as if they belonged to
   * the new request. Cancelling now means cancelling.
   */
  const handleCancel = async () => {
    // Only the draft THIS form owns. A recovered-but-not-adopted draft is a
    // separate request the user declined to continue — cancelling out of a new
    // request must not delete it behind their back; it stays on the dashboard
    // with its own delete button.
    const draftId = draftIdRef.current;

    // Nothing was ever created server-side — just leave.
    if (!draftId) {
      router.push(ROUTES.REQUESTS);
      return;
    }

    if (
      !confirm(
        "ยกเลิกคำขอนี้?\n\n" +
          "ไฟล์ที่อัปโหลดไปแล้วจะถูกลบถาวร ไม่สามารถย้อนกลับได้"
      )
    ) {
      return;
    }

    setDiscardingDraft(true);
    try {
      const deleted = await deleteDraftOnServer(draftId);
      if (!deleted) {
        setSubmitError(
          "ยกเลิกคำขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือลบคำขอนั้นจากหน้ารายการคำขอ"
        );
        return;
      }
      // Only after the server confirms: drop the local pointer, so a failed
      // delete never leaves an unreachable draft behind.
      clearDraftPersistence(draftId);
      draftIdRef.current = null;
      router.push(ROUTES.REQUESTS);
    } finally {
      setDiscardingDraft(false);
    }
  };

  // If client-side validation fails, react-hook-form doesn't scroll to the
  // offending field by itself — when the user is scrolled down to the
  // "ก่อนส่งคำขอ" section, clicking "ส่งคำขอ" can otherwise look like nothing
  // happened. Surface a visible message and jump to the first invalid field.
  const onInvalid = (formErrors: typeof errors) => {
    const fieldMessages = Object.entries(formErrors)
      .map(([field, err]) => `${field}: ${(err as { message?: string })?.message ?? "ไม่ถูกต้อง"}`)
      .join(" / ");
    console.error("[NewRequestForm] validation errors:", formErrors);
    setSubmitError(
      `กรุณาตรวจสอบข้อมูลในฟอร์ม: ${fieldMessages || "มีบางช่องที่ยังไม่ถูกต้องหรือยังไม่ได้กรอก"}`
    );
    const firstErrorField = Object.keys(formErrors)[0] as keyof SubmitClipRequestValues | undefined;
    if (firstErrorField) {
      setFocus(firstErrorField);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // The free trial request submits without credits — never block it on balance.
  const insufficientCredits = !trialAvailable && creditBalance < COST;

  if (phase === "submitting") {
    const progressEntries = pendingFiles.filter((f) => uploadProgress[f.id]);
    const uploadsInProgress =
      progressEntries.length > 0 &&
      progressEntries.some((f) => {
        const stage = uploadProgress[f.id]?.stage;
        return stage === "pending" || stage === "uploading";
      });

    // While files are still uploading, show a per-file progress list. Once every
    // file has uploaded (or there were none), fall through to the AI spinner.
    if (uploadsInProgress) {
      const doneCount = progressEntries.filter((f) => uploadProgress[f.id]?.stage === "done").length;
      return (
        <div className="flex flex-col gap-5 py-10">
          <div className="text-center">
            <p className="text-lg font-semibold text-slate-800">กำลังอัปโหลดไฟล์ของคุณ</p>
            <p className="mt-1 text-sm text-slate-500">
              อัปโหลดแล้ว {doneCount}/{progressEntries.length} ไฟล์ · กรุณาอย่าปิดหน้านี้
            </p>
          </div>
          <ul className="flex flex-col gap-3">
            {progressEntries.map((f) => {
              const p = uploadProgress[f.id];
              const isError = p.stage === "error";
              // A server rejection is not a failed transfer. Showing it as the
              // same red "ผิดพลาด" as a dropped connection is what made these
              // clips look like they just needed another try.
              const isRejected = p.stage === "rejected";
              const isDone = p.stage === "done";
              const barColour = isRejected
                ? "bg-amber-500"
                : isError
                  ? "bg-red-500"
                  : isDone
                    ? "bg-green-500"
                    : "bg-blue-600";
              return (
                <li key={f.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-slate-700">{f.file.name}</span>
                    <span
                      className={`tabular-nums ${
                        isRejected
                          ? "text-amber-700"
                          : isError
                            ? "text-red-600"
                            : isDone
                              ? "text-green-600"
                              : "text-slate-500"
                      }`}
                    >
                      {isRejected ? "ไม่รับไฟล์นี้" : isError ? "ผิดพลาด" : `${p.pct}%`}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all duration-200 ${barColour}`}
                      style={{ width: `${isError || isRejected ? 100 : p.pct}%` }}
                    />
                  </div>
                  {isRejected && f.rejected && (
                    <p className="text-xs text-amber-700">{f.rejected}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
        <div>
          <p className="text-lg font-semibold text-slate-800">
            AI กำลังวิเคราะห์คำขอของคุณ
          </p>
          <p className="mt-1 text-sm text-slate-500">
            กำลังสร้างแผนฉาก บทพูด และแคปชั่น — อาจใช้เวลา 15–30 วินาที
          </p>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="flex flex-col gap-8">
      {/* Free trial notice */}
      {trialAvailable && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">
            คำขอนี้เป็นคลิปทดลองฟรีของคุณ — สร้างได้เลยโดยไม่ใช้เครดิต
          </p>
          <p className="mt-1 text-sm text-green-700">
            ชำระ {COST} เครดิตภายหลัง เฉพาะเมื่อต้องการดาวน์โหลดวิดีโอแบบไม่มีลายน้ำ
          </p>
        </div>
      )}

      {/* Insufficient credits warning */}
      {insufficientCredits && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm font-medium text-yellow-800">
            คุณต้องการ {COST} เครดิตสำหรับค่าบริการครั้งเดียว ปัจจุบันมีเพียง {creditBalance} เครดิต
          </p>
          <p className="mt-1 text-sm text-yellow-700">
            กรุณาเติมเครดิตด้วย PromptPay ที่หน้าเครดิต
          </p>
        </div>
      )}

      {/* An unfinished draft was found locally but NOT adopted. The user chooses.
          Until they pick "ทำต่อ", this form is a genuinely new request and will
          create its own id on submit — nothing from the old draft comes along. */}
      {recoverableDraft && !resumeInfo && (
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-800">
            พบคำขอที่ยังอัปโหลดไม่เสร็จจากครั้งก่อน
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {recoverableDraft.uploadedNames.length > 0
              ? `คำขอเดิมมีไฟล์ที่อัปโหลดสำเร็จแล้ว ${recoverableDraft.uploadedNames.length} ไฟล์ ` +
                "คุณต้องการทำต่อจากคำขอเดิม หรือเริ่มคำขอใหม่ทั้งหมด?"
              : "คุณต้องการทำต่อจากคำขอเดิม หรือเริ่มคำขอใหม่ทั้งหมด?"}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            หากเริ่มใหม่ คำขอเดิมและไฟล์ทั้งหมดของคำขอนั้นจะถูกลบถาวร
            และคำขอใหม่จะไม่เกี่ยวข้องกับไฟล์เดิม
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleResumeDraft}
              disabled={discardingDraft}
              className="rounded-md bg-slate-800 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
            >
              ทำต่อจากคำขอเดิม
            </button>
            <button
              type="button"
              onClick={() => void handleDiscardResume()}
              disabled={discardingDraft}
              className="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-700 disabled:opacity-60"
            >
              {discardingDraft ? "กำลังลบ..." : "เริ่มคำขอใหม่ (ลบคำขอเดิม)"}
            </button>
          </div>
        </div>
      )}

      {/* Resume notice — an unfinished draft was found on return */}
      {resumeInfo && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">
            พบคำขอที่ยังไม่เสร็จ — ระบบจะอัปโหลดต่อให้
          </p>
          <p className="mt-1 text-sm text-amber-700">
            {resumeInfo.uploadedNames.length > 0
              ? `อัปโหลดสำเร็จแล้ว ${resumeInfo.uploadedNames.length} ไฟล์ ระบบจะข้ามให้อัตโนมัติ ` +
                "กรุณาเลือกเฉพาะไฟล์ที่ยังไม่ได้อัปโหลดอีกครั้ง แล้วกดส่งคำขอ"
              : "เลือกไฟล์เดิมอีกครั้งแล้วกดส่งคำขอ ระบบจะอัปโหลดต่อจากจุดที่ค้างไว้"}
          </p>
          {/* Single-charge reassurance — credits are only ever taken once per
              request, at the final submit; resuming never charges again. */}
          {!trialAvailable && (
            <p className="mt-2 rounded-md bg-white/70 px-2 py-1 text-xs font-medium text-amber-800">
              💳 ค่าบริการ {COST} เครดิตจะถูกหักเพียงครั้งเดียวต่อคำขอ — การดำเนินการต่อจะไม่หักเครดิตซ้ำ
            </p>
          )}
          {/* Only offer "start over" for a locally-recovered draft — when the user
              deliberately opened a specific draft from the dashboard, clearing it
              would just orphan that request. */}
          {!existingRequestId && (
            <button
              type="button"
              onClick={() => void handleDiscardResume()}
              disabled={discardingDraft}
              className="mt-2 text-xs text-amber-700 underline hover:text-amber-900 disabled:opacity-60"
            >
              {discardingDraft
                ? "กำลังลบ..."
                : "เริ่มคำขอใหม่ (ลบคำขอเดิมและไฟล์ทั้งหมด)"}
            </button>
          )}
        </div>
      )}

      {/* Section 1 — เกี่ยวกับคลิปของคุณ */}
      <fieldset className="rounded-xl border border-slate-200 bg-white p-6">
        <legend className="mb-5 text-base font-semibold text-slate-900 px-1">
          {t("request.about")}
        </legend>
        <div className="flex flex-col gap-5">
          <Input
            label={t("request.clipName")}
            placeholder={t("request.clipNamePlaceholder")}
            hint={t("request.clipNameHint")}
            {...register("title")}
            error={errors.title?.message}
          />

          <div>
            <Input
              label={t("request.placeName")}
              placeholder={t("request.placePlaceholder")}
              {...register("placeName")}
              error={errors.placeName?.message}
            />
            <input type="hidden" {...register("latitude", { valueAsNumber: true })} />
            <input type="hidden" {...register("longitude", { valueAsNumber: true })} />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={() => setMapOpen(true)}>
                {t("request.chooseMap")}
              </Button>
              {Number.isFinite(watchedLatitude) && Number.isFinite(watchedLongitude) && (
                <span className="text-sm tabular-nums text-slate-600">
                  📍 {Number(watchedLatitude).toFixed(6)}, {Number(watchedLongitude).toFixed(6)}
                </span>
              )}
            </div>
            {(errors.latitude || errors.longitude) && (
              <p className="mt-1 text-xs text-red-600" role="alert">
                {errors.latitude?.message ?? errors.longitude?.message}
              </p>
            )}
          </div>

          <Textarea
            label={t("request.details")}
            placeholder={t("request.detailsPlaceholder")}
            hint={t("request.detailsHint")}
            rows={4}
            {...register("description")}
            error={errors.description?.message}
          />

          {/* Duration slider */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">
                {t("request.duration")} <span className="text-red-500">*</span>
              </label>
              <span className="rounded-full bg-blue-600 px-3 py-0.5 text-sm font-bold text-white tabular-nums">
                {t("request.seconds", { count: watchedDuration })}
              </span>
            </div>
            <input
              type="range"
              min={PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS}
              max={PIPELINE_STEP_COSTS.MAX_DURATION_SECONDS}
              step={1}
              className="w-full h-2 cursor-pointer appearance-none rounded-lg bg-slate-200 accent-blue-600"
              {...register("durationSeconds", { valueAsNumber: true })}
            />
            <div className="mt-1 flex justify-between text-xs text-slate-400">
              <span>{t("request.seconds", { count: PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS })}</span>
              <span>{t("request.seconds", { count: PIPELINE_STEP_COSTS.MAX_DURATION_SECONDS })}</span>
            </div>
            {errors.durationSeconds && (
              <p className="mt-1 text-xs text-red-600" role="alert">
                {errors.durationSeconds.message}
              </p>
            )}
          </div>
        </div>
      </fieldset>

      {/* Section 3 — ไฟล์ต้นฉบับ */}
      <fieldset className="rounded-xl border border-slate-200 bg-white p-6">
        <legend className="mb-2 text-base font-semibold text-slate-900 px-1">
          {t("request.sourceFiles")}
          <span className="ml-2 text-xs font-normal text-slate-400">
            {t("request.optionalFiles", { count: MAX_UPLOAD_COUNT })}
          </span>
        </legend>

        {/* Retention notice */}
        <div className="mb-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">
            <strong className="text-slate-600">หมายเหตุการจัดเก็บ:</strong> ไฟล์ต้นฉบับที่อัพโหลดใช้สำหรับคำขอนี้เท่านั้น
            และจะถูกลบหลังจาก 90 วันตามนโยบายการจัดเก็บข้อมูลของเรา
          </p>
        </div>

        {/* Already-uploaded files (resume mode) — shown so the user knows which
            files are safe and which still need re-selecting. Not re-uploaded. */}
        {uploadedAssets && uploadedAssets.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-xs font-medium text-green-700">
              อัปโหลดสำเร็จแล้ว {uploadedAssets.length} ไฟล์ (ไม่ต้องอัปโหลดซ้ำ)
            </p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {uploadedAssets.map((a, i) => (
                <li
                  key={`${a.fileName}-${i}`}
                  className="relative overflow-hidden rounded-lg border border-green-200 bg-green-50"
                >
                  <div className="flex aspect-square items-center justify-center bg-slate-50">
                    {a.thumbnailUrl || (a.assetType === "image" && a.storageUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.thumbnailUrl || a.storageUrl}
                        alt={a.fileName}
                        className="h-full w-full object-cover"
                      />
                    ) : a.assetType === "video" && a.storageUrl ? (
                      <video
                        src={`${a.storageUrl}#t=0.5`}
                        className="h-full w-full object-cover bg-black"
                        preload="metadata"
                        muted
                        playsInline
                      />
                    ) : (
                      <svg className="h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
                      </svg>
                    )}
                  </div>
                  <div className="absolute right-1 top-1 rounded-full bg-green-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    ✓ อัปโหลดแล้ว
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="truncate text-xs text-slate-700">{a.fileName}</p>
                    <p className="text-xs text-slate-400">
                      {(a.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Drop zone */}
        <div
          onDrop={handleFileDrop}
          onDragOver={(e) => e.preventDefault()}
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer"
          onClick={() => document.getElementById("file-input")?.click()}
        >
          <p className="text-sm font-medium text-slate-600">
            ลากและวางไฟล์ที่นี่ หรือ{" "}
            <span className="text-blue-600 underline">เลือกไฟล์</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {imageOnly
              ? `รูปภาพเท่านั้น (JPEG, PNG, WebP, GIF) · สูงสุด ${MAX_IMAGE_SIZE_MB} MB ต่อไฟล์ · สูงสุด ${MAX_UPLOAD_COUNT} ไฟล์`
              : `รูปภาพสูงสุด ${MAX_IMAGE_SIZE_MB} MB · วิดีโอ MP4 สูงสุด ${MAX_VIDEO_SIZE_MB} MB และยาวไม่เกิน ${MAX_CLIP_DURATION_SECONDS} วินาที · สูงสุด ${MAX_UPLOAD_COUNT} ไฟล์ · รวมไม่เกิน ${MAX_UPLOAD_SIZE_MB} MB`}
          </p>
          <input
            id="file-input"
            type="file"
            multiple
            accept={acceptedTypes.join(",")}
            className="sr-only"
            onChange={handleFileInput}
          />
        </div>

        {/* Running total against the per-request cap. With 4K clips at ~8 MB per
            second, a handful of short videos reaches 500 MB without looking like
            much — and until now the only sign of that was individual files being
            refused part-way through the upload. */}
        {pendingFiles.length > 0 &&
          (() => {
            const selectedBytes = pendingFiles
              .filter(isPendingFileCounted)
              .reduce((sum, f) => sum + f.file.size, 0);
            const totalBytes = serverUploadedBytesRef.current + selectedBytes;
            const usedMb = totalBytes / (1024 * 1024);
            const pct = Math.min(100, (totalBytes / MAX_UPLOAD_SIZE_BYTES) * 100);
            const over = totalBytes > MAX_UPLOAD_SIZE_BYTES;
            const tight = !over && pct >= 80;
            return (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">
                    ขนาดรวมของคำขอนี้
                    {/* File COUNT, on the same per-request basis the server uses
                        — including anything already uploaded to this draft. This
                        total being invisible is what let a resumed draft accept
                        an 11th file and then refuse it mid-upload. */}
                    <span className="ml-2 tabular-nums text-slate-400">
                      ({serverUploadedCountRef.current +
                        pendingFiles.filter(isPendingFileCounted).length}
                      /{MAX_UPLOAD_COUNT} ไฟล์)
                    </span>
                  </span>
                  <span
                    className={`tabular-nums ${
                      over ? "text-red-600" : tight ? "text-amber-600" : "text-slate-500"
                    }`}
                  >
                    {usedMb.toFixed(0)} / {MAX_UPLOAD_SIZE_MB} MB
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${
                      over ? "bg-red-500" : tight ? "bg-amber-500" : "bg-blue-600"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {over && (
                  <p className="mt-1 text-xs text-red-600">
                    เกินขนาดรวมที่รับได้ กรุณาลบไฟล์บางรายการออกก่อนส่งคำขอ
                  </p>
                )}
              </div>
            );
          })()}

        {/* File list */}
        {pendingFiles.length > 0 && (
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {pendingFiles.map((item) => (
              <li
                key={item.id}
                className={`relative overflow-hidden rounded-lg border ${
                  item.error
                    ? "border-red-200 bg-red-50"
                    : item.rejected
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex aspect-square items-center justify-center bg-slate-50">
                  {previews[item.id]?.startsWith("blob:") &&
                  item.file.type.startsWith("video/") ? (
                    <video
                      src={previews[item.id]}
                      className="h-full w-full object-cover"
                      preload="metadata"
                      muted
                      playsInline
                      onLoadedMetadata={(event) => {
                        try {
                          event.currentTarget.currentTime = Math.min(
                            0.1,
                            event.currentTarget.duration / 2
                          );
                        } catch {
                          // The first frame remains a valid fallback.
                        }
                      }}
                    />
                  ) : previews[item.id] ? (
                    <img
                      src={previews[item.id]}
                      alt={item.file.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <svg className="h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
                    </svg>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(item.id)}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-xs text-slate-500 shadow hover:text-red-600"
                  aria-label="ลบ"
                >
                  ✕
                </button>
                <div className="px-2 py-1.5">
                  <p className="truncate text-xs text-slate-700">{item.file.name}</p>
                  {item.error ? (
                    <p className="text-xs text-red-600">{item.error}</p>
                  ) : item.rejected ? (
                    <p className="text-xs text-amber-700">{item.rejected}</p>
                  ) : (
                    <>
                      <p className="text-xs text-slate-400">
                        {(item.file.size / (1024 * 1024)).toFixed(1)} MB
                      </p>
                      {uploadProgress[item.id]?.stage === "done" && (
                        <p className="mt-0.5 text-xs font-medium text-green-700">
                          อัปโหลดสำเร็จแล้ว · ไม่นับซ้ำในการอัปโหลดต่อ
                        </p>
                      )}
                      {uploadProgress[item.id]?.stage === "error" && (
                        <p className="mt-0.5 text-xs font-medium text-red-600">
                          อัปโหลดไม่สำเร็จ · ยังไม่นับในจำนวนหรือขนาดรวม
                        </p>
                      )}
                      {item.durationUnverified && (
                        // The clip could not be decoded here, so its length is
                        // unknown until the server measures it. Say so up front
                        // rather than letting a late rejection look arbitrary.
                        <p className="text-xs text-amber-600">
                          ตรวจความยาวคลิปในเครื่องไม่ได้ — ระบบจะตรวจอีกครั้งตอนอัปโหลด
                        </p>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {/* Section 4 — ก่อนส่งคำขอ */}
      <fieldset className="rounded-xl border border-slate-200 bg-white p-6">
        <legend className="mb-5 text-base font-semibold text-slate-900 px-1">
          {t("request.beforeSubmit")}
        </legend>

        {/* One-time charge reminder — a request is a single flat fee, not per-step.
            Trial requests generate for free; payment happens later at download. */}
        {trialAvailable ? (
          <div className="mb-5 rounded-lg border border-green-100 bg-green-50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-green-800">
                  คลิปทดลองฟรี · สร้างได้เลยโดยไม่ใช้เครดิต
                </p>
                <p className="mt-0.5 text-sm text-green-700">
                  ชำระ {COST} เครดิตภายหลัง
                  เฉพาะเมื่อต้องการดาวน์โหลดวิดีโอแบบไม่มีลายน้ำ
                </p>
              </div>
              <div className="flex-shrink-0 rounded-lg border border-green-200 bg-white px-3 py-2 text-right">
                <p className="text-xs text-slate-400">ค่าส่งคำขอ</p>
                <p className="text-lg font-bold text-green-700">ฟรี</p>
                <p className="text-xs text-slate-400">จ่ายตอนดาวน์โหลด</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-5 rounded-lg border border-blue-100 bg-blue-50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-blue-800">
                  ค่าบริการครั้งเดียว {COST} เครดิต · ครอบคลุมทุกขั้นตอน
                </p>
                <p className="mt-0.5 text-sm text-blue-700">
                  เครดิตปัจจุบัน: {creditBalance} เครดิต · คงเหลือหลังชำระ:{" "}
                  {creditBalance - COST} เครดิต
                </p>
                {CREDITS_CONFIG.LAUNCH_DISCOUNT_ACTIVE && (
                  <p className="mt-0.5 text-xs text-blue-600">
                    <span className="line-through">
                      ฿{CREDITS_CONFIG.REQUEST_FULL_PRICE_CREDITS}
                    </span>{" "}
                    ฿{COST} ราคาเปิดตัว (ลด 50%) · ไม่มีค่าใช้จ่ายรายขั้นตอนเพิ่มเติม
                  </p>
                )}
              </div>
              <div className="flex-shrink-0 rounded-lg border border-blue-200 bg-white px-3 py-2 text-right">
                <p className="text-xs text-slate-400">ชำระครั้งเดียว</p>
                <p className="text-lg font-bold text-blue-700 tabular-nums">{COST}</p>
                <p className="text-xs text-slate-400">เครดิต</p>
              </div>
            </div>
          </div>
        )}

        {/* Keep the three auditable server fields, but present one combined
            acknowledgement. Agree in the disclosure sets all three together. */}
        <input type="checkbox" className="sr-only" tabIndex={-1} {...register("creditConfirmed")} />
        <input type="checkbox" className="sr-only" tabIndex={-1} {...register("rightsConfirmed")} />
        <input type="checkbox" className="sr-only" tabIndex={-1} {...register("aiProcessingConfirmed")} />

        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <Checkbox
            checked={allConfirmationsAccepted}
            onChange={(event) => {
              if (event.target.checked) {
                setConfirmationOpen(true);
                return;
              }
              setValue("creditConfirmed", undefined as never, { shouldValidate: true });
              setValue("rightsConfirmed", undefined as never, { shouldValidate: true });
              setValue("aiProcessingConfirmed", undefined as never, { shouldValidate: true });
            }}
            label="ฉันได้อ่านและยอมรับค่าใช้บริการ สิทธิ์ในเนื้อหา เงื่อนไขการเผยแพร่ และการประมวลผลด้วย AI สำหรับคำขอนี้"
            error={
              errors.creditConfirmed?.message ||
              errors.rightsConfirmed?.message ||
              errors.aiProcessingConfirmed?.message
            }
          />
          <button
            type="button"
            onClick={() => setConfirmationOpen(true)}
            className="ml-7 mt-2 text-sm font-medium text-blue-700 underline hover:text-blue-800"
          >
            อ่านรายละเอียดรวมก่อนยอมรับ
          </button>
        </div>
      </fieldset>

      {/* Submit error (with resume option after a partial upload) */}
      {submitError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{submitError}</p>
          {canRetry && (
            <button
              type="button"
              onClick={handleRetryUploads}
              className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              ลองอัปโหลดต่อ
            </button>
          )}

          {/* The diagnostic timeline, in the user's hands. The failure is
              entirely client-side, so this log is the only record of it — and a
              phone in the field is not attached to a laptop running adb. */}
          <button
            type="button"
            onClick={() => {
              const dump = diagDump();
              try {
                void navigator.clipboard?.writeText?.(dump)?.catch(() => undefined);
              } catch {
                /* no clipboard in this WebView — the textarea below is the fallback */
              }
              setShowDiag((v) => !v);
            }}
            className="ml-2 mt-3 rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            คัดลอกบันทึกปัญหา (ส่งให้ทีมงาน)
          </button>
          {showDiag && (
            <textarea
              readOnly
              value={diagDump()}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-2 h-56 w-full rounded border border-red-200 bg-white p-2 font-mono text-[10px] leading-tight text-slate-700"
            />
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pb-4">
        <button
          type="button"
          onClick={() => saveDraft(watch())}
          disabled={isDraftSaving}
          className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
        >
          {isDraftSaving ? t("request.saving") : draftSaved ? t("request.saved") : t("request.saveDraft")}
        </button>

        <div className="flex gap-3">
          {/* Not a <Link>. Cancelling has to delete the draft and everything
              uploaded to it — see handleCancel. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleCancel()}
            disabled={discardingDraft || isSubmitting}
          >
            {discardingDraft ? "กำลังยกเลิก..." : t("request.cancel")}
          </Button>
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={insufficientCredits || isSubmitting}
          >
            {t("request.submit")}
          </Button>
        </div>
      </div>

      {confirmationOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmationOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-confirmation-title"
            className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
              <div>
                <h2 id="request-confirmation-title" className="text-lg font-semibold text-slate-900">
                  ข้อกำหนดและหนังสือยินยอมสำหรับคำขอนี้
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  โปรดอ่านรายละเอียดทั้งหมดก่อนเลือกยอมรับหรือไม่ยอมรับ
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmationOpen(false)}
                aria-label="ปิดหน้าต่าง"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xl text-slate-500 hover:bg-slate-100"
              >
                ×
              </button>
            </div>

            {/* Only this middle region scrolls. The decision buttons remain in
                the non-scrolling footer below and are always available. */}
            <div className="min-h-0 flex-1 overflow-y-auto bg-white px-5 py-5 text-[13px] leading-6 text-slate-800 sm:px-7">
              <p className="mb-5">
                เอกสารฉบับนี้กำหนดรายละเอียดเกี่ยวกับค่าใช้บริการ การรับรองสิทธิ์ในเนื้อหา การอนุญาตให้เผยแพร่ และการประมวลผลข้อมูลด้วยระบบปัญญาประดิษฐ์สำหรับคำขอนี้โดยเฉพาะ การเลือก “ยอมรับ” ถือเป็นการยืนยันว่าคุณได้มีโอกาสอ่าน ทำความเข้าใจ และตกลงตามข้อความทั้งหมดด้านล่าง
              </p>

              <section className="border-t border-slate-300 pt-4">
                <h3 className="font-semibold text-slate-950">1. ค่าใช้บริการและการหักเครดิต</h3>
                <p className="mt-2">
                  {trialAvailable
                    ? `คำขอนี้ได้รับสิทธิ์สร้างคลิปทดลองโดยไม่หักเครดิตในเวลาส่งคำขอ อย่างไรก็ตาม หากประสงค์ดาวน์โหลดวิดีโอฉบับไม่มีลายน้ำ คุณตกลงว่าระบบอาจเรียกเก็บ ${COST} เครดิตตามเงื่อนไขที่แสดงในหน้าบริการ ณ เวลาที่ปลดล็อกการดาวน์โหลด`
                    : `เมื่อส่งคำขอนี้ คุณอนุญาตให้ RClipper หัก ${COST} เครดิตจากยอดคงเหลือของบัญชีเป็นค่าบริการแบบครั้งเดียวสำหรับกระบวนการผลิตที่ระบุในคำขอ การหักเครดิตจะบันทึกโดยอ้างอิงหมายเลขคำขอและจะไม่ถูกหักซ้ำสำหรับคำขอเดียวกัน`}
                </p>
                <p className="mt-2">
                  ราคา ระยะเวลาโดยประมาณ และผลลัพธ์ของบริการอาจขึ้นอยู่กับรายละเอียดไฟล์ ตัวเลือกการผลิต และข้อจำกัดทางเทคนิค การยอมรับไม่ได้รับประกันว่าผลลัพธ์จะตรงกับความชอบเชิงอัตวิสัยทุกประการ แต่ไม่ตัดสิทธิ์ที่คุณมีตามกฎหมายหรือเงื่อนไขการคืนเครดิตของ RClipper
                </p>
              </section>

              <section className="mt-5 border-t border-slate-300 pt-4">
                <h3 className="font-semibold text-slate-950">2. การรับรองความเป็นเจ้าของและสิทธิ์ของบุคคลภายนอก</h3>
                <p className="mt-2">
                  คุณรับรองว่าคุณเป็นเจ้าของ หรือได้รับใบอนุญาต หนังสือยินยอม การปล่อยสิทธิ์ และอำนาจที่จำเป็นอย่างครบถ้วนสำหรับรูปภาพ วิดีโอ เสียง ดนตรี การแสดง ใบหน้า ชื่อบุคคล เครื่องหมายการค้า งานศิลปะ ข้อความ ข้อมูลธุรกิจ ชื่อสถานที่ ตำแหน่ง และเนื้อหาอื่นทั้งหมดที่อัปโหลดหรือระบุในคำขอ
                </p>
                <p className="mt-2">
                  หากเนื้อหามีบุคคลอื่น ผู้เยาว์ ทรัพย์สินส่วนบุคคล หรือข้อมูลที่สามารถระบุตัวบุคคลได้ คุณยืนยันว่าได้แจ้งวัตถุประสงค์และได้รับความยินยอมที่จำเป็นก่อนอัปโหลด คุณจะไม่ส่งเนื้อหาที่ผิดกฎหมาย ละเมิดสิทธิ์ ทำให้เข้าใจผิด หรือไม่มีอำนาจอนุญาตให้ RClipper ดำเนินการ
                </p>
              </section>

              <section className="mt-5 border-t border-slate-300 pt-4">
                <h3 className="font-semibold text-slate-950">3. สิทธิ์ที่มอบให้เพื่อผลิตและเผยแพร่</h3>
                <p className="mt-2">
                  คุณอนุญาตให้ RClipper จัดเก็บ คัดลอก ตัดต่อ แปลงรูปแบบ ปรับขนาด ใส่คำบรรยาย ผสมเสียง สร้างงานต่อเนื่อง และดำเนินการทางเทคนิคอื่นที่จำเป็นเพื่อผลิต ตรวจสอบ ส่งมอบ และสนับสนุนวิดีโอตามคำขอ ทั้งนี้ สิทธิ์ในไฟล์ต้นฉบับยังคงเป็นของเจ้าของสิทธิ์เดิม
                </p>
                <p className="mt-2">
                  คุณยอมรับว่า RClipper อาจคัดเลือกวิดีโอบางรายการ พร้อมข้อความ ชื่อสถานที่ ข้อมูลธุรกิจ คำบรรยาย และข้อมูลที่เกี่ยวข้อง เพื่อเผยแพร่ผ่านแอป Travy เว็บไซต์ Travy.buzz และบัญชีสื่อสังคมออนไลน์ที่ RClipper เป็นเจ้าของหรือควบคุม ภายใต้ขอบเขตและเงื่อนไขที่ระบุในข้อกำหนดฉบับเต็ม
                </p>
              </section>

              <section className="mt-5 border-t border-slate-300 pt-4">
                <h3 className="font-semibold text-slate-950">4. การส่งและประมวลผลข้อมูลด้วยผู้ให้บริการ AI ภายนอก</h3>
                <p className="mt-2">
                  เพื่อให้บริการสร้างวิดีโอ คุณอนุญาตให้ RClipper ส่งข้อมูลที่จำเป็นไปยังผู้ให้บริการ AI ภายนอกดังต่อไปนี้ก่อนเริ่มการประมวลผล:
                </p>
                <ol className="mt-2 list-decimal space-y-2 pl-5">
                  <li>
                    <strong className="font-semibold">Google Gemini:</strong> รูปภาพ ไฟล์หรือเฟรมตัวอย่างจากวิดีโอ ชื่อและคำอธิบายคำขอ กลุ่มเป้าหมาย ข้อมูลสถานที่หรือธุรกิจ ตำแหน่งที่เลือก และตัวเลือกการผลิต เพื่อวิเคราะห์เนื้อหา วางโครงเรื่อง และสร้างร่างบทพูด สตอรีบอร์ด คำบรรยาย และองค์ประกอบที่เกี่ยวข้อง
                  </li>
                  <li>
                    <strong className="font-semibold">ElevenLabs:</strong> บทพูดที่คุณอนุมัติ ภาษา ตัวเลือกเสียง และข้อมูลที่จำเป็นต่อการสร้างหรือประมวลผลเสียงบรรยายสำหรับวิดีโอ
                  </li>
                </ol>
                <p className="mt-2">
                  ข้อมูลดังกล่าวอาจมีใบหน้า เสียง ตำแหน่ง ข้อมูลธุรกิจ หรือข้อมูลส่วนบุคคลของคุณและบุคคลอื่น ผู้ให้บริการแต่ละรายประมวลผลข้อมูลตามเงื่อนไขและมาตรการคุ้มครองข้อมูลของตน RClipper จำกัดการส่งข้อมูลให้สัมพันธ์กับวัตถุประสงค์ของคำขอนี้ และจะไม่เริ่มส่งข้อมูลเพื่อการประมวลผล AI จนกว่าคุณจะเลือก “ยอมรับ”
                </p>
              </section>

              <section className="mt-5 border-t border-slate-300 pt-4">
                <h3 className="font-semibold text-slate-950">5. การจัดเก็บ การลบ และการถอนความยินยอม</h3>
                <p className="mt-2">
                  ไฟล์ต้นฉบับเชื่อมโยงกับคำขอนี้และมีกำหนดลบตามระยะเวลาการเก็บรักษาที่แจ้งไว้ โดยทั่วไปคือ 90 วันนับจากการส่งคำขอ เว้นแต่จำเป็นต้องเก็บไว้นานกว่านั้นตามกฎหมาย การระงับข้อพิพาท หรือข้อกำหนดที่ใช้บังคับ คุณสามารถขอลบบัญชีหรือข้อมูลและศึกษาวิธีถอนความยินยอมได้จากนโยบายความเป็นส่วนตัว ทั้งนี้ การถอนก่อนเริ่มประมวลผลอาจทำให้ไม่สามารถให้บริการสร้างวิดีโอได้ และการถอนภายหลังไม่สามารถย้อนกลับการประมวลผลที่เสร็จสิ้นโดยชอบแล้ว
                </p>
              </section>

              <section className="mt-5 border-y border-slate-300 py-4">
                <h3 className="font-semibold text-slate-950">6. ผลของการตัดสินใจ</h3>
                <p className="mt-2">
                  หากเลือก “ไม่ยอมรับ” หน้าต่างนี้จะปิดโดยไม่มีการทำเครื่องหมายในช่องยืนยันและจะยังไม่สามารถส่งคำขอได้ หากเลือก “ยอมรับ” ระบบจะทำเครื่องหมายช่องยืนยันโดยอัตโนมัติ บันทึกการยืนยันค่าใช้บริการ สิทธิ์ในเนื้อหา และการประมวลผลด้วย AI สำหรับคำขอนี้ แล้วจึงอนุญาตให้ดำเนินการส่งคำขอต่อไป
                </p>
              </section>

              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 pb-2">
                <Link href={ROUTES.TERMS} target="_blank" className="font-medium text-blue-700 underline hover:text-blue-900">
                  ข้อกำหนดและเงื่อนไขฉบับเต็ม
                </Link>
                <Link href={ROUTES.PRIVACY} target="_blank" className="font-medium text-blue-700 underline hover:text-blue-900">
                  นโยบายความเป็นส่วนตัว
                </Link>
              </div>
            </div>

            <div
              className="app-safe-bottom z-10 flex shrink-0 gap-3 border-t border-slate-300 bg-white px-5 pt-4 shadow-[0_-4px_12px_rgba(15,23,42,0.08)] sm:justify-end sm:px-6"
              style={
                mobilePlatform === "android"
                  ? {
                      // Some Android System WebViews report a zero CSS safe-area
                      // inset even though the three-button/gesture navigation
                      // bar overlays the bottom of the viewport. Reserve one
                      // navigation-bar height in native Android as a fallback;
                      // max() still honours a larger real inset when supplied.
                      paddingBottom:
                        "calc(1rem + max(env(safe-area-inset-bottom, 0px), 3rem))",
                    }
                  : undefined
              }
            >
              <Button
                type="button"
                variant="outline"
                className="flex-1 sm:flex-none sm:min-w-32"
                onClick={() => setConfirmationOpen(false)}
              >
                ไม่ยอมรับ
              </Button>
              <Button
                type="button"
                className="flex-1 sm:flex-none sm:min-w-32"
                onClick={() => {
                  setValue("creditConfirmed", true, {
                    shouldValidate: true,
                    shouldDirty: true,
                    shouldTouch: true,
                  });
                  setValue("rightsConfirmed", true, {
                    shouldValidate: true,
                    shouldDirty: true,
                    shouldTouch: true,
                  });
                  setValue("aiProcessingConfirmed", true, {
                    shouldValidate: true,
                    shouldDirty: true,
                    shouldTouch: true,
                  });
                  setConfirmationOpen(false);
                }}
              >
                ยอมรับ
              </Button>
            </div>
          </div>
        </div>
      )}

      <GoogleMapLocationPicker
        open={mapOpen}
        placeName={watchedPlaceName}
        initialCoordinates={
          Number.isFinite(watchedLatitude) && Number.isFinite(watchedLongitude)
            ? {
                latitude: Number(watchedLatitude),
                longitude: Number(watchedLongitude),
              }
            : null
        }
        onClose={() => setMapOpen(false)}
        onConfirm={({ latitude, longitude }) => {
          setValue("latitude", latitude, { shouldValidate: true, shouldDirty: true });
          setValue("longitude", longitude, { shouldValidate: true, shouldDirty: true });
          setMapOpen(false);
        }}
      />
    </form>
  );
}
