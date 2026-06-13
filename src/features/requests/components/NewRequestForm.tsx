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
  ACCEPTED_MIME_TYPES,
  ACCEPTED_IMAGE_MIME_TYPES,
  ACCEPTED_VIDEO_MIME_TYPES,
} from "@/domain/enums/AssetType";
import { CREDITS_CONFIG, PIPELINE_STEP_COSTS, calcPipelineCost } from "@/config/credits";
import { ROUTES, requestDetailPath } from "@/config/routes";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import type { ChatGptContentOutput } from "@/lib/ai/chatGptVisionService";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

interface PendingFile {
  id: string;
  file: File;
  error?: string;
}

interface NewRequestFormProps {
  creditBalance: number;
  /** When true, only image uploads are accepted (no video files). */
  imageOnly?: boolean;
  /** Override the credit cost shown and validated. Defaults to REQUEST_COST_CREDITS. */
  creditCost?: number;
  /** Called whenever duration or platform count changes so parent can update the pipeline estimate. */
  onCreditParamsChange?: (durationSeconds: number, platformCount: number) => void;
}

const MAX_IMAGE_SIZE_MB = MAX_IMAGE_SIZE_BYTES / (1024 * 1024);
const MAX_VIDEO_SIZE_MB = MAX_VIDEO_SIZE_BYTES / (1024 * 1024);

type SubmitPhase = "form" | "analyzing" | "results" | "starting";

