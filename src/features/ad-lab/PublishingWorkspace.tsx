"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  AD_LAB_CHANNELS,
  type AdLabChannel,
  type AdLabChannelPublishingSettings,
  type AdLabPublishingPlan,
  type AdLabScriptDraft,
  type AdLabSocialAccount,
} from "@/domain/models/AdLab";
import { useAdLabStore } from "./useAdLabStore";
import {
  deleteAdLabPublishingVideo,
  loadAdLabPublishingVideo,
  saveAdLabPublishingVideo,
} from "./adLabVideoStorage";
import { SocialAccountsDialog } from "./SocialAccountsDialog";
import { CHANNEL_ACCENT, CHANNEL_LABELS } from "./socialAccountChannels";
import { publishAdLabVideo, uploadAdLabVideo } from "./adLabPublishingClient";
import {
  DEFAULT_PROMOTION_DAYS,
  MAX_PROMOTION_DAYS,
  PROMOTION_DAY_PRESETS,
  PROMOTION_PAY_AT,
  formatBaht,
  promotionDaily,
  promotionDays,
  promotionTotal,
} from "./adLabPromotion";
import { PublishConfirmDialog, type PublishConfirmLine } from "./PublishConfirmDialog";
import { AdTargetingPanel } from "./AdTargetingPanel";
import { defaultAdLabAdTargeting } from "@/domain/models/AdLabAdTargeting";
import type { AdLabPublication } from "@/domain/models/AdLabPublication";
import { ROUTES } from "@/config/routes";

type ChannelSettingsMap = Record<AdLabChannel, AdLabChannelPublishingSettings>;
type SaveState = "idle" | "pending" | "saving" | "saved" | "browser" | "error";

/** TikTok and Instagram both cap captions at 2,200 characters. */
const CAPTION_LIMIT = 2_200;
const AUTOSAVE_DELAY_MS = 700;

/**
 * Builds the per-channel settings for a freshly selected script plan.
 *
 * Every connected account of the brand is pre-selected: a user who linked an
 * account to the brand meant it to publish, and unticking is cheaper than
 * hunting for the one account they wanted. Accounts still pending
 * authorisation are left out — the provider cannot post through them yet.
 */
function defaultChannelSettings(
  channels: AdLabChannel[],
  accounts: AdLabSocialAccount[]
): ChannelSettingsMap {
  return Object.fromEntries(AD_LAB_CHANNELS.map((channel) => [channel, {
    publish: channels.includes(channel),
    accountIds: accounts
      .filter((account) => account.channel === channel && account.status === "connected")
      .map((account) => account.id),
    advertisingEnabled: false,
    budgetType: "daily",
    budget: 0,
    durationDays: DEFAULT_PROMOTION_DAYS,
    targetAudience: "",
    adTargeting: defaultAdLabAdTargeting({ utmCampaign: "chinese_ttt" }),
  }])) as ChannelSettingsMap;
}

/**
 * Restores an auto-saved plan on top of fresh defaults. Accounts that were
 * unlinked or lost their connection since the save are dropped, so a restored
 * plan never targets an account that can no longer post.
 */
function restoreChannelSettings(
  draft: AdLabScriptDraft,
  accounts: AdLabSocialAccount[],
  saved: ChannelSettingsMap
): ChannelSettingsMap {
  const defaults = defaultChannelSettings(draft.channels, accounts);
  const usable = new Set(accounts.filter((a) => a.status === "connected").map((a) => a.id));
  return Object.fromEntries(AD_LAB_CHANNELS.map((channel) => {
    const stored = saved[channel];
    if (!stored) return [channel, defaults[channel]];
    return [channel, {
      ...defaults[channel],
      ...stored,
      durationDays: stored.durationDays ?? DEFAULT_PROMOTION_DAYS,
      adTargeting: stored.adTargeting ?? defaultAdLabAdTargeting({ utmCampaign: "chinese_ttt" }),
      accountIds: stored.accountIds.filter((id) => usable.has(id)),
    }];
  })) as ChannelSettingsMap;
}

