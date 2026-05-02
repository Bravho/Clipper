"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Platform, PLATFORM_LABELS } from "@/domain/enums/Platform";

/**
 * EditedClipUploadPanel — staff upload the final edited clip for admin review.
 *
 * Upload flow:
 *   1. Staff selects a video file
 *   2. POST /api/staff/requests/[id]/clip-upload → presigned PUT URL
 *   3. Client PUTs directly to DO Spaces (no bytes through server)
 *   4. POST /api/staff/requests/[id]/clip-upload/confirm → asset confirmed
 *
 * After upload, the clip dimensions are checked against each target platform's
 * expected aspect ratio. A yellow warning is shown for any mismatches.
 *
 * The uploaded clip must exist before "Submit for Production Review" is allowed.
 */

// ── Platform dimension requirements ────────────────────────────────────────────
// Tolerance: 5 % from the exact ratio (accounts for minor codec rounding)
const TOLERANCE = 0.05;

function withinTolerance(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) / expected < TOLERANCE;
}

interface RatioCheck {
  expectedRatio: string;       // Human-readable, e.g. "9:16 vertical"
  passes: (w: number, h: number) => boolean;
}

const PLATFORM_RATIO: Partial<Record<Platform, RatioCheck>> = {
  [Platform.TikTok]: {
    expectedRatio: "9:16 vertical",
    passes: (w, h) => withinTolerance(w / h, 9 / 16),
  },
  [Platform.Instagram]: {
    expectedRatio: "9:16 vertical",
    passes: (w, h) => withinTolerance(w / h, 9 / 16),
  },
  [Platform.Facebook]: {
    // Facebook Reels = 9:16; standard posts = 16:9 or 1:1 — accept any
    expectedRatio: "9:16 vertical",
    passes: (w, h) =>
      withinTolerance(w / h, 9 / 16) ||
      withinTolerance(w / h, 16 / 9) ||
      withinTolerance(w / h, 1),
  },
  [Platform.YouTube]: {
    expectedRatio: "16:9 landscape",
    passes: (w, h) => withinTolerance(w / h, 16 / 9),
  },
  [Platform.TventApp]: {
    expectedRatio: "9:16 vertical",
    passes: (w, h) => withinTolerance(w / h, 9 / 16),
  },
  // CDN: no constraint
};

/** Read video metadata (dimensions + duration) from a local File without uploading it. */
function getVideoMetadata(
  file: File
): Promise<{ width: number; height: number; duration: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    video.src = url;
  });
}

// ── Component ──────────────────────────────────────────────────────────────────

interface EditedClip {
  id: string;
  fileName: string;
  fileSizeBytes: number;
}

interface EditedClipUploadPanelProps {
  requestId: string;
  editedClip: EditedClip | null;
  targetPlatforms: Platform[];
}

type UploadState = "idle" | "uploading" | "confirming" | "done" | "error";

interface DimensionWarning {
  platformLabel: string;
  expectedRatio: string;
}

