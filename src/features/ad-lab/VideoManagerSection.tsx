"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import type { AdLabAvatarVideoEntry, AdLabAvatarVideoStatus, AdLabVideoKind, AdLabVideoVoiceSource } from "@/domain/models/AdLab";
import { settingsSummary } from "@/config/heygenVideoOptions";
import { useAvatarJobPolling, type AvatarPollingUpdate } from "./useAvatarJobPolling";
import { CostConfirmDialog } from "./CostConfirmDialog";
import { HEYGEN_AVATAR_V_DIGITAL_TWIN_USD_PER_SEC, HEYGEN_AVATAR_IV_PHOTO_USD_PER_SEC } from "@/services/ad-lab/avatarCost";

// ---------------------------------------------------------------------------

function fmtUsd(n: number) { return `$${n.toFixed(4)} USD`; }
function fmtSec(n: number) { return `~${Math.round(n)} วินาที`; }
function formatDate(iso: string) {
  try { return new Date(iso).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso.slice(0, 16); }
}

const KIND_LABEL: Record<AdLabVideoKind, string> = { test: "ทดสอบ", production: "จริง" };
const VOICE_LABEL: Record<AdLabVideoVoiceSource, string> = { elevenlabs: "ElevenLabs", twin_tts: "Digital Twin TTS" };
const IN_FLIGHT: AdLabAvatarVideoStatus[] = ["queued", "processing", "copying"];

// ---------------------------------------------------------------------------
// Per-entry card — calls one polling hook per instance

interface VideoEntryCardProps {
  entry: AdLabAvatarVideoEntry;
  visible: boolean;
  draftId: string;
  isPrimary: boolean;
  onUpdate: (id: string, patch: Partial<AdLabAvatarVideoEntry>) => void;
  onDelete: (entry: AdLabAvatarVideoEntry) => void;
  onRename: (id: string, title: string) => void;
  onSetPrimary: (id: string) => void;
  onRetry: (entry: AdLabAvatarVideoEntry) => void;
}