function latestPlanFor(plans: AdLabPublishingPlan[], draftId: string): AdLabPublishingPlan | undefined {
  return plans
    .filter((plan) => plan.draftId === draftId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function PublishingWorkspace() {
  const { store, ready, update } = useAdLabStore();

  const selectedBrandId = store.selectedBrandId || store.brands[0]?.id || "";
  const brand = useMemo(
    () => store.brands.find((item) => item.id === selectedBrandId),
    [selectedBrandId, store.brands]
  );
  const brandAccounts = useMemo(
    () => store.socialAccounts.filter((account) => account.brandId === selectedBrandId),
    [selectedBrandId, store.socialAccounts]
  );
  const approvedDrafts = useMemo(
    () => store.drafts.filter((draft) => draft.status === "approved" && draft.brandId === selectedBrandId),
    [selectedBrandId, store.drafts]
  );

  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [channelSettings, setChannelSettings] = useState<ChannelSettingsMap>(() => defaultChannelSettings([], []));
  const [accountsDialogOpen, setAccountsDialogOpen] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [publishError, setPublishError] = useState("");
  const [published, setPublished] = useState<AdLabPublication | null>(null);
  const [publishedAdChannels, setPublishedAdChannels] = useState<AdLabChannel[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ── Auto-save ─────────────────────────────────────────────────────────────
  // One working plan per script plan. Every edit marks it dirty; a short
  // debounce then upserts it into the workspace (PostgreSQL, with a browser
  // copy). The video file itself stays in this browser's IndexedDB.
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [videoWarning, setVideoWarning] = useState("");
  const [hydratedDraftId, setHydratedDraftId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const planIdRef = useRef("");
  const dirtyRef = useRef(false);
  const hydrateTokenRef = useRef(0);

  const selectedDraft = approvedDrafts.find((draft) => draft.id === selectedDraftId);

  // Preview of the one selected video. The object URL is revoked whenever the
  // video changes so replaced files don't stay pinned in memory.
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [videoUrl, setVideoUrl] = useState("");
  useEffect(() => {
    if (!video) {
      setVideoUrl("");
      return;
    }
    const url = URL.createObjectURL(video);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [video]);

  const persistPlan = useCallback(async (snapshot: {
    draft: AdLabScriptDraft;
    planId: string;
    caption: string;
    channelSettings: ChannelSettingsMap;
    video: File | null;
  }) => {
    dirtyRef.current = false;
    const { draft, planId } = snapshot;
    const activeForDraft = draft.channels.filter((c) => snapshot.channelSettings[c].publish);
    const complete = Boolean(snapshot.video) && snapshot.caption.trim().length > 0 && activeForDraft.length > 0 &&
      activeForDraft.every((c) => snapshot.channelSettings[c].accountIds.length > 0);
    const plan: AdLabPublishingPlan = {
      id: planId,
      draftId: draft.id,
      brandId: draft.brandId,
      videoStorageKey: planId,
      videoName: snapshot.video?.name ?? "",
      videoSize: snapshot.video?.size ?? 0,
      videoType: snapshot.video?.type ?? "",
      caption: snapshot.caption,
      channelSettings: snapshot.channelSettings,
      status: complete ? "ready" : "draft",
      updatedAt: new Date().toISOString(),
    };
    setSaveState("saving");
    let superseded: AdLabPublishingPlan[] = [];
    try {
      const destination = await update((current) => {
        // Older manual saves left several plans per script plan; keep one.
        superseded = current.publishingPlans.filter((p) => p.draftId === draft.id && p.id !== planId);
        return {
          ...current,
          publishingPlans: [plan, ...current.publishingPlans.filter((p) => p.draftId !== draft.id)],
        };
      });
      for (const old of superseded) void deleteAdLabPublishingVideo(old.videoStorageKey).catch(() => undefined);
      setSaveState(destination === "browser" ? "browser" : "saved");
      setSavedAt(new Date());
    } catch {
      setSaveState("error");
    }
  }, [update]);

  /** Load the saved plan (or defaults) for a script plan into the form. */
  const hydrate = useCallback((draft: AdLabScriptDraft | undefined) => {
    const token = ++hydrateTokenRef.current;
    const plan = draft ? latestPlanFor(store.publishingPlans, draft.id) : undefined;
    planIdRef.current = plan?.id ?? crypto.randomUUID();
    dirtyRef.current = false;
    setCaption(plan?.caption ?? "");
    setChannelSettings(draft
      ? plan ? restoreChannelSettings(draft, brandAccounts, plan.channelSettings) : defaultChannelSettings(draft.channels, brandAccounts)
      : defaultChannelSettings([], []));
    setVideo(null);
    setVideoWarning("");
    setValidationError("");
    setPublishError("");
    setSaveState(plan ? "saved" : "idle");
    setSavedAt(plan ? new Date(plan.updatedAt) : null);
    setHydratedDraftId(draft?.id ?? null);
    if (plan?.videoName) {
      loadAdLabPublishingVideo(plan.videoStorageKey)
        .then((blob) => {
          if (token !== hydrateTokenRef.current) return;
          if (!blob) {
            setVideoWarning(`ไม่พบไฟล์ “${plan.videoName}” ใน browser นี้ — เลือกไฟล์วิดีโออีกครั้ง`);
            return;
          }
          setVideo(blob instanceof File ? blob : new File([blob], plan.videoName, { type: plan.videoType }));
        })
        .catch(() => {
          if (token === hydrateTokenRef.current) setVideoWarning("อ่านวิดีโอที่บันทึกไว้ไม่ได้ — เลือกไฟล์อีกครั้ง");
        });
    }
  }, [brandAccounts, store.publishingPlans]);

  /** Save immediately if there are unsaved edits (before switching plan/brand). */
  function flushPending() {
    if (dirtyRef.current && selectedDraft && hydratedDraftId === selectedDraft.id) {
      void persistPlan({ draft: selectedDraft, planId: planIdRef.current, caption, channelSettings, video });
    }
  }

  function markDirty() {
    dirtyRef.current = true;
    setSaveState("pending");
    setRevision((n) => n + 1);
  }

  // Debounced auto-save after any edit.
  useEffect(() => {
    if (!dirtyRef.current || !selectedDraft || hydratedDraftId !== selectedDraft.id) return;
    const snapshot = { draft: selectedDraft, planId: planIdRef.current, caption, channelSettings, video };
    const timer = window.setTimeout(() => { void persistPlan(snapshot); }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
    // `revision` is the edit signal; the values ride along in the snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // Don't lose the last keystrokes when the tab closes mid-debounce.
  const flushRef = useRef(flushPending);
  flushRef.current = flushPending;
  useEffect(() => {
    const onHide = () => flushRef.current();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flushRef.current();
    };
  }, []);

  // Switching brand (or approving a new plan) must always leave a valid plan
  // selected. Prefer the script plan that was worked on most recently.
  useEffect(() => {
    if (!ready) return;
    if (approvedDrafts.some((draft) => draft.id === selectedDraftId)) {
      if (hydratedDraftId !== selectedDraftId) hydrate(selectedDraft);
      return;
    }
    const recent = [...store.publishingPlans]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .find((plan) => approvedDrafts.some((draft) => draft.id === plan.draftId));
    const next = approvedDrafts.find((draft) => draft.id === recent?.draftId) ?? approvedDrafts[0];
    setSelectedDraftId(next?.id ?? "");
    hydrate(next);
  }, [approvedDrafts, hydrate, hydratedDraftId, ready, selectedDraft, selectedDraftId, store.publishingPlans]);

  function selectBrand(id: string) {
    if (id === selectedBrandId) return;
    flushPending();
    void update((current) => ({ ...current, selectedBrandId: id }));
    setPublished(null);
  }

  function selectDraft(id: string) {
    if (id === selectedDraftId) return;
    flushPending();
    const draft = approvedDrafts.find((item) => item.id === id);
    setSelectedDraftId(id);
    setPublished(null);
    hydrate(draft);
  }

  function selectVideo(event: ChangeEvent<HTMLInputElement>) {
    // One video per plan: a new pick replaces the previous one (same storage key).
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    setVideo(file);
    setVideoWarning("");
    setPublishError("");
    if (file) {
      saveAdLabPublishingVideo(planIdRef.current, file).catch(() => {
        setVideoWarning("เก็บไฟล์วิดีโอไว้ใน browser ไม่ได้ (พื้นที่อาจเต็ม) — ถ้าออกจากหน้านี้ต้องเลือกไฟล์ใหม่");
      });
    }
    markDirty();
  }

  function removeVideo() {
    setVideo(null);
    setVideoWarning("");
    setPublishError("");
    void deleteAdLabPublishingVideo(planIdRef.current).catch(() => undefined);
    markDirty();
  }

  function changeCaption(value: string) {
    setCaption(value);
    setPublishError("");
    markDirty();
  }

  function updateChannel(channel: AdLabChannel, patch: Partial<AdLabChannelPublishingSettings>) {
    setChannelSettings((current) => ({
      ...current,
      [channel]: { ...current[channel], ...patch },
    }));
    setValidationError("");
    markDirty();
  }

  function toggleAccount(channel: AdLabChannel, accountId: string) {
    const selected = channelSettings[channel].accountIds;
    updateChannel(channel, {
      accountIds: selected.includes(accountId)
        ? selected.filter((id) => id !== accountId)
        : [...selected, accountId],
    });
  }

  function linkAccount(account: AdLabSocialAccount) {
    void update((current) => ({ ...current, socialAccounts: [...current.socialAccounts, account] }));
    if (account.status === "connected") {
      updateChannel(account.channel, {
        accountIds: [...channelSettings[account.channel].accountIds, account.id],
      });
    }
  }

  function unlinkAccount(accountId: string) {
    void update((current) => ({
      ...current,
      socialAccounts: current.socialAccounts.filter(
        (account) => !(account.id === accountId && account.brandId === selectedBrandId)
      ),
    }));
    // A removed account must not stay ticked on a channel it no longer belongs to.
    setChannelSettings((current) => Object.fromEntries(
      AD_LAB_CHANNELS.map((channel) => [channel, {
        ...current[channel],
        accountIds: current[channel].accountIds.filter((id) => id !== accountId),
      }])
    ) as ChannelSettingsMap);
    markDirty();
  }

  const activeChannels = selectedDraft?.channels.filter((channel) => channelSettings[channel].publish) ?? [];
  const channelsMissingAccount = activeChannels.filter((channel) => channelSettings[channel].accountIds.length === 0);
  const accountsById = useMemo(() => new Map(brandAccounts.map((a) => [a.id, a])), [brandAccounts]);

  const confirmLines: PublishConfirmLine[] = activeChannels.flatMap((channel) => {
    const settings = channelSettings[channel];
    const promoted = settings.advertisingEnabled && promotionTotal(settings) > 0;
    return settings.accountIds.map((id) => {
      const account = accountsById.get(id);
      return {
        channel,
        accountLabel: account?.accountUsername || account?.accountName || account?.platformLabel || CHANNEL_LABELS[channel],
        promotion: promoted
          ? { total: promotionTotal(settings), daily: promotionDaily(settings), days: promotionDays(settings) }
          : null,
      };
    });
  });
  const adGrandTotal = confirmLines.reduce((sum, line) => sum + (line.promotion?.total ?? 0), 0);

  /** Everything "publish now" needs; reports the first problem found. */
  function validateForPublish(): boolean {
    if (!selectedDraft || !video) return false;
    if (activeChannels.length === 0) {
      setValidationError("เลือกอย่างน้อย 1 ช่องทางที่จะเผยแพร่");
      return false;
    }
    if (channelsMissingAccount.length > 0) {
      setValidationError(
        `เลือกบัญชีอย่างน้อย 1 บัญชีสำหรับ ${channelsMissingAccount.map((channel) => CHANNEL_LABELS[channel]).join(", ")}`
      );
      return false;
    }
    const unbudgeted = activeChannels.filter((c) => channelSettings[c].advertisingEnabled && !(channelSettings[c].budget > 0));
    if (unbudgeted.length > 0) {
      setValidationError(
        `ใส่งบโฆษณาของ ${unbudgeted.map((c) => CHANNEL_LABELS[c]).join(", ")} หรือปิดการโปรโมทแบบเสียเงิน`
      );
      return false;
    }
    if (!caption.trim()) {
      setValidationError("ใส่แคปชันก่อนเผยแพร่ — แพลตฟอร์มไม่รับโพสต์ที่ไม่มีแคปชัน");
      return false;
    }
    if (caption.length > CAPTION_LIMIT) {
      setValidationError(`แคปชันยาวเกิน ${CAPTION_LIMIT.toLocaleString()} ตัวอักษร`);
      return false;
    }
    setValidationError("");
    return true;
  }

  function requestPublish() {
    setPublishError("");
    if (validateForPublish()) setConfirmOpen(true);
  }

  /**
   * Publish for real: upload the video to storage, then send one post to every
   * selected account through the connected-accounts provider. Reached only
   * from the confirm dialog, which also makes the owner acknowledge any paid
   * promotion total they have to pay on the platform.
   */
  async function publishNow() {
    setConfirmOpen(false);
    if (!validateForPublish() || !selectedDraft || !video) return;
    flushPending();
    setPublishing(true);
    setPublishError("");
    setPublished(null);
    try {
      setUploadProgress(0);
      const videoKey = await uploadAdLabVideo(video, setUploadProgress);
      const targets = activeChannels.flatMap((channel) => {
        const settings = channelSettings[channel];
        return settings.accountIds.map((connectionId) => ({
          channel,
          connectionId,
          plannedBudget: promotionTotal(settings),
        }));
      });
      const publication = await publishAdLabVideo({
        brandId: selectedDraft.brandId,
        draftId: selectedDraft.id,
        planId: planIdRef.current,
        campaignName: selectedDraft.title,
        title: selectedDraft.title,
        caption: caption.trim(),
        videoKey,
        videoName: video.name,
        targets,
      });
      setPublished(publication);
      setPublishedAdChannels(activeChannels.filter((c) => promotionTotal(channelSettings[c]) > 0));
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "เผยแพร่ไม่สำเร็จ");
    } finally {
      setPublishing(false);
      setUploadProgress(null);
    }
  }

  if (!ready) return <Card><p className="text-sm text-slate-500">กำลังโหลดข้อมูล…</p></Card>;

  if (!brand) {
    return (
      <Card className="border-dashed text-center">
        <h2 className="text-lg font-semibold text-slate-900">เพิ่มแบรนด์ก่อนเตรียมเผยแพร่</h2>
        <p className="mt-1 text-sm text-slate-500">ไปที่แท็บ Brands แล้วกรอกข้อมูลพื้นฐาน จากนั้นกลับมาที่นี่</p>
      </Card>
    );
  }

  const saveLabel: Record<SaveState, string> = {
    idle: "บันทึกอัตโนมัติเมื่อมีการแก้ไข",
    pending: "มีการแก้ไข…",
    saving: "กำลังบันทึก…",
    saved: savedAt ? `บันทึกอัตโนมัติแล้ว ${savedAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}` : "บันทึกอัตโนมัติแล้ว",
    browser: "บันทึกไว้ใน browser นี้แล้ว — ยังซิงก์ขึ้นเซิร์ฟเวอร์ไม่ได้",
    error: "บันทึกอัตโนมัติไม่สำเร็จ — ลองแก้ไขอีกครั้ง",
  };
  const saveTone = saveState === "error" ? "text-red-600" : saveState === "browser" ? "text-amber-700" : saveState === "saved" ? "text-emerald-700" : "text-slate-500";

  return (
    <>
      <div className="space-y-6">
        {/* Brand first: it scopes both the approved script plans below and the
            social accounts a channel may publish to. */}
        <Card className="border-blue-200 bg-blue-50/40">
          <div className="grid gap-4 md:grid-cols-[minmax(0,20rem)_1fr] md:items-end">
            <Select
              label="แบรนด์"
              value={selectedBrandId}
              onChange={(event) => selectBrand(event.target.value)}
              options={store.brands.map((item) => ({ value: item.id, label: item.name }))}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-white px-4 py-3 text-sm text-slate-600">
              <span className="font-medium text-slate-900">{brand.product || "สินค้า/บริการยังไม่ระบุ"}</span>
              <span className="text-slate-300">•</span>
              <span>Script plan ที่อนุมัติแล้ว {approvedDrafts.length} รายการ</span>
              <span className="text-slate-300">•</span>
              <span>บัญชีโซเชียล {brandAccounts.length} บัญชี</span>
              {selectedDraft && (
                <span className={`ml-auto text-xs font-medium ${saveTone}`} role="status" aria-live="polite">
                  {saveLabel[saveState]}
                </span>
              )}
            </div>
          </div>
        </Card>

        {approvedDrafts.length === 0 ? (
          <Card className="border-dashed text-center">
            <h2 className="text-lg font-semibold text-slate-900">แบรนด์นี้ยังไม่มี Script plan ที่อนุมัติแล้ว</h2>
            <p className="mt-1 text-sm text-slate-500">ไปที่แท็บ Create สร้างและอนุมัติแผนก่อน แล้วแผนนั้นจะพร้อมให้เลือกที่นี่</p>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>1. เลือก Script plan</CardTitle>
                <CardDescription>แสดงเฉพาะแผนที่อนุมัติแล้วของแบรนด์ที่เลือกไว้ด้านบน การตั้งค่าของแต่ละแผนบันทึกอัตโนมัติ</CardDescription>
              </CardHeader>
              <Select
                label="Script plan ที่อนุมัติแล้ว"
                value={selectedDraftId}
                onChange={(event) => selectDraft(event.target.value)}
                options={approvedDrafts.map((draft) => ({ value: draft.id, label: draft.title }))}
              />
              {selectedDraft && (
                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
                  <p className="font-semibold text-slate-900">{selectedDraft.title}</p>
                  <p className="mt-1 text-sm text-slate-700">{selectedDraft.mainHook}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    ความยาว {Number(selectedDraft.duration) >= 60 ? `${Number(selectedDraft.duration) / 60} นาที` : `${selectedDraft.duration} วินาที`}
                    {" · "}
                    {selectedDraft.channels.map((channel) => CHANNEL_LABELS[channel]).join(", ")}
                  </p>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>2. วิดีโอและแคปชัน</CardTitle>
                <CardDescription>เลือกวิดีโอที่สร้างตาม Script plan ด้านบน แล้วเขียนข้อความที่จะโพสต์คู่กับวิดีโอ</CardDescription>
              </CardHeader>
              <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
                onChange={selectVideo}
                className={video ? "hidden" : "block w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:font-medium file:text-blue-700 hover:file:bg-blue-100"}
              />
              {!video && <p className="mt-2 text-xs text-slate-500">อัปโหลดได้ 1 วิดีโอต่อแผน (MP4, MOV, WebM, M4V)</p>}
              {video && videoUrl && (
                <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-start">
                  <video
                    key={videoUrl}
                    src={videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-[28rem] w-full rounded-lg bg-black object-contain sm:w-64"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-sm font-medium text-slate-900">{video.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{(video.size / 1024 / 1024).toFixed(1)} MB · วิดีโอนี้จะถูกโพสต์ไปทุกบัญชีที่เลือก</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => videoInputRef.current?.click()}>
                        เปลี่ยนวิดีโอ
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-700" onClick={removeVideo}>
                        ลบวิดีโอ
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {videoWarning && <p className="mt-2 text-sm text-amber-700">{videoWarning}</p>}
              <div className="mt-4">
                <Textarea
                  label="แคปชัน (ข้อความโพสต์)"
                  value={caption}
                  onChange={(event) => changeCaption(event.target.value)}
                  placeholder="เช่น เรียนภาษาจีนวันละ 5 นาที ทักไลน์ @chineseonreel #เรียนภาษาจีน"
                  hint="ข้อความที่แสดงคู่กับวิดีโอบน TikTok, Instagram และ Facebook ใส่ hashtag และ @ ได้ — บน YouTube จะเป็นคำอธิบายวิดีโอ (ชื่อวิดีโอใช้ชื่อ Script plan) · จำเป็นต้องใส่ก่อนเผยแพร่"
                />
                <p className={`mt-1 text-right text-xs ${caption.length > CAPTION_LIMIT ? "text-red-600" : "text-slate-400"}`}>
                  {caption.length.toLocaleString()} / {CAPTION_LIMIT.toLocaleString()}
                </p>
              </div>
            </Card>

            {selectedDraft && (
              <Card padding="none" className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
                  <div>
                    <CardTitle>3. ตั้งค่าการเผยแพร่และโปรโมท</CardTitle>
                    <CardDescription>เลือกบัญชีปลายทาง และวางงบโปรโมทแบบเสียเงินแยกตามช่องทาง (ถ้าต้องการ)</CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">บัญชีของแบรนด์ {brandAccounts.length}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => setAccountsDialogOpen(true)}
                    >
                      + เชื่อมต่อบัญชี
                    </Button>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {selectedDraft.channels.map((channel) => {
                    const settings = channelSettings[channel];
                    const available = brandAccounts.filter((account) => account.channel === channel);
                    const missingAccount = settings.publish && settings.accountIds.length === 0;
                    const days = promotionDays(settings);
                    const perAccount = promotionTotal(settings);
                    const accountCount = Math.max(1, settings.accountIds.length);

                    return (
                      <section key={channel} className="px-6 py-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${CHANNEL_ACCENT[channel]}`}>
                              {CHANNEL_LABELS[channel]}
                            </span>
                            <span className="text-xs text-slate-500">
                              {available.length === 0
                                ? "ยังไม่มีบัญชีที่เชื่อมต่อ"
                                : `เลือกแล้ว ${settings.accountIds.length} จาก ${available.length} บัญชี`}
                            </span>
                          </div>
                          <label className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                            settings.publish
                              ? "border-blue-200 bg-blue-50 text-blue-800"
                              : "border-slate-200 bg-white text-slate-500"
                          }`}>
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-blue-700"
                              checked={settings.publish}
                              onChange={(event) => updateChannel(channel, {
                                publish: event.target.checked,
                                advertisingEnabled: event.target.checked ? settings.advertisingEnabled : false,
                              })}
                            />
                            เผยแพร่ช่องทางนี้
                          </label>
                        </div>

                        {settings.publish ? (
                          <div className="mt-4 grid gap-5 lg:grid-cols-2">
                            <div>
                              <h4 className="text-sm font-semibold text-slate-900">บัญชีที่จะเผยแพร่</h4>
                              {available.length === 0 ? (
                                <div className="mt-2 rounded-xl border border-dashed border-slate-300 px-4 py-5 text-center">
                                  <p className="text-sm text-slate-500">ยังไม่ได้เชื่อมบัญชี {CHANNEL_LABELS[channel]} กับแบรนด์นี้</p>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    className="mt-3"
                                    onClick={() => setAccountsDialogOpen(true)}
                                  >
                                    + เชื่อมต่อบัญชี {CHANNEL_LABELS[channel]}
                                  </Button>
                                </div>
                              ) : (
                                <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                                  {available.map((account) => {
                                    const checked = settings.accountIds.includes(account.id);
                                    const unusable = account.status !== "connected";
                                    return (
                                      <li key={account.id}>
                                        <label className={`flex items-center gap-3 px-4 py-3 ${
                                          unusable ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-slate-50"
                                        }`}>
                                          <input
                                            type="checkbox"
                                            className="h-4 w-4 accent-blue-700"
                                            checked={checked}
                                            disabled={unusable}
                                            onChange={() => toggleAccount(channel, account.id)}
                                          />
                                          <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium text-slate-900">
                                              {account.accountUsername || account.accountName || account.platformLabel}
                                            </span>
                                            <span className="mt-0.5 block text-xs text-slate-500">
                                              {account.platformLabel}
                                              {unusable && (account.status === "pending" ? " · รออนุญาตให้เสร็จ" : " · การเชื่อมต่อหลุด")}
                                            </span>
                                          </span>
                                        </label>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                              {missingAccount && available.length > 0 && (
                                <p className="mt-2 text-xs text-red-600">เลือกบัญชีอย่างน้อย 1 บัญชีก่อนเผยแพร่</p>
                              )}
                            </div>

                            <div className="rounded-xl bg-slate-50 p-4">
                              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-blue-700"
                                  checked={settings.advertisingEnabled}
                                  onChange={(event) => updateChannel(channel, {
                                    advertisingEnabled: event.target.checked,
                                    durationDays: settings.durationDays ?? DEFAULT_PROMOTION_DAYS,
                                  })}
                                />
                                โปรโมทแบบเสียเงิน (โฆษณา)
                              </label>
                              {settings.advertisingEnabled ? (
                                <div className="mt-4 space-y-4">
                                  <div className="grid gap-4 sm:grid-cols-2">
                                    <Select
                                      label="วิธีตั้งงบ"
                                      value={settings.budgetType}
                                      onChange={(event) => updateChannel(channel, { budgetType: event.target.value as "daily" | "total" })}
                                      options={[
                                        { value: "daily", label: "งบต่อวัน" },
                                        { value: "total", label: "งบรวมครั้งเดียวทั้งช่วง" },
                                      ]}
                                    />
                                    <Input
                                      label={settings.budgetType === "daily" ? "งบต่อวัน (บาท)" : "งบรวม (บาท)"}
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={settings.budget || ""}
                                      onChange={(event) => updateChannel(channel, { budget: Math.max(0, Number(event.target.value) || 0) })}
                                    />
                                  </div>

                                  <div>
                                    <span className="text-sm font-medium text-slate-700">ระยะเวลาโปรโมท</span>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                      {PROMOTION_DAY_PRESETS.map((preset) => (
                                        <button
                                          key={preset}
                                          type="button"
                                          onClick={() => updateChannel(channel, { durationDays: preset })}
                                          className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                                            days === preset
                                              ? "border-blue-600 bg-blue-600 text-white"
                                              : "border-slate-300 bg-white text-slate-700 hover:border-blue-300"
                                          }`}
                                        >
                                          {preset} วัน
                                        </button>
                                      ))}
                                      <label className="flex items-center gap-1.5 text-sm text-slate-600">
                                        หรือ
                                        <input
                                          type="number"
                                          min={1}
                                          max={MAX_PROMOTION_DAYS}
                                          value={days}
                                          onChange={(event) => updateChannel(channel, {
                                            durationDays: Math.min(MAX_PROMOTION_DAYS, Math.max(1, Math.round(Number(event.target.value) || 1))),
                                          })}
                                          className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                                          aria-label="จำนวนวันโปรโมท"
                                        />
                                        วัน
                                      </label>
                                    </div>
                                  </div>

                                  <Input
                                    label="กลุ่มเป้าหมายโฆษณา"
                                    value={settings.targetAudience}
                                    onChange={(event) => updateChannel(channel, { targetAudience: event.target.value })}
                                    placeholder="เช่น เจ้าของร้านอาหาร อายุ 25–45 ปี ในกรุงเทพฯ"
                                  />

                                  {channel === "tiktok" ? (
                                    <AdTargetingPanel
                                      value={settings.adTargeting}
                                      onChange={(adTargeting) => updateChannel(channel, {
                                        adTargeting,
                                        targetAudience: [
                                          adTargeting.locations.join("/"),
                                          `${adTargeting.ageMin}-${adTargeting.ageMax}`,
                                          adTargeting.gender,
                                          adTargeting.searchKeywords.filter((k) => k.action === "include").map((k) => k.text).slice(0, 5).join(", "),
                                        ].filter(Boolean).join(" · "),
                                      })}
                                    />
                                  ) : null}

                                  <div className="rounded-lg border border-blue-100 bg-white p-3 text-sm">
                                    <div className="flex items-baseline justify-between gap-3">
                                      <span className="text-slate-600">
                                        {settings.budgetType === "daily"
                                          ? `${formatBaht(settings.budget || 0)}/วัน × ${days} วัน`
                                          : `${formatBaht(settings.budget || 0)} ตลอด ${days} วัน (≈ ${formatBaht(promotionDaily(settings))}/วัน)`}
                                      </span>
                                      <span className="font-semibold text-slate-900">{formatBaht(perAccount)}{accountCount > 1 ? " / บัญชี" : ""}</span>
                                    </div>
                                    {accountCount > 1 && (
                                      <div className="mt-1 flex justify-between text-slate-600">
                                        <span>× {accountCount} บัญชี</span>
                                        <span className="font-semibold text-slate-900">{formatBaht(perAccount * accountCount)}</span>
                                      </div>
                                    )}
                                    <p className="mt-2 text-xs text-slate-500">
                                      RClipper ยังไม่ตัดเงินหรือซื้อโฆษณาให้ — ยอดนี้คืองบที่วางแผนไว้ ใช้เทียบความคุ้มค่าในแท็บ Analyze
                                      หลังโพสต์ขึ้นแล้วให้เปิดโปรโมทและชำระเองที่ {PROMOTION_PAY_AT[channel]}
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <p className="mt-2 text-xs text-slate-500">โพสต์แบบ organic อย่างเดียว — ไม่มีค่าใช้จ่าย</p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="mt-3 text-xs text-slate-400">ปิดการเผยแพร่ช่องทางนี้ไว้</p>
                        )}
                      </section>
                    );
                  })}
                </div>
              </Card>
            )}

            <Card className="border-emerald-200">
              <CardHeader>
                <CardTitle>4. เผยแพร่จริง</CardTitle>
                <CardDescription>
                  อัปโหลดวิดีโอแล้วโพสต์ไปยังทุกบัญชีที่เลือกไว้ด้านบนทันที จากนั้นติดตามผลและความคุ้มค่าได้ที่แท็บ Analyze
                </CardDescription>
              </CardHeader>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  loading={publishing}
                  disabled={!selectedDraft || !video || publishing}
                  onClick={requestPublish}
                >
                  {adGrandTotal > 0 ? `เผยแพร่ตอนนี้ · งบโฆษณา ${formatBaht(adGrandTotal)}` : "เผยแพร่ตอนนี้"}
                </Button>
                {uploadProgress !== null && (
                  <span className="text-sm text-slate-600">กำลังอัปโหลดวิดีโอ {uploadProgress}%</span>
                )}
                {!video && <span className="text-xs text-slate-500">เลือกวิดีโอในขั้นที่ 2 ก่อน</span>}
              </div>
              {validationError && <p className="mt-3 text-sm text-red-600" role="alert">{validationError}</p>}
              {publishError && <p className="mt-3 text-sm text-red-600" role="alert">{publishError}</p>}
              {published && (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <p className="font-semibold">ส่งโพสต์ไปยัง {published.targets.length} บัญชีแล้ว — แพลตฟอร์มกำลังประมวลผล</p>
                  <p className="mt-1">
                    ดูสถานะและผลลัพธ์ได้ที่{" "}
                    <a href={ROUTES.AD_LAB_ANALYZE} className="font-medium underline">แท็บ Analyze</a>
                    {" "}(กด “อัปเดตผลล่าสุด” หลังโพสต์ขึ้นแล้ว)
                  </p>
                  {publishedAdChannels.length > 0 && (
                    <div className="mt-3 rounded-lg bg-white/70 p-3 text-amber-900">
                      <p className="font-semibold">ขั้นต่อไป: เปิดโปรโมทและชำระค่าโฆษณาเองที่แพลตฟอร์ม</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {publishedAdChannels.map((channel) => (
                          <li key={channel}>
                            {CHANNEL_LABELS[channel]}: {PROMOTION_PAY_AT[channel]} · งบ {formatBaht(promotionTotal(channelSettings[channel]))}/บัญชี
                            {" "}{promotionDays(channelSettings[channel])} วัน
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-xs">กรอกค่าโฆษณาที่จ่ายจริงในแท็บ Analyze เพื่อคำนวณ ROAS / CPV</p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </>
        )}
      </div>

      {confirmOpen && video && (
        <PublishConfirmDialog
          videoName={video.name}
          caption={caption.trim()}
          lines={confirmLines}
          onConfirm={() => void publishNow()}
          onClose={() => setConfirmOpen(false)}
        />
      )}

      {accountsDialogOpen && (
        <SocialAccountsDialog
          brandId={selectedBrandId}
          brandName={brand.name}
          linkedAccounts={brandAccounts}
          onLink={linkAccount}
          onUnlink={unlinkAccount}
          onClose={() => setAccountsDialogOpen(false)}
        />
      )}
    </>
  );
}
