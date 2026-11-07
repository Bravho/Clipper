"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CostConfirmDialog } from "./CostConfirmDialog";
import type { AdLabLookCreation, LookCreationStage } from "@/domain/models/AdLab";

// ---------------------------------------------------------------------------
// Types

interface AddTwinLookPanelProps {
  /** Avatar group (twin identity) to attach the new look to. */
  groupId: string;
  /** Display name of the group — used as the default look name prefix. */
  groupName: string;
  /** Persisted in-progress state, if any (survives reload). */
  lookCreation?: AdLabLookCreation;
  /** Called on every state change so the parent can persist to workspace JSON. */
  onUpdateLookCreation: (lc: AdLabLookCreation | null) => Promise<void>;
  /** Called when the new look has completed training. Parent should refresh looks. */
  onLookComplete: (lookId: string) => void;
  onDismiss: () => void;
}

const TWIN_MAX_BYTES = 209_715_200; // 200 MB
const TWIN_MIN_SEC = 15;
const TWIN_MAX_SEC = 600;
const PORTRAIT_WARNING_W = 1080;
const PORTRAIT_WARNING_H = 1920;
const POLL_INTERVAL_MS = 15_000;

// ---------------------------------------------------------------------------

export function AddTwinLookPanel({
  groupId,
  groupName,
  lookCreation,
  onUpdateLookCreation,
  onLookComplete,
  onDismiss,
}: AddTwinLookPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(lookCreation?.name ?? `${groupName} Portrait`);
  const [fileError, setFileError] = useState("");
  const [resolutionWarning, setResolutionWarning] = useState("");
  const [videoMeta, setVideoMeta] = useState<{ duration: number; width: number; height: number } | null>(null);
  const [costConfirmOpen, setCostConfirmOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // If there's a persisted creation, restore it
  const stage = lookCreation?.stage ?? null;
  const isActive =
    stage !== null &&
    stage !== "completed" &&
    stage !== "failed";
  const isPolling = stage === "awaiting_consent" || stage === "training";

  // ---------------------------------------------------------------------------
  // Polling effect

  useEffect(() => {
    if (!isPolling || !lookCreation) return;

    const { lookId, groupId: lcGroupId } = lookCreation;
    if (!lookId && !lcGroupId) return;

    async function pollOnce() {
      if (!lookCreation) return;
      const qs = new URLSearchParams();
      if (lookCreation.lookId) qs.set("lookId", lookCreation.lookId);
      if (lookCreation.groupId) qs.set("groupId", lookCreation.groupId);
      try {
        const res = await fetch(`/api/ad-lab/avatar/twins/status?${qs.toString()}`);
        const data = (await res.json()) as {
          lookStatus?: string;
          avatarV?: boolean;
          consentStatus?: string;
          error?: string;
        };

        const isCompleted =
          data.lookStatus === "completed" &&
          data.avatarV === true &&
          data.consentStatus === "accepted";
        const isFailed =
          data.lookStatus === "failed" ||
          data.consentStatus === "rejected" ||
          (!!data.error && data.lookStatus !== "processing" && data.lookStatus !== undefined);

        if (isCompleted || isFailed) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }

        const newStage: LookCreationStage = isCompleted
          ? "completed"
          : isFailed
          ? "failed"
          : data.lookStatus === "processing"
          ? "training"
          : lookCreation.stage;

        if (newStage !== lookCreation.stage || isFailed) {
          await onUpdateLookCreation({
            ...lookCreation,
            stage: newStage,
            ...(data.error ? { error: data.error } : {}),
          });
        }

        if (isCompleted && lookCreation.lookId) {
          onLookComplete(lookCreation.lookId);
        }
      } catch {
        // Silently skip failed polls
      }
    }

    void pollOnce();
    pollingRef.current = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPolling, lookCreation?.stage, lookCreation?.lookId, lookCreation?.groupId]);

  // ---------------------------------------------------------------------------
  // File selection

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setFileError("");
    setResolutionWarning("");
    setVideoMeta(null);
    if (!f) return;

    const ct = f.type.toLowerCase();
    if (ct !== "video/mp4" && ct !== "video/webm") {
      setFileError("รองรับเฉพาะ MP4 และ WebM");
      return;
    }
    if (f.size > TWIN_MAX_BYTES) {
      setFileError(`ไฟล์ใหญ่เกิน ${Math.round(TWIN_MAX_BYTES / 1024 / 1024)} MB`);
      return;
    }

    const url = URL.createObjectURL(f);
    const vid = document.createElement("video");
    vid.preload = "metadata";
    vid.onloadedmetadata = () => {
      const dur = vid.duration;
      const w = vid.videoWidth;
      const h = vid.videoHeight;
      URL.revokeObjectURL(url);
      setVideoMeta({ duration: dur, width: w, height: h });

      if (dur < TWIN_MIN_SEC || dur > TWIN_MAX_SEC) {
        setFileError(
          `ความยาวคลิปต้องอยู่ระหว่าง ${TWIN_MIN_SEC}–${TWIN_MAX_SEC} วินาที (คลิปนี้ ~${Math.round(dur)} วิ)`
        );
        return;
      }
      if (h <= w) {
        setFileError("วิดีโอต้องเป็นแนวตั้ง (portrait): ความสูงต้องมากกว่าความกว้าง");
        return;
      }
      if (w !== PORTRAIT_WARNING_W || h !== PORTRAIT_WARNING_H) {
        setResolutionWarning(
          `⚠ ความละเอียด ${w}×${h} ไม่ใช่ 1080×1920 — แนะนำ 1080×1920 เพื่อคุณภาพสูงสุด`
        );
      }
    };
    vid.onerror = () => {
      URL.revokeObjectURL(url);
      setFileError("ไม่สามารถอ่านข้อมูลวิดีโอได้");
    };
    vid.src = url;
  }

  // ---------------------------------------------------------------------------
  // Creation flow

  async function handleCreate() {
    if (!file || !name.trim() || fileError) return;
    setError("");
    setProgress(0);
    setCostConfirmOpen(false);

    const idempotencyKey = crypto.randomUUID();
    const now = new Date().toISOString();
    const initLc: AdLabLookCreation = {
      idempotencyKey,
      name: name.trim(),
      stage: "uploading",
      groupId,
      createdAt: now,
    };
    await onUpdateLookCreation(initLc);

    try {
      // Step 1: get pre-signed upload URL
      const initRes = await fetch("/api/ad-lab/avatar/twins/upload-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          durationSec: videoMeta?.duration,
        }),
      });
      const initData = (await initRes.json()) as {
        assetId?: string;
        uploadUrl?: string;
        uploadHeaders?: Record<string, string>;
        error?: string;
        reason?: string;
      };
      if (!initRes.ok || !initData.assetId || !initData.uploadUrl) {
        const msg = initData.error ?? initData.reason ?? "เริ่มต้นอัปโหลดไม่สำเร็จ";
        setError(msg);
        await onUpdateLookCreation({ ...initLc, stage: "failed", error: msg });
        return;
      }

      let currentAssetId = initData.assetId;
      const { uploadUrl, uploadHeaders = {} } = initData;

      await onUpdateLookCreation({ ...initLc, assetId: currentAssetId });

      // Step 2: browser PUT directly to pre-signed URL, fallback to proxy
      const directResult = await new Promise<"ok" | string>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve("ok") : resolve(`http:${xhr.status}`));
        xhr.onerror = () => resolve("network_error");
        xhr.open("PUT", uploadUrl);
        Object.entries(uploadHeaders).forEach(([k, v]) => xhr.setRequestHeader(k, v));
        xhr.send(file);
      });

      if (directResult !== "ok") {
        setError("ไม่สามารถอัปโหลดโดยตรงได้ กำลังใช้เส้นทางสำรอง (proxy)… กรุณารอสักครู่");
        const qs = new URLSearchParams({
          fileName: file.name,
          contentType: file.type,
          sizeBytes: String(file.size),
          ...(videoMeta?.duration != null ? { durationSec: String(Math.round(videoMeta.duration)) } : {}),
        });
        const proxyRes = await fetch(`/api/ad-lab/avatar/twins/upload-proxy?${qs.toString()}`, {
          method: "POST",
          body: file,
        });
        const proxyData = (await proxyRes.json().catch(() => ({}))) as {
          assetId?: string;
          error?: string;
          reason?: string;
        };
        if (!proxyRes.ok || !proxyData.assetId) {
          throw new Error(proxyData.error ?? proxyData.reason ?? "อัปโหลดผ่าน proxy ไม่สำเร็จ");
        }
        currentAssetId = proxyData.assetId;
        setError("");
        await onUpdateLookCreation({ ...initLc, assetId: currentAssetId });
      }

      setProgress(100);

      // Step 3: mark upload complete
      const completeRes = await fetch("/api/ad-lab/avatar/twins/upload-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: currentAssetId }),
      });
      if (!completeRes.ok) {
        const cd = (await completeRes.json()) as { error?: string };
        const msg = cd.error ?? "ยืนยันการอัปโหลดไม่สำเร็จ";
        setError(msg);
        await onUpdateLookCreation({ ...initLc, assetId: currentAssetId, stage: "failed", error: msg });
        return;
      }
      await onUpdateLookCreation({ ...initLc, assetId: currentAssetId, stage: "upload_complete" });

      // Step 4: create the new look attached to the existing group
      await onUpdateLookCreation({ ...initLc, assetId: currentAssetId, stage: "creating" });
      const createRes = await fetch("/api/ad-lab/avatar/twins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          assetId: currentAssetId,
          idempotencyKey,
          confirmCost: true,
          avatarGroupId: groupId,
          clientDurationSec: videoMeta ? Math.round(videoMeta.duration) : undefined,
          clientWidth: videoMeta?.width,
          clientHeight: videoMeta?.height,
        }),
      });
      const createData = (await createRes.json()) as {
        lookId?: string;
        groupId?: string;
        defaultVoiceId?: string;
        error?: string;
        reason?: string;
      };
      if (!createRes.ok || !createData.lookId || !createData.groupId) {
        const msg = createData.error ?? createData.reason ?? "สร้าง Look ไม่สำเร็จ";
        setError(msg);
        await onUpdateLookCreation({ ...initLc, assetId: currentAssetId, stage: "failed", error: msg });
        return;
      }

      const newLookId = createData.lookId;
      const resolvedGroupId = createData.groupId;

      await onUpdateLookCreation({
        ...initLc,
        assetId: currentAssetId,
        stage: "awaiting_consent",
        lookId: newLookId,
        groupId: resolvedGroupId,
      });

      // Step 5: request consent URL (400 = already accepted → skip)
      const consentRes = await fetch(
        `/api/ad-lab/avatar/twins/${encodeURIComponent(resolvedGroupId)}/consent`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
      );
      const consentData = (await consentRes.json()) as {
        url?: string;
        consentStatus?: string;
        error?: string;
        reason?: string;
      };

      const consentUrl = consentData.url;
      const consentUrlAt = consentUrl ? new Date().toISOString() : undefined;
      await onUpdateLookCreation({
        ...initLc,
        assetId: currentAssetId,
        stage: "awaiting_consent",
        lookId: newLookId,
        groupId: resolvedGroupId,
        ...(consentUrl ? { consentUrl, consentUrlAt } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      await onUpdateLookCreation({
        ...(lookCreation ?? {
          idempotencyKey,
          name: name.trim(),
          groupId,
          createdAt: now,
        }),
        stage: "failed",
        error: msg,
      });
    }
  }

  async function handleRefreshConsent() {
    if (!lookCreation?.groupId) return;
    setError("");
    const res = await fetch(
      `/api/ad-lab/avatar/twins/${encodeURIComponent(lookCreation.groupId)}/consent`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
    );
    const data = (await res.json()) as { url?: string; error?: string; reason?: string };
    if (res.ok && data.url) {
      await onUpdateLookCreation({
        ...lookCreation,
        consentUrl: data.url,
        consentUrlAt: new Date().toISOString(),
      });
    } else {
      setError(data.error ?? data.reason ?? "ขอลิงก์ใหม่ไม่สำเร็จ");
    }
  }

  // ---------------------------------------------------------------------------
  // Render: active creation in progress (persisted state)

  if (lookCreation && isActive) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-blue-900">เพิ่ม Look แนวตั้ง: {lookCreation.name}</p>
          <button
            type="button"
            onClick={() => void onUpdateLookCreation(null).then(onDismiss)}
            className="text-xs text-slate-500 hover:underline"
          >
            ยกเลิก
          </button>
        </div>

        <div className="text-xs text-slate-600 space-y-1">
          <p>
            สถานะ:{" "}
            {lookCreation.stage === "uploading" && "กำลังอัปโหลดวิดีโอ…"}
            {lookCreation.stage === "upload_complete" && "อัปโหลดเสร็จแล้ว"}
            {lookCreation.stage === "creating" && "กำลังส่งข้อมูลไปยัง HeyGen…"}
            {lookCreation.stage === "awaiting_consent" && "รอการยืนยันตัวตน (Consent)"}
            {lookCreation.stage === "training" && "HeyGen กำลัง Training Look ใหม่…"}
          </p>
          {lookCreation.lookId && (
            <p className="font-mono text-slate-400">Look ID: {lookCreation.lookId}</p>
          )}
        </div>

        {lookCreation.stage === "awaiting_consent" && (
          <div className="space-y-2">
            {lookCreation.consentUrl ? (
              <a
                href={lookCreation.consentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                เปิดลิงก์ยืนยันตัวตน →
              </a>
            ) : (
              <p className="text-xs text-amber-700">ไม่มี Consent URL — กลุ่มนี้อาจยืนยันตัวตนแล้ว</p>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleRefreshConsent}>
                ขอลิงก์ใหม่
              </Button>
            </div>
          </div>
        )}

        {lookCreation.stage === "training" && (
          <p className="text-xs text-slate-500">กำลัง poll สถานะทุก 15 วินาที…</p>
        )}

        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  if (lookCreation?.stage === "completed") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
        <p className="text-sm font-semibold text-emerald-800">✓ Look แนวตั้งสร้างเสร็จแล้ว!</p>
        <p className="text-xs text-slate-600">Look ID: <span className="font-mono">{lookCreation.lookId}</span></p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void onUpdateLookCreation(null).then(onDismiss)}
        >
          ปิด
        </Button>
      </div>
    );
  }

  if (lookCreation?.stage === "failed") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
        <p className="text-sm font-semibold text-red-800">สร้าง Look ไม่สำเร็จ</p>
        {lookCreation.error && <p className="text-xs text-red-700">{lookCreation.error}</p>}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void onUpdateLookCreation(null).then(onDismiss)}
        >
          ปิดและลองใหม่
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: form

  const canCreate = !!file && !fileError && !!name.trim();

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">เพิ่ม Look แนวตั้งให้ Twin นี้</p>
          <p className="text-xs text-slate-500 mt-0.5">
            กลุ่ม: <span className="font-mono">{groupId}</span>
          </p>
        </div>
        <button type="button" onClick={onDismiss} className="text-xs text-slate-400 hover:underline shrink-0">
          ยกเลิก
        </button>
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-slate-700">วิดีโอ (MP4/WebM, แนวตั้ง, ≤200MB, 15–600 วิ)</label>
        <input
          type="file"
          accept="video/mp4,video/webm"
          onChange={handleFileChange}
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-blue-700 hover:file:bg-blue-100"
        />
        {fileError && <p role="alert" className="text-xs text-red-600">{fileError}</p>}
        {resolutionWarning && <p className="text-xs text-amber-600">{resolutionWarning}</p>}
        {videoMeta && !fileError && (
          <p className="text-xs text-slate-500">
            {videoMeta.width}×{videoMeta.height} · {Math.round(videoMeta.duration)} วิ
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-slate-700">ชื่อ Look ใหม่</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={`${groupName} Portrait`}
        />
      </div>

      {progress > 0 && progress < 100 && (
        <div className="space-y-1">
          <div className="h-2 w-full rounded-full bg-slate-200">
            <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-slate-500">{progress}%</p>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="text-xs text-slate-500 rounded bg-amber-50 border border-amber-200 px-3 py-2">
        ค่าใช้จ่ายโดยประมาณ ~$2.13 USD (ข้อมูลจาก sume.com — ยังไม่ได้รับการยืนยันจาก HeyGen โดยตรง)
      </div>

      <Button
        type="button"
        disabled={!canCreate}
        onClick={() => setCostConfirmOpen(true)}
      >
        เพิ่ม Look แนวตั้ง
      </Button>

      <CostConfirmDialog
        open={costConfirmOpen}
        title="ยืนยันการสร้าง Look แนวตั้ง"
        lines={[
          `Twin: ${groupName}`,
          `Look ใหม่: ${name.trim() || "(ไม่มีชื่อ)"}`,
          "ค่าใช้จ่ายโดยประมาณ: ~$2.13 USD",
          "(ราคาจากแหล่งข้อมูล sume.com — ยังไม่ได้รับการยืนยันอย่างเป็นทางการ)",
        ]}
        confirmLabel="ยืนยัน — สร้าง Look"
        onConfirm={() => void handleCreate()}
        onCancel={() => setCostConfirmOpen(false)}
      />
    </div>
  );
}