export function NewRequestForm({ creditBalance, imageOnly = false, creditCost, onCreditParamsChange }: NewRequestFormProps) {
  const COST = creditCost ?? CREDITS_CONFIG.REQUEST_COST_CREDITS;
  const acceptedTypes = imageOnly ? ACCEPTED_IMAGE_MIME_TYPES : ACCEPTED_MIME_TYPES;

  const router = useRouter();
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [phase, setPhase] = useState<SubmitPhase>("form");
  const [submittedRequestId, setSubmittedRequestId] = useState<string | null>(null);
  const [editedResult, setEditedResult] = useState<ChatGptContentOutput | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const updateResultField = (field: string, value: string) => {
    setEditedResult((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const updateScene = (index: number, field: string, value: string) => {
    setEditedResult((prev) => {
      if (!prev) return prev;
      const updated = prev.scenePlan.map((s, i) =>
        i === index ? { ...s, [field]: value } : s
      );
      return { ...prev, scenePlan: updated };
    });
  };

  const {
    register,
    handleSubmit,
    watch,
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
      }

      return { id, file, error };
    });

    setPendingFiles((prev) => [...prev, ...newItems].slice(0, MAX_UPLOAD_COUNT));
  };

  const removeFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Generate/revoke thumbnail object URLs as the pending file list changes.
  useEffect(() => {
    setPreviews((prev) => {
      const next: Record<string, string> = {};
      for (const item of pendingFiles) {
        if (item.file.type.startsWith("image/")) {
          next[item.id] = prev[item.id] ?? URL.createObjectURL(item.file);
        }
      }
      for (const [id, url] of Object.entries(prev)) {
        if (!(id in next)) URL.revokeObjectURL(url);
      }
      return next;
    });
  }, [pendingFiles]);

  useEffect(() => {
    return () => {
      Object.values(previews).forEach((url) => URL.revokeObjectURL(url));
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

  const handleApproveAndStart = async () => {
    if (!submittedRequestId || !editedResult) return;
    setStartError(null);
    setPhase("starting");
    try {
      const res = await fetch(`/api/requests/${submittedRequestId}/start-production`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editedResult),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถเริ่มสร้างวิดีโอได้");
      }
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
      setPhase("results");
      return;
    }
    router.push(requestDetailPath(submittedRequestId));
  };

  const onSubmit = async (data: SubmitClipRequestValues) => {
    setSubmitError(null);

    if (creditBalance < COST) {
      setSubmitError(
        `คุณต้องการ ${COST} เครดิตสำหรับขั้นตอนแรก แต่ปัจจุบันมีเพียง ${creditBalance} เครดิต`
      );
      return;
    }

    if (pendingFiles.some((f) => f.error)) {
      setSubmitError("กรุณาลบไฟล์ที่มีข้อผิดพลาดออกก่อนส่งคำขอ");
      return;
    }

    try {
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
        if (!metaRes.ok) continue;

        const { assetId, presignedUrl } = await metaRes.json();

        const uploadRes = await fetch(presignedUrl, {
          method: "PUT",
          headers: { "Content-Type": item.file.type },
          body: item.file,
        });
        if (!uploadRes.ok) continue;

        await fetch(`/api/uploads/${requestId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId }),
        });
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

      // Request submitted — now call AI analysis
      setSubmittedRequestId(requestId);
      setPhase("analyzing");

      try {
        const analyzeRes = await fetch(`/api/requests/${requestId}/analyze`, {
          method: "POST",
        });
        if (analyzeRes.ok) {
          const { analysis } = await analyzeRes.json();
          setEditedResult(analysis);
          setPhase("results");
        } else {
          // AI failed — still navigate to detail page
          router.push(requestDetailPath(requestId));
        }
      } catch {
        router.push(requestDetailPath(requestId));
      }
    } catch (err) {
      setPhase("form");
      setSubmitError(
        err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง"
      );
    }
  };

  const insufficientCredits = creditBalance < COST;

  if (phase === "analyzing") {
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

  if (phase === "starting") {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
        <div>
          <p className="text-lg font-semibold text-slate-800">
            กำลังเริ่มสร้างวิดีโอ
          </p>
          <p className="mt-1 text-sm text-slate-500">
            ส่งแผนฉากไปยัง Kling AI — จะนำคุณไปยังหน้าติดตามสถานะในอีกสักครู่
          </p>
        </div>
      </div>
    );
  }

  if (phase === "results" && editedResult && submittedRequestId) {
    return (
      <div className="flex flex-col gap-6">
        {/* Success banner */}
        <div className="rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-800">AI วิเคราะห์เสร็จแล้ว</p>
          <p className="mt-0.5 text-sm text-green-700">
            ตรวจสอบและแก้ไขแผนฉาก บทพูด และแคปชั่นด้านล่างได้เลย เมื่อพร้อมแล้วคลิก "อนุมัติและสร้างวิดีโอ"
          </p>
        </div>

        {/* Theme */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="mb-2 text-sm font-semibold text-slate-500 uppercase tracking-wide">
            ธีมและสไตล์
          </h3>
          <textarea
            value={editedResult.theme}
            onChange={(e) => updateResultField("theme", e.target.value)}
            rows={2}
            className="w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        </div>

        {/* Hook */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-500 uppercase tracking-wide">
            ฮุค (3 วินาทีแรก)
          </h3>
          <div className="flex flex-col gap-2">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">ภาษาไทย</p>
              <textarea
                value={editedResult.hookThai}
                onChange={(e) => updateResultField("hookThai", e.target.value)}
                rows={2}
                className="w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>
          </div>
        </div>

        {/* Scene plan */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="mb-4 text-sm font-semibold text-slate-500 uppercase tracking-wide">
            แผนฉาก
          </h3>
          <div className="flex flex-col gap-3">
            {editedResult.scenePlan.map((scene: ScenePlan, index: number) => (
              <div
                key={scene.sceneNumber}
                className="rounded-lg border border-slate-100 bg-slate-50 p-4"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                    ฉาก {scene.sceneNumber}
                  </span>
                  <span className="text-xs text-slate-400">{scene.durationSeconds} วินาที</span>
                </div>
                <div className="flex flex-col gap-2">
                  <div>
                    <p className="mb-1 text-xs font-medium text-slate-400">คำอธิบายภาพ (ไทย)</p>
                    <textarea
                      value={scene.visualDescriptionThai ?? ""}
                      onChange={(e) => updateScene(index, "visualDescriptionThai", e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Script */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-500 uppercase tracking-wide">
            บทพูด
          </h3>
          <div className="flex flex-col gap-2">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">ภาษาไทย</p>
              <textarea
                value={editedResult.scriptThai}
                onChange={(e) => updateResultField("scriptThai", e.target.value)}
                rows={4}
                className="w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>
          </div>
        </div>

        {/* Captions */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-500 uppercase tracking-wide">
            แคปชั่นโซเชียล
          </h3>
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">ภาษาไทย</p>
              <textarea
                value={editedResult.captionThai}
                onChange={(e) => updateResultField("captionThai", e.target.value)}
                rows={3}
                className="w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>
          </div>
        </div>

        {/* Start error */}
        {startError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-700">{startError}</p>
          </div>
        )}

        {/* Action */}
        <div className="flex items-center justify-between pb-4">
          <button
            type="button"
            onClick={() => router.push(requestDetailPath(submittedRequestId))}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            ดูรายละเอียดคำขอ
          </button>
          <Button onClick={handleApproveAndStart}>
            อนุมัติและสร้างวิดีโอ →
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8">
      {/* Insufficient credits warning */}
      {insufficientCredits && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm font-medium text-yellow-800">
            คุณต้องการ {COST} เครดิตสำหรับขั้นตอนแรก ปัจจุบันมีเพียง {creditBalance} เครดิต
          </p>
          <p className="mt-1 text-sm text-yellow-700">
            กรุณาติดต่อฝ่ายสนับสนุนหากต้องการเครดิตเพิ่มเติม
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
              : `รูปภาพสูงสุด ${MAX_IMAGE_SIZE_MB} MB · วิดีโอสูงสุด ${MAX_VIDEO_SIZE_MB} MB · สูงสุด ${MAX_UPLOAD_COUNT} ไฟล์`}
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

        {/* Credit cost reminder */}
        {(() => {
          const estimate = calcPipelineCost(
            typeof watchedDuration === "number" && !isNaN(watchedDuration)
              ? watchedDuration
              : PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS,
            (watchedPlatforms as Platform[]).length || PIPELINE_STEP_COSTS.RESIZE_FREE_CHANNELS
          );
          return (
            <div className="mb-5 rounded-lg border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-blue-800">
                    ขั้นตอนแรกใช้ {COST} เครดิต
                  </p>
                  <p className="mt-0.5 text-sm text-blue-700">
                    เครดิตปัจจุบัน: {creditBalance} เครดิต · หลังขั้นตอนแรก: {creditBalance - COST} เครดิต
                  </p>
                  <p className="mt-0.5 text-xs text-blue-600">
                    เครดิตขั้นตอนถัดไปจะถูกหักเมื่อแต่ละขั้นตอนเริ่มทำงาน
                  </p>
                </div>
                <div className="flex-shrink-0 rounded-lg border border-blue-200 bg-white px-3 py-2 text-right">
                  <p className="text-xs text-slate-400">ประมาณการรวม</p>
                  <p className="text-lg font-bold text-blue-700 tabular-nums">{estimate.total}</p>
                  <p className="text-xs text-slate-400">เครดิต</p>
                </div>
              </div>
            </div>
          );
        })()}

        <div className="flex flex-col gap-4">
          <Checkbox
            label={`ฉันเข้าใจว่าขั้นตอนแรกจะใช้ ${COST} เครดิต และขั้นตอนถัดไปจะถูกหักเครดิตตามอัตราจริงเมื่อแต่ละขั้นตอนเริ่มทำงาน`}
            {...register("creditConfirmed")}
            error={errors.creditConfirmed?.message}
          />

          <Checkbox
            label={
              <>
                ฉันยืนยันว่ามีสิทธิ์ในการส่งไฟล์ที่อัพโหลด และยอมรับ{" "}
                <Link
                  href={ROUTES.TERMS}
                  target="_blank"
                  className="text-blue-600 underline hover:text-blue-800"
                  onClick={(e) => e.stopPropagation()}
                >
                  ข้อกำหนดการใช้งาน
                </Link>{" "}
                และ{" "}
                <Link
                  href={ROUTES.PRIVACY}
                  target="_blank"
                  className="text-blue-600 underline hover:text-blue-800"
                  onClick={(e) => e.stopPropagation()}
                >
                  นโยบายความเป็นส่วนตัว
                </Link>
                รวมถึงสิทธิ์ในเนื้อหา
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
    </form>
  );
}
