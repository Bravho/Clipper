"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  submitClipRequestSchema,
  SubmitClipRequestValues,
  STYLE_OPTIONS,
} from "@/features/requests/validation/clipRequestSchema";
import { FORM_PLATFORMS, PLATFORM_LABELS } from "@/domain/enums/Platform";
import {
  MAX_UPLOAD_COUNT,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  ACCEPTED_MIME_TYPES,
  ACCEPTED_VIDEO_MIME_TYPES,
} from "@/domain/enums/AssetType";
import { CREDITS_CONFIG } from "@/config/credits";
import { ROUTES, requestDetailPath } from "@/config/routes";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";

interface PendingFile {
  id: string;
  file: File;
  error?: string;
}

interface NewRequestFormProps {
  creditBalance: number;
}

const COST = CREDITS_CONFIG.REQUEST_COST_CREDITS;
const MAX_IMAGE_SIZE_MB = MAX_IMAGE_SIZE_BYTES / (1024 * 1024);
const MAX_VIDEO_SIZE_MB = MAX_VIDEO_SIZE_BYTES / (1024 * 1024);

export function NewRequestForm({ creditBalance }: NewRequestFormProps) {
  const router = useRouter();
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SubmitClipRequestValues>({
    resolver: zodResolver(submitClipRequestSchema),
    defaultValues: {
      targetPlatforms: [],
      preferredStyle: "",
      creditConfirmed: undefined,
      rightsConfirmed: undefined,
    },
  });

  // Radio — single platform stored as a one-item array for DB compatibility
  const watchedPlatforms = watch("targetPlatforms") ?? [];
  const selectedPlatform = watchedPlatforms[0] ?? null;

  const handlePlatformSelect = (platform: string) => {
    setValue(
      "targetPlatforms",
      [platform] as SubmitClipRequestValues["targetPlatforms"],
      { shouldValidate: true }
    );
  };

  // File handling
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
      const maxSize = isVideo ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
      const maxSizeMB = isVideo ? MAX_VIDEO_SIZE_MB : MAX_IMAGE_SIZE_MB;

      if (pendingFiles.length + files.indexOf(file) >= MAX_UPLOAD_COUNT) {
        error = `Maximum ${MAX_UPLOAD_COUNT} files allowed.`;
      } else if (file.size > maxSize) {
        error = `File exceeds ${maxSizeMB} MB limit.`;
      } else if (
        !ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number])
      ) {
        error = "Unsupported file type.";
      }

      return { id, file, error };
    });

    setPendingFiles((prev) => [...prev, ...newItems].slice(0, MAX_UPLOAD_COUNT));
  };

  const removeFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Save draft
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

  // Submit
  const onSubmit = async (data: SubmitClipRequestValues) => {
    setSubmitError(null);

    if (creditBalance < COST) {
      setSubmitError(
        `You need ${COST} credits to submit a request, but you only have ${creditBalance}.`
      );
      return;
    }

    if (pendingFiles.some((f) => f.error)) {
      setSubmitError("Please remove files with errors before submitting.");
      return;
    }

    try {
      // Step 1: Create the draft
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
        throw new Error(body.error ?? "Failed to create request.");
      }

      const { requestId } = await requestRes.json();

      // Step 2: Upload files (if any) via presigned URL flow
      for (const item of pendingFiles.filter((f) => !f.error)) {
        // 2a. Request a presigned PUT URL from the server
        const metaRes = await fetch(`/api/uploads/${requestId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: item.file.name,
            fileSizeBytes: item.file.size,
            mimeType: item.file.type,
          }),
        });
        if (!metaRes.ok) continue; // skip failed uploads — request proceeds without this file

        const { assetId, presignedUrl } = await metaRes.json();

        // 2b. PUT the file directly to DO Spaces (no server bandwidth used)
        const uploadRes = await fetch(presignedUrl, {
          method: "PUT",
          headers: { "Content-Type": item.file.type },
          body: item.file,
        });
        if (!uploadRes.ok) continue;

        // 2c. Confirm upload: server moves tmp/ → request_mat/ and records thumbnail key
        await fetch(`/api/uploads/${requestId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId }),
        });
      }

      // Step 3: Submit the draft
      const submitRes = await fetch(`/api/requests/${requestId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditConfirmed: true, rightsConfirmed: true }),
      });

      if (!submitRes.ok) {
        const body = await submitRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to submit request.");
      }

      router.push(requestDetailPath(requestId));
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
    }
  };

  const insufficientCredits = creditBalance < COST;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8">
      {/* Insufficient credits warning */}
      {insufficientCredits && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm font-medium text-yellow-800">
            You need {COST} credits to submit a request. Your current balance is{" "}
            {creditBalance} credits.
          </p>
          <p className="mt-1 text-sm text-yellow-700">
            Please contact support if you need additional credits.
          </p>
        </div>
      )}

      {/* Section 1 — About your clip */}
      <fieldset className="rounded-xl border border-slate-200 bg-white p-6">
        <legend className="mb-5 text-base font-semibold text-slate-900 px-1">
          About your clip
        </legend>
        <div className="flex flex-col gap-5">
          <Input
            label="Clip title"
            placeholder="e.g. Summer Sale Promo — July 2026"
            hint="Give your clip a short descriptive title."
            {...register("title")}
            error={errors.title?.message}
          />

          <Textarea
            label="Clip description"
            placeholder="Describe what you want the clip to promote and any key message you want included..."
            hint="Briefly describe what you want the clip to promote and any key message you want included."
            rows={4}
            {...register("description")}
            error={errors.description?.message}
          />

          <Input
            label="Target audience"
            placeholder="e.g. Young professionals aged 25–35 interested in productivity"
            hint="Who should this clip speak to?"
            {...register("targetAudience")}
            error={errors.targetAudience?.message}
          />
        </div>
      </fieldset>

      {/* Section 2 — Style & platform */}
      <fieldset className="rounded-xl border border-slate-200 bg-white p-6">
        <legend className="mb-5 text-base font-semibold text-slate-900 px-1">
          Style &amp; platform
        </legend>
        <div className="flex flex-col gap-5">

          {/* Target platform — radio (single select) */}
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">
              Target platform <span className="text-red-500">*</span>
            </p>
            <p className="mb-3 text-xs text-slate-500">
              Choose where this clip is intended to perform best.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FORM_PLATFORMS.map((platform) => {
                const isSelected = selectedPlatform === platform;
                return (
                  <label
                    key={platform}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                      isSelected
                        ? "border-blue-600 bg-blue-50 text-blue-800"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="targetPlatformRadio"
                      className="sr-only"
                      value={platform}
                      checked={isSelected}
                      onChange={() => handlePlatformSelect(platform)}
                    />
                    {/* Radio circle */}
                    <span
                      className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                        isSelected
                          ? "border-blue-600"
                          : "border-slate-300"
                      }`}
                    >
                      {isSelected && (
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
                      )}
                    </span>
                    {PLATFORM_LABELS[platform]}
                  </label>
                );
              })}
            </div>
            {errors.targetPlatforms && (
              <p className="mt-1.5 text-xs text-red-600" role="alert">
                {errors.targetPlatforms.message}
              </p>
            )}
          </div>

          <Select
            label="Preferred style"
            placeholder="Choose a style..."
            options={STYLE_OPTIONS}
            hint="Choose the overall tone or presentation style."
            {...register("preferredStyle")}
            error={errors.preferredStyle?.message}
          />
        </div>
      </fieldset>

      {/* Section 3 — Source files */}
      <fieldset className="rounded-xl border border-slate-200 bg-white p-6">
        <legend className="mb-2 text-base font-semibold text-slate-900 px-1">
          Source files
          <span className="ml-2 text-xs font-normal text-slate-400">
            (optional, up to {MAX_UPLOAD_COUNT} files)
          </span>
        </legend>

        {/* Retention notice */}
        <div className="mb-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">
            <strong className="text-slate-600">Storage notice:</strong> Uploaded source
            files are kept only for this request and are not maintained as a reusable
            asset library. Raw uploads are scheduled for deletion after 90 days under
            our storage policy.
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
            Drag &amp; drop files here, or{" "}
            <span className="text-blue-600 underline">browse</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Images up to {MAX_IMAGE_SIZE_MB} MB · Videos up to {MAX_VIDEO_SIZE_MB} MB · Up to{" "}
            {MAX_UPLOAD_COUNT} files
          </p>
          <input
            id="file-input"
            type="file"
            multiple
            accept={ACCEPTED_MIME_TYPES.join(",")}
            className="sr-only"
            onChange={handleFileInput}
          />
        </div>

        {/* File list */}
        {pendingFiles.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {pendingFiles.map((item) => (
              <li
                key={item.id}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                  item.error
                    ? "border border-red-200 bg-red-50"
                    : "border border-slate-200 bg-white"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-slate-800">{item.file.name}</p>
                  {item.error ? (
                    <p className="text-xs text-red-600">{item.error}</p>
                  ) : (
                    <p className="text-xs text-slate-400">
                      {(item.file.size / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(item.id)}
                  className="ml-3 text-xs text-slate-400 hover:text-red-600 flex-shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {/* Section 4 — Before you submit */}
      <fieldset className="rounded-xl border border-slate-200 bg-white p-6">
        <legend className="mb-5 text-base font-semibold text-slate-900 px-1">
          Before you submit
        </legend>

        {/* Credit cost reminder */}
        <div className="mb-5 rounded-lg border border-blue-100 bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-800">
            This request uses {COST} credits.
          </p>
          <p className="mt-0.5 text-sm text-blue-700">
            Your current balance: {creditBalance} credits. After submission:{" "}
            {creditBalance - COST} credits.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {/* Checkbox 1 — credit confirmation */}
          <Checkbox
            label={`I understand that submitting this request will use ${COST} credits from my account.`}
            {...register("creditConfirmed")}
            error={errors.creditConfirmed?.message}
          />

          {/* Checkbox 2 — rights + T&C + privacy (with inline links) */}
          <Checkbox
            label={
              <>
                I confirm that I have the right to submit the uploaded materials. I
                agree to the{" "}
                <Link
                  href={ROUTES.TERMS}
                  target="_blank"
                  className="text-blue-600 underline hover:text-blue-800"
                  onClick={(e) => e.stopPropagation()}
                >
                  terms and conditions
                </Link>{" "}
                and the{" "}
                <Link
                  href={ROUTES.PRIVACY}
                  target="_blank"
                  className="text-blue-600 underline hover:text-blue-800"
                  onClick={(e) => e.stopPropagation()}
                >
                  privacy policy
                </Link>
                , including the material rights.
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
          {isDraftSaving ? "Saving draft..." : draftSaved ? "Draft saved ✓" : "Save as draft"}
        </button>

        <div className="flex gap-3">
          <Link href={ROUTES.REQUESTS}>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={insufficientCredits || isSubmitting}
          >
            Submit Request
          </Button>
        </div>
      </div>
    </form>
  );
}
