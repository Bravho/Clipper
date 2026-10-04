"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
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
  type AdLabSocialAccount,
} from "@/domain/models/AdLab";
import { useAdLabStore } from "./useAdLabStore";
import { saveAdLabPublishingVideo } from "./adLabVideoStorage";
import { SocialAccountsDialog } from "./SocialAccountsDialog";
import { CHANNEL_ACCENT, CHANNEL_LABELS } from "./socialAccountChannels";
import { publishAdLabVideo, uploadAdLabVideo } from "./adLabPublishingClient";
import type { AdLabPublication } from "@/domain/models/AdLabPublication";
import { ROUTES } from "@/config/routes";

type ChannelSettingsMap = Record<AdLabChannel, AdLabChannelPublishingSettings>;

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
    targetAudience: "",
  }])) as ChannelSettingsMap;
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
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [publishError, setPublishError] = useState("");
  const [published, setPublished] = useState<AdLabPublication | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  // Switching brand (or approving a new plan) must always leave a valid plan
  // selected, so the video and channel settings below stay in step with it.
  useEffect(() => {
    if (approvedDrafts.some((draft) => draft.id === selectedDraftId)) return;
    const next = approvedDrafts[0];
    setSelectedDraftId(next?.id ?? "");
    setChannelSettings(defaultChannelSettings(next?.channels ?? [], brandAccounts));
    setSaved(false);
    setValidationError("");
  }, [approvedDrafts, brandAccounts, selectedDraftId]);

  const selectedDraft = approvedDrafts.find((draft) => draft.id === selectedDraftId);

  function selectBrand(id: string) {
    if (id === selectedBrandId) return;
    void update((current) => ({ ...current, selectedBrandId: id }));
    setVideo(null);
    setCaption("");
    setSaved(false);
    setSaveError("");
    setValidationError("");
  }

  function selectDraft(id: string) {
    const draft = approvedDrafts.find((item) => item.id === id);
    setSelectedDraftId(id);
    setChannelSettings(defaultChannelSettings(draft?.channels ?? [], brandAccounts));
    setSaved(false);
    setValidationError("");
  }

  function selectVideo(event: ChangeEvent<HTMLInputElement>) {
    setVideo(event.target.files?.[0] ?? null);
    setSaved(false);
    setSaveError("");
  }

  function updateChannel(channel: AdLabChannel, patch: Partial<AdLabChannelPublishingSettings>) {
    setChannelSettings((current) => ({
      ...current,
      [channel]: { ...current[channel], ...patch },
    }));
    setSaved(false);
    setValidationError("");
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
    setSaved(false);
  }

  const activeChannels = selectedDraft?.channels.filter((channel) => channelSettings[channel].publish) ?? [];
  const channelsMissingAccount = activeChannels.filter((channel) => channelSettings[channel].accountIds.length === 0);

  /** Shared by "save plan" and "publish now": both need a complete plan. */
  function validatePlan(): boolean {
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
    return true;
  }

  /**
   * Publish for real: upload the video to storage, then send one post to every
   * selected account through the connected-accounts provider. Asks for a
   * second click first — a published post cannot be taken back from here.
   */
  async function publishNow() {
    if (!validatePlan() || !selectedDraft || !video) return;
    if (!confirmPublish) {
      setConfirmPublish(true);
      return;
    }
    setConfirmPublish(false);
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
          plannedBudget: settings.advertisingEnabled ? settings.budget : 0,
        }));
      });
      const publication = await publishAdLabVideo({
        brandId: selectedDraft.brandId,
        draftId: selectedDraft.id,
        campaignName: selectedDraft.title,
        title: selectedDraft.title,
        caption: caption.trim(),
        videoKey,
        videoName: video.name,
        targets,
      });
      setPublished(publication);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "เผยแพร่ไม่สำเร็จ");
    } finally {
      setPublishing(false);
      setUploadProgress(null);
    }
  }

  async function savePublishingPlan(event: FormEvent) {
    event.preventDefault();
    if (!validatePlan() || !selectedDraft || !video) return;

    const id = crypto.randomUUID();
    const plan: AdLabPublishingPlan = {
      id,
      draftId: selectedDraft.id,
      brandId: selectedDraft.brandId,
      videoStorageKey: id,
      videoName: video.name,
      videoSize: video.size,
      videoType: video.type,
      caption: caption.trim(),
      channelSettings,
      status: "ready",
      updatedAt: new Date().toISOString(),
    };
    setSaving(true);
    setSaveError("");
    setValidationError("");
    try {
      await saveAdLabPublishingVideo(id, video);
      await update((current) => ({ ...current, publishingPlans: [plan, ...current.publishingPlans] }));
      setSaved(true);
    } catch {
      setSaveError("ไม่สามารถจัดเก็บไฟล์วิดีโอใน browser ได้ โปรดตรวจพื้นที่ว่างแล้วลองใหม่");
    } finally {
      setSaving(false);
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

  return (
    <>
      <form onSubmit={savePublishingPlan} className="space-y-6">
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
                <CardDescription>แสดงเฉพาะแผนที่อนุมัติแล้วของแบรนด์ที่เลือกไว้ด้านบน</CardDescription>
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
                <CardTitle>2. อัปโหลดวิดีโอ</CardTitle>
                <CardDescription>เลือกวิดีโอที่สร้างตาม Script plan ด้านบน</CardDescription>
              </CardHeader>
              <input
                type="file"
                accept="video/*"
                onChange={selectVideo}
                className="block w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:font-medium file:text-blue-700 hover:file:bg-blue-100"
              />
              {video && <p className="mt-2 text-sm text-slate-600">{video.name} · {(video.size / 1024 / 1024).toFixed(1)} MB</p>}
              <div className="mt-4">
                <Textarea
                  label="Caption กลาง"
                  value={caption}
                  onChange={(event) => { setCaption(event.target.value); setSaved(false); }}
                  placeholder="ข้อความหลักที่จะใช้เป็นจุดเริ่มต้นสำหรับทุกช่องทาง"
                />
              </div>
            </Card>

            {selectedDraft && (
              <Card padding="none" className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
                  <div>
                    <CardTitle>3. ตั้งค่าการเผยแพร่และโฆษณา</CardTitle>
                    <CardDescription>เลือกบัญชีปลายทางและงบโฆษณาแยกตามช่องทางใน Campaign brief</CardDescription>
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
                                <p className="mt-2 text-xs text-red-600">เลือกบัญชีอย่างน้อย 1 บัญชีก่อนบันทึก</p>
                              )}
                            </div>

                            <div className="rounded-xl bg-slate-50 p-4">
                              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-blue-700"
                                  checked={settings.advertisingEnabled}
                                  onChange={(event) => updateChannel(channel, { advertisingEnabled: event.target.checked })}
                                />
                                เปิดการโฆษณา
                              </label>
                              {settings.advertisingEnabled ? (
                                <div className="mt-4 space-y-4">
                                  <div className="grid gap-4 sm:grid-cols-2">
                                    <Select
                                      label="ประเภทงบประมาณ"
                                      value={settings.budgetType}
                                      onChange={(event) => updateChannel(channel, { budgetType: event.target.value as "daily" | "total" })}
                                      options={[{ value: "daily", label: "งบต่อวัน" }, { value: "total", label: "งบรวมทั้งแคมเปญ" }]}
                                    />
                                    <Input
                                      label="งบประมาณ (บาท)"
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={settings.budget || ""}
                                      onChange={(event) => updateChannel(channel, { budget: Number(event.target.value) })}
                                    />
                                  </div>
                                  <Input
                                    label="กลุ่มเป้าหมายโฆษณา"
                                    value={settings.targetAudience}
                                    onChange={(event) => updateChannel(channel, { targetAudience: event.target.value })}
                                    placeholder="เช่น เจ้าของร้านอาหาร อายุ 25–45 ปี ในกรุงเทพฯ"
                                  />
                                </div>
                              ) : (
                                <p className="mt-2 text-xs text-slate-500">เผยแพร่แบบ organic อย่างเดียว</p>
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

            <Card>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" loading={saving} disabled={!selectedDraft || !video}>บันทึกแผนเผยแพร่</Button>
                {saved && <span className="text-sm font-medium text-emerald-700">จับคู่วิดีโอกับ Script plan และบันทึกแล้ว</span>}
                <span className="ml-auto text-xs text-slate-400">แผนเผยแพร่ทั้งหมด: {store.publishingPlans.length}</span>
              </div>
              {validationError && <p className="mt-3 text-sm text-red-600" role="alert">{validationError}</p>}
              {saveError && <p className="mt-3 text-sm text-red-600" role="alert">{saveError}</p>}
              <p className="mt-3 text-xs text-slate-500">“บันทึกแผน” เก็บแผนและไฟล์ไว้ใน browser เครื่องนี้เท่านั้น ยังไม่โพสต์ขึ้นบัญชีจริง</p>
            </Card>

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
                  variant={confirmPublish ? "danger" : "primary"}
                  loading={publishing}
                  disabled={!selectedDraft || !video || publishing}
                  onClick={() => void publishNow()}
                >
                  {confirmPublish
                    ? `ยืนยัน: โพสต์ไป ${activeChannels.reduce((n, c) => n + channelSettings[c].accountIds.length, 0)} บัญชีตอนนี้`
                    : "เผยแพร่ตอนนี้"}
                </Button>
                {confirmPublish && !publishing && (
                  <Button type="button" variant="ghost" onClick={() => setConfirmPublish(false)}>ยกเลิก</Button>
                )}
                {uploadProgress !== null && (
                  <span className="text-sm text-slate-600">กำลังอัปโหลดวิดีโอ {uploadProgress}%</span>
                )}
              </div>
              {confirmPublish && (
                <p className="mt-3 text-sm text-amber-700">
                  โพสต์ที่ขึ้นแพลตฟอร์มแล้วลบจากที่นี่ไม่ได้ ตรวจ caption และบัญชีให้ถูกต้องก่อนยืนยัน
                </p>
              )}
              {publishError && <p className="mt-3 text-sm text-red-600" role="alert">{publishError}</p>}
              {published && (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <p className="font-semibold">ส่งโพสต์ไปยัง {published.targets.length} บัญชีแล้ว — แพลตฟอร์มกำลังประมวลผล</p>
                  <p className="mt-1">
                    ดูสถานะและผลลัพธ์ได้ที่{" "}
                    <a href={ROUTES.AD_LAB_ANALYZE} className="font-medium underline">แท็บ Analyze</a>
                    {" "}(กด “อัปเดตผลล่าสุด” หลังโพสต์ขึ้นแล้ว)
                  </p>
                </div>
              )}
            </Card>
          </>
        )}
      </form>

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
