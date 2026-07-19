"use client";

import { useState, useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { GoogleMapLocationPicker } from "@/features/requests/components/GoogleMapLocationPicker";
import { NativeMediaPicker } from "@/features/requests/components/NativeMediaPicker";

interface PendingFile {
  id: string;
  file: File;
  error?: string;
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
      video.preload = "metadata";
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
    } catch {
      resolve(null);
    }
  });
}

type SubmitPhase = "form" | "submitting";

export function NewRequestForm({ creditBalance, trialAvailable = false, imageOnly = false, creditCost, onCreditParamsChange }: NewRequestFormProps) {
  const COST = creditCost ?? CREDITS_CONFIG.REQUEST_COST_CREDITS;
  const acceptedTypes = imageOnly ? ACCEPTED_IMAGE_MIME_TYPES : ACCEPTED_MIME_TYPES;

  const router = useRouter();
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [phase, setPhase] = useState<SubmitPhase>("form");
  const [mapOpen, setMapOpen] = useState(false);

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
      targetPlatforms: [Platform.TventApp] as SubmitClipRequestValues["targetPlatforms"],
      durationSeconds: PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS,
      creditConfirmed: undefined,
      rightsConfirmed: undefined,
    },
  });

  const watchedPlatforms = watch("targetPlatforms") ?? [];
  const watchedDuration = watch("durationSeconds") ?? PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS;
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
        void generateVideoThumbnail(item.file).then((thumb) => {
          if (thumb) setPreviews((prev) => ({ ...prev, [item.id]: thumb }));
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
  const onSubmit = async (data: SubmitClipRequestValues) => {
    setSubmitError(null);

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

      const requestRes = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          creditConfirmed: true,
          rightsConfirmed: true,
        }),
      });

      if (!requestRes.ok) {
        const body = await requestRes.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถสร้างคำขอได้");
      }

      const { requestId } = await requestRes.json();

      const failedUploads: string[] = [];
      for (const item of pendingFiles.filter((f) => !f.error)) {
        const metaRes = await fetch(`/api/uploads/${requestId}`, {
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
          failedUploads.push(`${item.file.name} (${body.error ?? `error ${metaRes.status}`})`);
          continue;
        }

        const { assetId, presignedUrl } = await metaRes.json();

        const uploadRes = await fetch(presignedUrl, {
          method: "PUT",
          headers: { "Content-Type": item.file.type },
          body: item.file,
        });
        if (!uploadRes.ok) {
          failedUploads.push(`${item.file.name} (อัปโหลดไม่สำเร็จ)`);
          continue;
        }

        // Reuse the poster frame already captured for the preview grid (a
        // data: URL for videos) so the clip's thumbnail is stored on cloud at
        // upload — no dependency on server-side ffmpeg.
        const poster = previews[item.id];
        const posterDataUrl =
          typeof poster === "string" && poster.startsWith("data:image/") ? poster : undefined;

        const confirmRes = await fetch(`/api/uploads/${requestId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId, posterDataUrl }),
        });
        if (!confirmRes.ok) {
          const body = await confirmRes.json().catch(() => ({}));
          failedUploads.push(`${item.file.name} (${body.error ?? "ยืนยันไฟล์ไม่สำเร็จ"})`);
        }
      }

      // Surface any rejected files instead of silently dropping them, so the
      // requester knows which media did not make it into the request.
      if (failedUploads.length > 0) {
        setPhase("form");
        setSubmitError(
          `ไฟล์เหล่านี้อัปโหลดไม่สำเร็จและจะไม่ถูกใช้ในวิดีโอ: ${failedUploads.join(" · ")}`
        );
        return;
      }

      const submitRes = await fetch(`/api/requests/${requestId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditConfirmed: true, rightsConfirmed: true }),
      });

      if (!submitRes.ok) {
        const body = await submitRes.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถส่งคำขอได้");
      }

      router.push(requestDetailPath(requestId));
    } catch (err) {
      setPhase("form");
      setSubmitError(
        err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง"
      );
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

      {/* Section 1 — เกี่ยวกับคลิปของคุณ */}
      <fieldset className="rounded-xl border border-slate-200 bg-white p-6">
        <legend className="mb-5 text-base font-semibold text-slate-900 px-1">
          เกี่ยวกับคลิปของคุณ
        </legend>
        <div className="flex flex-col gap-5">
          <Input
            label="ชื่อคลิป"
            placeholder="เช่น โปรโมชั่นซัมเมอร์ — กรกฎาคม 2026"
            hint="ตั้งชื่อคลิปที่สั้นและสื่อความหมาย"
            {...register("title")}
            error={errors.title?.message}
          />

          <div>
            <Input
              label="ชื่อสถานที่"
              placeholder="เช่น เฝอ 54"
              hint="ระบบจะเก็บชื่อนี้ไว้ทั้งคำเพื่อไม่ให้ถูกตัดแยกในคำบรรยาย"
              {...register("placeName")}
              error={errors.placeName?.message}
            />
            <input type="hidden" {...register("latitude", { valueAsNumber: true })} />
            <input type="hidden" {...register("longitude", { valueAsNumber: true })} />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={() => setMapOpen(true)}>
                เลือกตำแหน่งบนแผนที่
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
            label="รายละเอียดคลิป"
            placeholder="อธิบายสิ่งที่ต้องการโปรโมทและข้อความหลักที่ต้องการสื่อ..."
            hint="อธิบายสั้นๆ ว่าต้องการโปรโมทอะไรและข้อความหลักที่ต้องการสื่อ"
            rows={4}
            {...register("description")}
            error={errors.description?.message}
          />

          {/* Duration slider */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">
                ความยาววิดีโอ <span className="text-red-500">*</span>
              </label>
              <span className="rounded-full bg-blue-600 px-3 py-0.5 text-sm font-bold text-white tabular-nums">
                {watchedDuration} วินาที
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
              <span>{PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS} วินาที</span>
              <span>{PIPELINE_STEP_COSTS.MAX_DURATION_SECONDS} วินาที</span>
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
          ไฟล์ต้นฉบับ
          <span className="ml-2 text-xs font-normal text-slate-400">
            (ไม่บังคับ สูงสุด {MAX_UPLOAD_COUNT} ไฟล์)
          </span>
        </legend>

        {/* Retention notice */}
        <div className="mb-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">
            <strong className="text-slate-600">หมายเหตุการจัดเก็บ:</strong> ไฟล์ต้นฉบับที่อัพโหลดใช้สำหรับคำขอนี้เท่านั้น
            และจะถูกลบหลังจาก 90 วันตามนโยบายการจัดเก็บข้อมูลของเรา
          </p>
        </div>

        <NativeMediaPicker
          disabled={pendingFiles.length >= MAX_UPLOAD_COUNT}
          onFiles={addFiles}
        />

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
                  {previews[item.id] ? (
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
          ก่อนส่งคำขอ
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
                ฉันยืนยันว่าเป็นเจ้าของหรือได้รับสิทธิ์และการอนุญาตที่จำเป็นสำหรับไฟล์
                บุคคล เสียง เพลง เครื่องหมายการค้า ข้อความ ชื่อสถานที่
                ตำแหน่งที่เลือก และเนื้อหาที่อัพโหลดหรือกรอกในคำขอ และยอมรับ{" "}
                <Link
                  href={ROUTES.TERMS}
                  target="_blank"
                  className="text-blue-600 underline hover:text-blue-800"
                  onClick={(e) => e.stopPropagation()}
                >
                  ข้อกำหนดและเงื่อนไขของ RClipper
                </Link>{" "}
                และ{" "}
                <Link
                  href={ROUTES.OWNERSHIP}
                  target="_blank"
                  className="text-blue-600 underline hover:text-blue-800"
                  onClick={(e) => e.stopPropagation()}
                >
                  นโยบายสิทธิ์ในเนื้อหา
                </Link>
                {" "}ซึ่งรวมถึงสิทธิ์ของ RClipper
                ในการคัดเลือกวิดีโอบางรายการ พร้อมข้อความ ชื่อสถานที่
                และตำแหน่งที่เกี่ยวข้อง เพื่อเผยแพร่หรือแสดงบนแอป Travy และเว็บไซต์ Travy.buzz
              </>
            }
            {...register("rightsConfirmed")}
            error={errors.rightsConfirmed?.message}
          />
        </div>
      </fieldset>

      {/* Submit error */}
      {submitError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{submitError}</p>
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
          {isDraftSaving ? "กำลังบันทึก..." : draftSaved ? "บันทึกแล้ว ✓" : "บันทึกแบบร่าง"}
        </button>

        <div className="flex gap-3">
          <Link href={ROUTES.REQUESTS}>
            <Button type="button" variant="outline">
              ยกเลิก
            </Button>
          </Link>
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={insufficientCredits || isSubmitting}
          >
            ส่งคำขอ
          </Button>
        </div>
      </div>

      <GoogleMapLocationPicker
        open={mapOpen}
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
