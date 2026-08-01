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

const GoogleMapLocationPicker = dynamic(() =>
  import("@/features/requests/components/GoogleMapLocationPicker").then(
    (module) => module.GoogleMapLocationPicker
  )
);

interface PendingFile {
  id: string;
  file: File;
  error?: string;
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
 * Read a video file's duration (seconds) in the browser via a detached
 * <video> element's metadata. Resolves NaN on failure so callers can treat
 * "unknown" as non-blocking (the server ffprobe is the authoritative guard).
 */
function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "auto";
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(video.duration);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(NaN);
      };
      video.src = url;
    } catch {
      resolve(NaN);
    }
  });
}

/**
 * Capture a poster frame from a local video File and return it as a JPEG data
 * URL, so the pending-file grid shows the clip's actual content instead of a
 * generic icon. Seeks slightly past the start to avoid a black first frame.
 * Resolves null on any failure (unsupported codec, decode error) so the caller
 * falls back to the placeholder icon. Object URL is always revoked.
 */
function generateVideoThumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;

      let settled = false;
      const finish = (result: string | null) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(result);
      };

      const capture = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 320;
          canvas.height = video.videoHeight || 180;
          const ctx = canvas.getContext("2d");
          if (!ctx) return finish(null);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL("image/jpeg", 0.7));
        } catch {
          finish(null);
        }
      };

      video.onloadeddata = () => {
        video.onseeked = capture;
        const target = Math.min(0.5, (Number.isFinite(video.duration) ? video.duration : 1) / 2);
        try {
          video.currentTime = target;
        } catch {
          capture();
        }
      };
      video.onerror = () => finish(null);
      // Safety net if metadata/seek never fires.
      setTimeout(() => finish(null), 5000);
      video.src = url;
      video.load();
    } catch {
      resolve(null);
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
 * MUST equal the server's MULTIPART_PART_SIZE (5 MB). On the RESUME path there is
 * no initiate response to echo the server's partSize, so the client recomputes
 * part boundaries from this constant — if the two ever diverge, a resumed upload
 * would slice at different offsets than the already-stored parts and corrupt the
 * object. Keep this in lockstep with UploadService.MULTIPART_PART_SIZE.
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

/** localStorage helpers — never throw (some WebView configs restrict storage). */
function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
function lsRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Persisted id of the in-progress draft, so a reload/return resumes it instead
 *  of minting a new request (which previously orphaned already-uploaded files). */
const DRAFT_ID_KEY = "clipper:newreq:draftId";

/** A resumable multipart session for one file. No bytes — only the ids needed to
 *  resume via ListParts once the same file is re-selected. */
interface MpuSession {
  assetId: string;
  key: string;
  uploadId: string;
}

const mpuMapKey = (draftId: string) => `clipper:newreq:mpu:${draftId}`;
function loadMpuMap(draftId: string): Record<string, MpuSession> {
  try {
    return JSON.parse(lsGet(mpuMapKey(draftId)) || "{}") as Record<string, MpuSession>;
  } catch {
    return {};
  }
}
function getMpuSession(draftId: string, sig: string): MpuSession | null {
  return loadMpuMap(draftId)[sig] ?? null;
}
function saveMpuSession(draftId: string, sig: string, s: MpuSession): void {
  const m = loadMpuMap(draftId);
  m[sig] = s;
  lsSet(mpuMapKey(draftId), JSON.stringify(m));
}
function clearMpuSession(draftId: string, sig: string): void {
  const m = loadMpuMap(draftId);
  delete m[sig];
  lsSet(mpuMapKey(draftId), JSON.stringify(m));
}
function clearDraftPersistence(draftId: string | null): void {
  lsRemove(DRAFT_ID_KEY);
  if (draftId) lsRemove(mpuMapKey(draftId));
}

/** Stable per-file signature (client only) for matching a re-selected file to a
 *  persisted multipart session. */
const fileSig = (f: File) => `${f.name}::${f.size}::${f.lastModified}`;
/** name+size signature — used to match a local file to a server-side asset (the
 *  server has no access to lastModified). */
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

/** PUT one blob (whole file or one part), annotating a thrown network error with
 *  the target host so the on-screen failure names it (e.g. Spaces). */
async function putPart(
  url: string,
  blob: Blob,
  onProgress: (loaded: number, total: number) => void,
  contentType?: string
): Promise<string> {
  try {
    return await putBlobWithProgress(url, blob, onProgress, contentType);
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
  contentType?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(blob.size, blob.size);
        resolve(xhr.getResponseHeader("ETag") ?? "");
      } else {
        reject(new Error(`upload HTTP ${xhr.status}`));
      }
    };
    // Empty-status onerror is the browser blocking the request (CORS/CSP/network)
    // — the XHR equivalent of fetch()'s "Failed to fetch".
    xhr.onerror = () => reject(new Error("Failed to fetch"));
    xhr.ontimeout = () => reject(new Error("upload timeout"));
    xhr.send(blob);
  });
}