function VideoEntryCard({
  entry,
  visible,
  draftId,
  isPrimary,
  onUpdate,
  onDelete,
  onRename,
  onSetPrimary,
  onRetry,
}: VideoEntryCardProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(entry.title ?? "");
  const [liveVideoUrl, setLiveVideoUrl] = useState<string | null>(null);
  const [liveDownloadUrl, setLiveDownloadUrl] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [mediaAttempt, setMediaAttempt] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const handlePollingUpdate = useCallback((u: AvatarPollingUpdate) => {
    if (u.videoUrl) setLiveVideoUrl(u.videoUrl);
    if (u.downloadUrl) setLiveDownloadUrl(u.downloadUrl);
    onUpdate(entry.id, {
      status: u.status,
      ...(u.error !== undefined ? { error: u.error } : {}),
      ...(u.videoKey ? { videoKey: u.videoKey } : {}),
      ...(u.completedAt ? { updatedAt: u.completedAt } : {}),
      ...(u.durationSec !== undefined ? { durationSec: u.durationSec } : {}),
    });
  }, [entry.id, onUpdate]);

  const isInFlight = !!(
    entry.heygenVideoId && entry.jobToken && IN_FLIGHT.includes(entry.status)
  );

  const { timedOut, checkNow, error: pollingError, latest: pollingLatest } = useAvatarJobPolling({
    draftId,
    heygenVideoId: entry.heygenVideoId ?? null,
    jobToken: entry.jobToken ?? null,
    status: entry.status,
    onUpdate: handlePollingUpdate,
  });

  const effectiveVideoUrl = pollingLatest.videoUrl ?? liveVideoUrl;
  const effectiveDownloadUrl = pollingLatest.downloadUrl ?? liveDownloadUrl;

  useEffect(() => {
    if (!visible || entry.status !== "ready" || !entry.videoKey) return;
    const controller = new AbortController();
    setMediaLoading(true);
    setMediaError("");
    setLiveVideoUrl(null);
    setMediaLoaded(false);
    fetch(`/api/ad-lab/avatar/media?key=${encodeURIComponent(entry.videoKey)}&draftId=${encodeURIComponent(draftId)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("โหลดวิดีโอไม่สำเร็จ");
        const data = await response.json() as { url?: string };
        if (!data.url) throw new Error("ไม่พบลิงก์วิดีโอ");
        if (!controller.signal.aborted) { setLiveVideoUrl(data.url); setMediaLoaded(true); }
      })
      .catch(() => { if (!controller.signal.aborted) setMediaError("โหลดตัวอย่างไม่สำเร็จ กรุณาลองอีกครั้ง"); })
      .finally(() => { if (!controller.signal.aborted) setMediaLoading(false); });
    return () => controller.abort();
  }, [visible, entry.status, entry.videoKey, draftId, mediaAttempt]);

  async function loadMedia() {
    if (mediaLoaded || !entry.videoKey) return;
    setMediaLoading(true);
    try {
      const [view, dl] = await Promise.all([
        fetch(`/api/ad-lab/avatar/media?key=${encodeURIComponent(entry.videoKey)}&draftId=${encodeURIComponent(draftId)}`).then(r => r.json()) as Promise<{ url?: string }>,
        fetch(`/api/ad-lab/avatar/media?key=${encodeURIComponent(entry.videoKey)}&draftId=${encodeURIComponent(draftId)}&download=1`).then(r => r.json()) as Promise<{ url?: string }>,
      ]);
      if (view.url) setLiveVideoUrl(view.url);
      if (dl.url) setLiveDownloadUrl(dl.url);
      setMediaLoaded(true);
    } catch { /* ignore */ } finally { setMediaLoading(false); }
  }

  async function handleDownload() {
    const dl = effectiveDownloadUrl;
    if (dl) { window.location.href = dl; return; }
    if (!entry.videoKey) return;
    const res = await fetch(`/api/ad-lab/avatar/media?key=${encodeURIComponent(entry.videoKey)}&draftId=${encodeURIComponent(draftId)}&download=1`);
    const data = await res.json() as { url?: string };
    if (data.url) window.location.href = data.url;
  }

  async function handleCopyLink() {
    const url = effectiveVideoUrl;
    if (url) {
      await navigator.clipboard.writeText(url).catch(() => {});
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
      return;
    }
    if (!entry.videoKey) return;
    const res = await fetch(`/api/ad-lab/avatar/media?key=${encodeURIComponent(entry.videoKey)}&draftId=${encodeURIComponent(draftId)}`);
    const data = await res.json() as { url?: string };
    if (data.url) {
      await navigator.clipboard.writeText(data.url).catch(() => {});
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  }

  async function handleConfirmDelete() {
    setDeleteOpen(false);
    if (!entry.videoKey) {
      onDelete(entry);
      return;
    }
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/ad-lab/avatar/video", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, videoKey: entry.videoKey }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setDeleteError(data.error ?? `HTTP ${res.status}`);
        return;
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      setDeleteLoading(false);
    }
    setDeleteError("");
    onDelete(entry);
  }

  function handleSaveRename() {
    onRename(entry.id, renameValue.trim() || "");
    setRenaming(false);
  }

  const statusColor: Record<AdLabAvatarVideoStatus, string> = {
    submitting: "bg-slate-100 text-slate-600",
    queued: "bg-blue-100 text-blue-700",
    processing: "bg-blue-100 text-blue-700",
    copying: "bg-blue-100 text-blue-700",
    ready: "bg-emerald-100 text-emerald-800",
    failed: "bg-red-100 text-red-700",
  };
  const statusLabel: Record<AdLabAvatarVideoStatus, string> = {
    submitting: "กำลังส่ง",
    queued: "รอคิว",
    processing: "กำลังสร้าง",
    copying: "กำลังคัดลอก",
    ready: "พร้อม",
    failed: "ล้มเหลว",
  };

  const engineRate = entry.engine === "avatar_iv" ? HEYGEN_AVATAR_IV_PHOTO_USD_PER_SEC : HEYGEN_AVATAR_V_DIGITAL_TWIN_USD_PER_SEC;

  return (
    <div hidden={!visible} className={`min-w-0 rounded-xl border ${isPrimary ? "border-emerald-400 bg-emerald-50/40 ring-1 ring-emerald-200" : "border-slate-200 bg-white"} p-4 space-y-3 shadow-sm`}>
      <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-slate-950">
        {entry.status === "ready" && effectiveVideoUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video controls playsInline preload="metadata" src={effectiveVideoUrl} className="h-full w-full object-contain" onError={() => setMediaError("โหลดตัวอย่างไม่สำเร็จ กรุณาลองอีกครั้ง")} />
        ) : (
          <div className="space-y-3 px-5 text-center text-sm text-slate-300" role="status">
            <svg aria-hidden="true" className={`mx-auto h-10 w-10 ${mediaLoading || isInFlight ? "animate-pulse" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="m10 8 6 4-6 4z" /></svg>
            <p>{entry.status === "ready" ? mediaError || (mediaLoading ? "กำลังโหลดตัวอย่าง…" : "ยังไม่มีตัวอย่างวิดีโอ") : statusLabel[entry.status]}</p>
          </div>
        )}
      </div>
      {mediaError && <button type="button" className="text-sm text-blue-700 hover:underline" onClick={() => setMediaAttempt(value => value + 1)}>โหลดตัวอย่างอีกครั้ง</button>}
      {/* ── Header row ── */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusColor[entry.status]}`}>
            {statusLabel[entry.status]}
          </span>
          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600">
            {KIND_LABEL[entry.kind]}
          </span>
          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600">
            {VOICE_LABEL[entry.voiceSource]}
          </span>
          {isPrimary && (
            <span className="rounded border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800">
              ใช้สำหรับ Publishing
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400">{formatDate(entry.createdAt)}</p>
      </div>

      {/* ── Title row ── */}
      {renaming ? (
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            maxLength={200}
            className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
            onKeyDown={e => { if (e.key === "Enter") handleSaveRename(); if (e.key === "Escape") setRenaming(false); }}
          />
          <Button type="button" size="sm" onClick={handleSaveRename}>บันทึก</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setRenaming(false)}>ยกเลิก</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-slate-800 truncate">
            {entry.title || `วิดีโอ ${entry.kind === "test" ? "ทดสอบ" : "จริง"} — ${entry.lookName ?? entry.lookId.slice(0, 12)}`}
          </p>
          <button type="button" onClick={() => { setRenameValue(entry.title ?? ""); setRenaming(true); }} className="text-xs text-blue-700 hover:underline flex-shrink-0">
            แก้ไขชื่อ
          </button>
        </div>
      )}

      {/* ── Meta row ── */}
      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
        <span>Look: {entry.lookName ?? entry.lookId.slice(0, 16)}…</span>
        <span>{entry.engine === "avatar_v" ? "Avatar V" : "Avatar IV"}</span>
        <span title="Aspect ratio">{entry.aspectRatio ?? "9:16"}</span>
            {entry.settings && settingsSummary(entry.settings) && <span title="ตั้งค่าขั้นสูง">{settingsSummary(entry.settings)}</span>}
            {entry.durationSec && <span>{fmtSec(entry.durationSec)}</span>}
        <span>ประมาณ {fmtUsd(entry.durationSec ? entry.durationSec * engineRate : entry.estCostUsd)}</span>
      </div>

      {/* ── In-flight progress ── */}
      {isInFlight && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>กำลังประมวลผล ({statusLabel[entry.status]}) — อาจใช้เวลาหลายนาที</span>
          </div>
          {pollingError && <p className="text-xs text-red-600">{pollingError}</p>}
          {timedOut && <p className="text-xs text-slate-500">ยังประมวลผลอยู่ — กลับมาตรวจสอบภายหลัง</p>}
          {(timedOut || !!pollingError) && (
            <button type="button" onClick={checkNow} className="text-xs text-blue-700 hover:underline">
              ตรวจสอบสถานะ
            </button>
          )}
        </div>
      )}

      {/* ── Error ── */}
      {entry.status === "failed" && (
        <p className="text-sm text-red-600">{entry.error ?? "เกิดข้อผิดพลาดที่ HeyGen"}</p>
      )}

      {/* Fallback for entries without a stored media key. */}
      {entry.status === "ready" && !entry.videoKey && !effectiveVideoUrl && (
        <div className="space-y-2">
          {!mediaLoaded && !effectiveVideoUrl && (
            <button
              type="button"
              onClick={() => void loadMedia()}
              disabled={mediaLoading}
              className="text-sm text-blue-700 hover:underline"
            >
              {mediaLoading ? "กำลังโหลด…" : "โหลดวิดีโอ"}
            </button>
          )}
        </div>
      )}

      {deleteError && <p role="alert" className="text-xs text-red-600">ลบไม่สำเร็จ: {deleteError}</p>}
      {/* ── Actions ── */}
      <div className="flex flex-wrap gap-2">
        {entry.status === "ready" && (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => void handleDownload()}>
              ดาวน์โหลด
            </Button>
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {copyFeedback ? "คัดลอกแล้ว ✓" : "คัดลอก Link"}
            </button>
          </>
        )}
        {(entry.status === "failed" || (entry.status === "ready" && !isPrimary)) && (
          <button
            type="button"
            onClick={() => onRetry(entry)}
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            {entry.status === "failed" ? "ลองใหม่" : "สร้างซ้ำ"}
          </button>
        )}
        {entry.status === "ready" && !isPrimary && (
          <button
            type="button"
            onClick={() => onSetPrimary(entry.id)}
            className="inline-flex items-center rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors"
          >
            ใช้สำหรับ Publishing
          </button>
        )}
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          disabled={deleteLoading}
          className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
        >
          {deleteLoading ? "กำลังลบ…" : "ลบ"}
        </button>
      </div>

      <CostConfirmDialog
        open={deleteOpen}
        title="ยืนยันการลบวิดีโอ"
        lines={[
          "วิดีโอจะถูกลบออกจากระบบ (Spaces) และออกจากรายการ",
          "การดำเนินการนี้ไม่สามารถย้อนกลับได้",
          entry.title ? `วิดีโอ: "${entry.title}"` : "",
        ].filter(Boolean)}
        confirmLabel="ลบวิดีโอ"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// VideoManagerSection

interface VideoManagerSectionProps {
  videos: AdLabAvatarVideoEntry[];
  primaryVideoId?: string;
  draftId: string;
  onUpdateEntry: (id: string, patch: Partial<AdLabAvatarVideoEntry>) => void;
  onDeleteEntry: (id: string) => void;
  onRenameEntry: (id: string, title: string) => void;
  onSetPrimary: (id: string) => void;
  onRetry: (entry: AdLabAvatarVideoEntry) => void;
}

export function VideoManagerSection({
  videos,
  primaryVideoId,
  draftId,
  onUpdateEntry,
  onDeleteEntry,
  onRenameEntry,
  onSetPrimary,
  onRetry,
}: VideoManagerSectionProps) {
  const [page, setPage] = useState(1);
  const pageSize = 6;
  const pageCount = Math.max(1, Math.ceil(videos.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  useEffect(() => { setPage(1); }, [draftId, videos.length]);
  if (videos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center"><p className="font-medium text-slate-700">ยังไม่มีวิดีโอ</p><p className="mt-2 text-sm text-slate-500">สร้างวิดีโอแรกด้านบน แล้ววิดีโอทั้งหมดจะปรากฏที่นี่</p></div>
    );
  }

  // Show newest first
  const sorted = [...videos].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3"><p className="text-sm text-slate-600" aria-live="polite">
        {videos.length} วิดีโอ ·{" "}
        {primaryVideoId
          ? `ใช้สำหรับ Publishing: ${videos.find(v => v.id === primaryVideoId)?.title ?? primaryVideoId.slice(0, 12)}`
          : "ยังไม่ได้เลือกวิดีโอสำหรับ Publishing"}
      </p><span className="text-xs text-slate-500">ใหม่ล่าสุดก่อน · {videos.filter(entry => entry.status === "ready").length} วิดีโอพร้อมใช้งาน</span></div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {sorted.map((entry, index) => (
        <VideoEntryCard
          key={entry.id}
          entry={entry}
          visible={index >= (currentPage - 1) * pageSize && index < currentPage * pageSize}
          draftId={draftId}
          isPrimary={entry.id === primaryVideoId}
          onUpdate={onUpdateEntry}
          onDelete={e => onDeleteEntry(e.id)}
          onRename={onRenameEntry}
          onSetPrimary={onSetPrimary}
          onRetry={onRetry}
        />
      ))}
      </div>
      <nav aria-label="หน้ารายการวิดีโอ" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
        <p className="text-xs text-slate-500">แสดง {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, videos.length)} จาก {videos.length} วิดีโอ</p>
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" variant="outline" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>← ก่อนหน้า</Button>
          <span className="text-sm text-slate-600" aria-live="polite">หน้า {currentPage} / {pageCount}</span>
          <Button type="button" size="sm" variant="outline" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>ถัดไป →</Button>
        </div>
      </nav>
    </div>
  );
}
