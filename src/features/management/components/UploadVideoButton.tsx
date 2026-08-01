"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

type Phase = "idle" | "starting" | "uploading" | "finishing";

/**
 * Bring-your-own-video uploader.
 *
 * Three steps, all client-driven so the big file never passes through the web
 * server:
 *   1. POST /api/management/uploads         → a presigned PUT URL + content id.
 *   2. PUT the file straight to Spaces.
 *   3. POST …/uploads/[id]/complete         → server HEADs the object and records it.
 *
 * Uploading is free (up to the slot limit); the server enforces the type, the
 * 300 MB cap, and the slot quota, so this only needs to guide the happy path.
 */
export function UploadVideoButton({
  maxMB,
  disabled,
}: {
  maxMB: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle";

  /** Best-effort dimensions/duration read from the file in the browser. */
  function probeMeta(
    f: File
  ): Promise<{ durationSeconds?: number; width?: number; height?: number }> {
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(f);
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => {
          const meta = {
            durationSeconds: Number.isFinite(v.duration)
              ? Math.max(1, Math.round(v.duration))
              : undefined,
            width: v.videoWidth || undefined,
            height: v.videoHeight || undefined,
          };
          URL.revokeObjectURL(url);
          resolve(meta);
        };
        v.onerror = () => {
          URL.revokeObjectURL(url);
          resolve({});
        };
        v.src = url;
      } catch {
        resolve({});
      }
    });
  }

  async function submit() {
    if (!file) {
      setError("Choose a video file first.");
      return;
    }
    if (file.size > maxMB * 1024 * 1024) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(0)} MB — the limit is ${maxMB} MB.`);
      return;
    }
    // Normalise exactly as the server does before presigning, so the PUT's
    // Content-Type matches the signature (a mismatch is rejected by Spaces).
    const mimeType = (file.type || "video/mp4").toLowerCase().split(";")[0].trim();
    setError(null);

    try {
      // 1. Ask the server for a presigned PUT.
      setPhase("starting");
      const beginRes = await fetch("/api/management/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || file.name,
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType,
        }),
      });
      const begin = await beginRes.json();
      if (!beginRes.ok) {
        setError(begin.error ?? "Could not start the upload.");
        setPhase("idle");
        return;
      }

      // 2. Upload straight to Spaces.
      setPhase("uploading");
      const put = await fetch(begin.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: file,
      });
      if (!put.ok) {
        setError("Upload to storage failed. Please try again.");
        setPhase("idle");
        return;
      }

      // 3. Confirm — the server verifies the object exists before recording it.
      setPhase("finishing");
      const meta = await probeMeta(file);
      const doneRes = await fetch(
        `/api/management/uploads/${begin.contentId}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storageKey: begin.storageKey,
            originalFilename: file.name,
            ...meta,
          }),
        }
      );
      if (!doneRes.ok) {
        const d = await doneRes.json().catch(() => ({}));
        setError(d.error ?? "Could not finalize the upload.");
        setPhase("idle");
        return;
      }

      // Done — reset and refresh the library.
      setOpen(false);
      setFile(null);
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      setPhase("idle");
      router.refresh();
    } catch {
      setError("Upload failed. Please try again.");
      setPhase("idle");
    }
  }

  if (disabled) {
    return (
      <Button size="sm" disabled>
        Upload video
      </Button>
    );
  }

  return (
    <div className="text-right">
      <Button size="sm" onClick={() => setOpen((o) => !o)}>
        Upload video
      </Button>

      {open && (
        <div className="mt-3 w-72 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm">
          <label className="block text-xs font-medium text-slate-600">
            Title (optional)
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekend promo"
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="mt-2 block text-xs font-medium text-slate-600">
            Video file (max {maxMB} MB)
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-xs"
            />
          </label>

          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={submit} loading={busy} disabled={busy}>
              {phase === "starting"
                ? "Starting…"
                : phase === "uploading"
                  ? "Uploading…"
                  : phase === "finishing"
                    ? "Finishing…"
                    : "Start upload"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