type UploadStage = "pending" | "uploading" | "done" | "error";
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

  // Resume state. draftIdRef holds the single reused draft id (never recreated on
  // retry). When resuming a draft opened from the dashboard, it starts as that
  // draft's id. canRetry shows the "resume upload" button after a partial failure.
  // resumeInfo shows the banner when a returning user has an unfinished draft.
  const draftIdRef = useRef<string | null>(existingRequestId ?? null);
  const [canRetry, setCanRetry] = useState(false);
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
    },
  });

  const watchedPlatforms = watch("targetPlatforms") ?? [];
  const watchedDuration = watch("durationSeconds") ?? PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS;
  const watchedPlaceName = watch("placeName");
  const watchedLatitude = watch("latitude");
  const watchedLongitude = watch("longitude");

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
    // Running total of bytes already accepted, so the per-request total cap is
    // enforced as files are added (matches the server presign-route check).
    let runningBytes = pendingFiles
      .filter((f) => !f.error)
      .reduce((sum, f) => sum + f.file.size, 0);

    const newItems: PendingFile[] = files.map((file) => {
      const id = crypto.randomUUID();
      let error: string | undefined;

      const isVideo = ACCEPTED_VIDEO_MIME_TYPES.includes(
        file.type as (typeof ACCEPTED_VIDEO_MIME_TYPES)[number]
      );

      if (imageOnly && isVideo) {
        error = "แพ็กเกจนี้รับเฉพาะไฟล์รูปภาพเท่านั้น";
      } else if (pendingFiles.length + files.indexOf(file) >= MAX_UPLOAD_COUNT) {
        error = `อัพโหลดได้สูงสุด ${MAX_UPLOAD_COUNT} ไฟล์`;
      } else if (file.size > (isVideo ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES)) {
        error = `ไฟล์เกินขนาดสูงสุด ${isVideo ? MAX_VIDEO_SIZE_MB : MAX_IMAGE_SIZE_MB} MB`;
      } else if (!acceptedTypes.includes(file.type as never)) {
        error = "ประเภทไฟล์ไม่รองรับ";
      } else if (validateTotalUploadSize(runningBytes, file.size)) {
        error = `ขนาดไฟล์รวมเกิน ${MAX_UPLOAD_SIZE_MB} MB ต่อคำขอ`;
      }

      if (!error) runningBytes += file.size;
      return { id, file, error };
    });

    setPendingFiles((prev) => [...prev, ...newItems].slice(0, MAX_UPLOAD_COUNT));

    // Generate previews for accepted files: images use an object URL; videos get
    // an async poster-frame capture (data URL) so the grid shows real content.
    for (const item of newItems) {
      if (item.error) continue;
      const isVideo = ACCEPTED_VIDEO_MIME_TYPES.includes(
        item.file.type as (typeof ACCEPTED_VIDEO_MIME_TYPES)[number]
      );
      if (isVideo) {
        // Show the selected local video immediately. This is also the fallback
        // on iOS/WKWebView when canvas frame extraction cannot decode the clip.
        const videoUrl = URL.createObjectURL(item.file);
        setPreviews((prev) => ({ ...prev, [item.id]: videoUrl }));
        void generateVideoThumbnail(item.file).then((thumb) => {
          if (!thumb) return;
          setPreviews((prev) => {
            const previous = prev[item.id];
            if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
            return { ...prev, [item.id]: thumb };
          });
        });
      } else if (item.file.type.startsWith("image/")) {
        const objUrl = URL.createObjectURL(item.file);
        setPreviews((prev) => ({ ...prev, [item.id]: objUrl }));
      }
    }

    // Asynchronously verify each accepted video's duration (≤45s) and flag any
    // that are too long. The server re-checks with ffprobe at confirm time.
    for (const item of newItems) {
      if (item.error) continue;
      const isVideo = ACCEPTED_VIDEO_MIME_TYPES.includes(
        item.file.type as (typeof ACCEPTED_VIDEO_MIME_TYPES)[number]
      );
      if (!isVideo) continue;

      void readVideoDuration(item.file).then((duration) => {
        if (validateClipDuration(duration)) {
          setPendingFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? { ...f, error: `คลิปต้องยาวไม่เกิน ${MAX_CLIP_DURATION_SECONDS} วินาที` }
                : f
            )
          );
        }
      });
    }
  };

  const removeFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
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

  // On mount, recover an unfinished draft (survives reload / app relaunch on
  // iOS/Android). If it still exists and has uploaded files or an in-progress
  // multipart session, adopt its id and show the resume banner; otherwise clear
  // the stale pointer. Offline is left intact for a later attempt.
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
          assets: { fileName: string; uploadStatus: string }[];
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
        draftIdRef.current = saved;
        setResumeInfo({ uploadedNames: uploaded.map((a) => a.fileName) });
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
      body: JSON.stringify({ ...data, creditConfirmed: true, rightsConfirmed: true }),
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
      const body = await metaRes.json().catch(() => ({}));
      throw new Error(body.error ?? `error ${metaRes.status}`);
    }
    const { assetId, presignedUrl } = await metaRes.json();
    await putPart(
      presignedUrl,
      item.file,
      (loaded, total) => setItemProgress(item.id, { pct: Math.min(99, Math.round((loaded / total) * 100)) }),
      item.file.type
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
    const partSize = MULTIPART_PART_SIZE;
    const partCount = Math.max(1, Math.ceil(item.file.size / partSize));

    // 1) Resume a persisted session if present; otherwise initiate a fresh one.
    let session = getMpuSession(requestId, sig);
    let uploadedParts: { PartNumber: number; ETag: string }[] = [];

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
        const body = await initRes.json().catch(() => ({}));
        throw new Error(body.error ?? `error ${initRes.status}`);
      }
      const init = (await initRes.json()) as { assetId: string; key: string; uploadId: string };
      session = { assetId: init.assetId, key: init.key, uploadId: init.uploadId };
      saveMpuSession(requestId, sig, session);
      uploadedParts = [];
    }

    const { key, uploadId, assetId } = session;

    // 2) Which parts are still missing? Seed progress from the resumed bytes.
    const done = new Set(uploadedParts.map((p) => p.PartNumber));
    const partBytes = (n: number) => Math.min(partSize, item.file.size - (n - 1) * partSize);
    let uploadedBytes = 0;
    for (const p of uploadedParts) uploadedBytes += partBytes(p.PartNumber);
    const missing: number[] = [];
    for (let n = 1; n <= partCount; n++) if (!done.has(n)) missing.push(n);
    setItemProgress(item.id, { pct: Math.min(99, Math.round((uploadedBytes / item.file.size) * 100)) });

    // 3) Sign + upload only the missing parts.
    const etags: { PartNumber: number; ETag: string }[] = [...uploadedParts];
    if (missing.length > 0) {
      const signRes = await mp("ขอที่อยู่อัปโหลด", { action: "sign", key, uploadId, partNumbers: missing });
      if (!signRes.ok) {
        const body = await signRes.json().catch(() => ({}));
        throw new Error(body.error ?? `error ${signRes.status}`);
      }
      const { parts: partUrls } = (await signRes.json()) as {
        parts: { partNumber: number; url: string }[];
      };

      for (const { partNumber, url } of partUrls) {
        const start = (partNumber - 1) * partSize;
        const chunk = item.file.slice(start, Math.min(start + partSize, item.file.size));
        const etag = await putPart(url, chunk, (loaded) =>
          setItemProgress(item.id, {
            pct: Math.min(99, Math.round(((uploadedBytes + loaded) / item.file.size) * 100)),
          })
        );
        if (!etag) throw new Error(`ไม่ได้รับ ETag ของส่วนที่ ${partNumber}`);
        etags.push({ PartNumber: partNumber, ETag: etag });
        uploadedBytes += chunk.size;
      }
    }

    // 4) Assemble. NOTE: we deliberately do NOT abort on failure above — keeping
    // the parts is what lets the next attempt resume. Only clear the session once
    // the object is successfully assembled (abandoned MPUs are swept by the
    // bucket's AbortIncompleteMultipartUpload lifecycle rule).
    etags.sort((a, b) => a.PartNumber - b.PartNumber);
    const completeRes = await mp("รวมไฟล์", { action: "complete", key, uploadId, parts: etags });
    if (!completeRes.ok) {
      const body = await completeRes.json().catch(() => ({}));
      throw new Error(body.error ?? `error ${completeRes.status}`);
    }
    clearMpuSession(requestId, sig);
    return assetId;
  };

  // Upload every not-yet-stored file, then submit. Reused by both the first
  // attempt and the retry button — it reconciles against what already landed on
  // the server so nothing is uploaded twice.
  const finalizeSubmission = async (requestId: string): Promise<void> => {
    const uploadItems = pendingFiles.filter((f) => !f.error);

    // Reconcile with the server: skip any file whose name+size is already an
    // uploaded asset on this request (resume after reload/return).
    let uploadedSigs = new Set<string>();
    try {
      const listRes = await fetch(`/api/uploads/${requestId}`);
      if (listRes.ok) {
        const { assets } = (await listRes.json()) as {
          assets: { fileName: string; fileSizeBytes: number; uploadStatus: string }[];
        };
        uploadedSigs = new Set(
          assets
            .filter((a) => a.uploadStatus === "uploaded")
            .map((a) => nameSizeSig(a.fileName, a.fileSizeBytes))
        );
      }
    } catch {
      /* non-fatal: fall through and (re)upload */
    }

    // Seed progress: already-uploaded files show done; the rest show 0%.
    setUploadProgress(
      Object.fromEntries(
        uploadItems.map((i) => [
          i.id,
          uploadedSigs.has(nameSizeSig(i.file.name, i.file.size))
            ? { pct: 100, stage: "done" as UploadStage }
            : { pct: 0, stage: "pending" as UploadStage },
        ])
      )
    );

    const failedUploads: string[] = [];
    for (const item of uploadItems) {
      if (uploadedSigs.has(nameSizeSig(item.file.name, item.file.size))) continue; // already stored
      console.log(
        `[submit] uploading ${item.file.name} (${(item.file.size / 1e6).toFixed(1)} MB, ${
          item.file.size > MULTIPART_THRESHOLD_BYTES ? "multipart" : "single"
        })`
      );
      setItemProgress(item.id, { stage: "uploading" });

      let assetId: string;
      try {
        assetId =
          item.file.size > MULTIPART_THRESHOLD_BYTES
            ? await uploadMultipart(requestId, item)
            : await uploadSingle(requestId, item);
      } catch (uploadErr) {
        const detail = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        console.error(`[submit] upload ${item.file.name} failed:`, uploadErr);
        setItemProgress(item.id, { stage: "error" });
        failedUploads.push(`${item.file.name} (อัปโหลดไม่สำเร็จ — ${detail})`);
        continue;
      }

      // Reuse the poster frame already captured for the preview grid (a data: URL
      // for videos) so the clip's thumbnail is stored at upload — no server ffmpeg.
      const poster = previews[item.id];
      const posterDataUrl =
        typeof poster === "string" && poster.startsWith("data:image/") ? poster : undefined;

      const confirmRes = await netFetch("ยืนยันไฟล์", `/api/uploads/${requestId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, posterDataUrl }),
      });
      if (!confirmRes.ok) {
        const body = await confirmRes.json().catch(() => ({}));
        setItemProgress(item.id, { stage: "error" });
        failedUploads.push(`${item.file.name} (${body.error ?? "ยืนยันไฟล์ไม่สำเร็จ"})`);
        continue;
      }
      setItemProgress(item.id, { stage: "done", pct: 100 });
    }

    // Partial failure: keep the draft + everything uploaded so far, and offer to
    // resume. The retry button re-runs this function against the same request.
    if (failedUploads.length > 0) {
      setPhase("form");
      setCanRetry(true);
      setSubmitError(
        `ไฟล์บางรายการยังอัปโหลดไม่สำเร็จ กด "ลองอัปโหลดต่อ" เพื่ออัปโหลดเฉพาะไฟล์ที่เหลือ ` +
          `(ระบบจะอัปโหลดต่อจากจุดที่ค้างไว้ ไม่เริ่มใหม่): ${failedUploads.join(" · ")}`
      );
      return;
    }

    const submitRes = await netFetch("ส่งคำขอ", `/api/requests/${requestId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creditConfirmed: true, rightsConfirmed: true }),
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

    try {
      setPhase("submitting");
      const requestId = await ensureDraft(data);
      await finalizeSubmission(requestId);
    } catch (err) {
      setPhase("form");
      setCanRetry(Boolean(draftIdRef.current));
      setSubmitError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
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
    setSubmitError(null);
    setCanRetry(false);
    try {
      setPhase("submitting");
      await finalizeSubmission(requestId);
    } catch (err) {
      setPhase("form");
      setCanRetry(true);
      setSubmitError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
    }
  };

  // Discard an unfinished draft and start fresh (clears the resume banner and all
  // persisted state).
  const handleDiscardResume = () => {
    clearDraftPersistence(draftIdRef.current);
    draftIdRef.current = null;
    setResumeInfo(null);
    setCanRetry(false);
    setUploadProgress({});
    setSubmitError(null);
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
              const isDone = p.stage === "done";
              return (
                <li key={f.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-slate-700">{f.file.name}</span>
                    <span
                      className={`tabular-nums ${
                        isError ? "text-red-600" : isDone ? "text-green-600" : "text-slate-500"
                      }`}
                    >
                      {isError ? "ผิดพลาด" : `${p.pct}%`}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all duration-200 ${
                        isError ? "bg-red-500" : isDone ? "bg-green-500" : "bg-blue-600"
                      }`}
                      style={{ width: `${isError ? 100 : p.pct}%` }}
                    />
                  </div>
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
          {/* Only offer "start over" for a locally-recovered draft — when the user
              deliberately opened a specific draft from the dashboard, clearing it
              would just orphan that request. */}
          {!existingRequestId && (
            <button
              type="button"
              onClick={handleDiscardResume}
              className="mt-2 text-xs text-amber-700 underline hover:text-amber-900"
            >
              เริ่มคำขอใหม่ (ล้างข้อมูลที่ค้างไว้)
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

        {/* File list */}
        {pendingFiles.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {pendingFiles.map((item) => (
              <li
                key={item.id}
                className={`relative overflow-hidden rounded-lg border ${
                  item.error
                    ? "border-red-200 bg-red-50"
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
                  ) : (
                    <p className="text-xs text-slate-400">
                      {(item.file.size / (1024 * 1024)).toFixed(1)} MB
                    </p>
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

        <div className="flex flex-col gap-4">
          <Checkbox
            label={
              trialAvailable
                ? `ฉันเข้าใจว่าคำขอนี้เป็นคลิปทดลองฟรี และการดาวน์โหลดวิดีโอแบบไม่มีลายน้ำจะมีค่าบริการ ${COST} เครดิต`
                : `ฉันเข้าใจว่าการส่งคำขอนี้จะใช้ ${COST} เครดิต แบบชำระครั้งเดียว ครอบคลุมทุกขั้นตอนการผลิต`
            }
            {...register("creditConfirmed")}
            error={errors.creditConfirmed?.message}
          />

          <Checkbox
            label={
              <>
                ฉันยืนยันว่าเป็นเจ้าของหรือได้รับสิทธิ์และการอนุญาตที่จำเป็นสำหรับไฟล์ บุคคล เสียง เพลง เครื่องหมายการค้า ข้อความ ชื่อสถานที่ ตำแหน่งที่เลือก และเนื้อหาที่อัปโหลดหรือกรอกในคำขอ และยอมรับ{" "}
                <Link
                  href={ROUTES.TERMS}
                  target="_blank"
                  className="text-blue-600 underline hover:text-blue-800"
                  onClick={(e) => e.stopPropagation()}
                >
                  ข้อกำหนดและเงื่อนไขของ RClipper
                </Link>{" "}
                รวมถึงสิทธิ์ของ RClipper ในการคัดเลือกวิดีโอบางรายการพร้อมข้อมูลที่เกี่ยวข้องเพื่อเผยแพร่บนแอป Travy เว็บไซต์ Travy.buzz และบัญชีโซเชียลมีเดียอย่างเป็นทางการที่ RClipper เป็นเจ้าของหรือควบคุม
              </>
            }
            {...register("rightsConfirmed")}
            error={errors.rightsConfirmed?.message}
          />
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
          <Link href={ROUTES.REQUESTS}>
            <Button type="button" variant="outline">
              {t("request.cancel")}
            </Button>
          </Link>
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={insufficientCredits || isSubmitting}
          >
            {t("request.submit")}
          </Button>
        </div>
      </div>

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