export function EditedClipUploadPanel({
  requestId,
  editedClip,
  targetPlatforms,
}: EditedClipUploadPanelProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [dimensionWarnings, setDimensionWarnings] = useState<DimensionWarning[]>([]);
  const [clipDimensions, setClipDimensions] = useState<{ width: number; height: number } | null>(null);

  const sizeMb = editedClip
    ? Math.round((editedClip.fileSizeBytes / 1024 / 1024) * 10) / 10
    : null;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setUploadState("uploading");
    setUploadProgress(0);
    setUploadError(null);
    setDimensionWarnings([]);
    setClipDimensions(null);

    // Client-side validation
    if (file.type !== "video/mp4") {
      setUploadState("error");
      setUploadError("Only MP4 files are accepted.");
      return;
    }
    if (file.size > 150 * 1024 * 1024) {
      setUploadState("error");
      setUploadError("File exceeds the 150 MB size limit.");
      return;
    }

    // Read metadata (dimensions + duration) in parallel with the upload — fast local operation
    const metaPromise = getVideoMetadata(file);

    try {
      // Step 1 — get presigned PUT URL
      const initRes = await fetch(`/api/staff/requests/${requestId}/clip-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type,
        }),
      });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(initJson.error ?? "Failed to initialise upload.");

      const { assetId, presignedUrl } = initJson as {
        assetId: string;
        presignedUrl: string;
      };

      // Step 2 — PUT file directly to DO Spaces via XHR for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", presignedUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed (${xhr.status}).`));
        xhr.onerror = () => reject(new Error("Network error during upload."));
        xhr.send(file);
      });

      // Step 3 — confirm upload
      setUploadState("confirming");
      const confirmRes = await fetch(
        `/api/staff/requests/${requestId}/clip-upload/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId }),
        }
      );
      const confirmJson = await confirmRes.json();
      if (!confirmRes.ok)
        throw new Error(confirmJson.error ?? "Failed to confirm upload.");

      setUploadState("done");

      // Step 4 — check duration + dimensions against platform requirements
      const meta = await metaPromise;
      if (meta) {
        setClipDimensions({ width: meta.width, height: meta.height });

        const warnings: DimensionWarning[] = [];

        // Duration check (must be ≤ 30 seconds)
        if (meta.duration > 30) {
          warnings.push({
            platformLabel: "All platforms",
            expectedRatio: `≤ 30 s (clip is ${Math.ceil(meta.duration)} s)`,
          });
        }

        // Aspect ratio check per platform
        for (const platform of targetPlatforms) {
          const check = PLATFORM_RATIO[platform];
          if (check && !check.passes(meta.width, meta.height)) {
            warnings.push({
              platformLabel: PLATFORM_LABELS[platform] ?? platform,
              expectedRatio: check.expectedRatio,
            });
          }
        }

        setDimensionWarnings(warnings);
      }

      router.refresh();
    } catch (e) {
      setUploadState("error");
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 space-y-3">
      <div>
        <p className="text-sm font-semibold text-blue-900">Edited Clip Upload</p>
        <p className="text-xs text-blue-700 mt-0.5">
          Upload the final edited clip before submitting for production review.
          Admin will download and review it before approving for publishing.
        </p>
      </div>

      {/* Current uploaded clip */}
      {editedClip && (
        <div className="flex items-center justify-between rounded-md border border-blue-200 bg-white px-3 py-2">
          <div>
            <p className="text-sm font-medium text-slate-800">{editedClip.fileName}</p>
            <p className="text-xs text-green-600 font-medium">{sizeMb} MB · Uploaded ✓</p>
          </div>
          <a
            href={`/api/staff/assets/${editedClip.id}/download`}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Download
          </a>
        </div>
      )}

      {/* Upload controls */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4"
          onChange={handleFileChange}
          className="hidden"
          id="clip-file-input"
        />

        {(uploadState === "idle" ||
          uploadState === "done" ||
          uploadState === "error") && (
          <label
            htmlFor="clip-file-input"
            className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
          >
            {editedClip ? "Replace Clip" : "Choose Clip to Upload"}
          </label>
        )}

        {(uploadState === "uploading" || uploadState === "confirming") && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>
                {uploadState === "confirming"
                  ? "Confirming…"
                  : `Uploading ${selectedFileName ?? ""}…`}
              </span>
              {uploadState === "uploading" && <span>{uploadProgress}%</span>}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{
                  width:
                    uploadState === "confirming" ? "100%" : `${uploadProgress}%`,
                }}
              />
            </div>
          </div>
        )}

        {uploadState === "error" && uploadError && (
          <p className="mt-1 text-sm text-red-600">{uploadError}</p>
        )}

        {uploadState === "done" && (
          <p className="mt-1 text-sm text-green-700">Clip uploaded successfully.</p>
        )}

        {/* Platform dimension warnings */}
        {uploadState === "done" && dimensionWarnings.length > 0 && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5">
            <p className="text-xs font-semibold text-amber-800">
              Dimension mismatch detected
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              Clip is{" "}
              {clipDimensions
                ? `${clipDimensions.width}×${clipDimensions.height}`
                : "an unexpected size"}
              . The following platforms may not display it correctly:
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {dimensionWarnings.map((w) => (
                <li key={w.platformLabel} className="text-xs text-amber-800">
                  · <strong>{w.platformLabel}</strong> — expected {w.expectedRatio}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Accepted: MP4 only · Max 150 MB · Max 30 seconds
      </p>
    </div>
  );
}
