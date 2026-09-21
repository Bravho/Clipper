"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  STUDIO_CHANNELS,
  type StudioChannel,
  type StudioChannelPublishingSettings,
  type StudioPublishingPlan,
  type StudioSocialAccount,
} from "@/domain/models/Studio";
import { useStudioStore } from "./useStudioStore";
import { saveStudioPublishingVideo } from "./studioVideoStorage";
import { SocialAccountsDialog } from "./SocialAccountsDialog";
import { CHANNEL_ACCENT, CHANNEL_LABELS } from "./socialAccountChannels";

type ChannelSettingsMap = Record<StudioChannel, StudioChannelPublishingSettings>;

/**
 * Builds the per-channel settings for a freshly selected script plan.
 *
 * Every connected account of the brand is pre-selected: a user who linked an
 * account to the brand meant it to publish, and unticking is cheaper than
 * hunting for the one account they wanted. Accounts still pending
 * authorisation are left out — the provider cannot post through them yet.
 */
function defaultChannelSettings(
  channels: StudioChannel[],
  accounts: StudioSocialAccount[]
): ChannelSettingsMap {
  return Object.fromEntries(STUDIO_CHANNELS.map((channel) => [channel, {
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
  const { store, ready, update } = useStudioStore();

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

  function updateChannel(channel: StudioChannel, patch: Partial<StudioChannelPublishingSettings>) {
    setChannelSettings((current) => ({
      ...current,
      [channel]: { ...current[channel], ...patch },
    }));
    setSaved(false);
    setValidationError("");
  }

  function toggleAccount(channel: StudioChannel, accountId: string) {
    const selected = channelSettings[channel].accountIds;
    updateChannel(channel, {
      accountIds: selected.includes(accountId)
        ? selected.filter((id) => id !== accountId)
        : [...selected, accountId],
    });
  }

  function linkAccount(account: StudioSocialAccount) {
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
      STUDIO_CHANNELS.map((channel) => [channel, {
        ...current[channel],
        accountIds: current[channel].accountIds.filter((id) => id !== accountId),
      }])
    ) as ChannelSettingsMap);
    setSaved(false);
  }

  const activeChannels = selectedDraft?.channels.filter((channel) => channelSettings[channel].publish) ?? [];
  const channelsMissingAccount = activeChannels.filter((channel) => channelSettings[channel].accountIds.length === 0);

  async function savePublishingPlan(event: FormEvent) {
    event.preventDefault();
    if (!selectedDraft || !video) return;
    if (activeChannels.length === 0) {
      setValidationError("เลือกอย่างน้อย 1 ช่องทางที่จะเผยแพร่");
      return;
    }
    if (channelsMissingAccount.length > 0) {
      setValidationError(
        `เลือกบัญชีอย่างน้อย 1 บัญชีสำหรับ ${channelsMissingAccount.map((channel) => CHANNEL_LABELS[channel]).join(", ")}`
      );
      return;
    }

    const id = crypto.randomUUID();
    const plan: StudioPublishingPlan = {
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
      await saveStudioPublishingVideo(id, video);
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
              <p className="mt-3 text-xs text-amber-700">Private Lab เก็บแผนและไฟล์วิดีโอไว้ใน browser เครื่องนี้ การส่งขึ้นบัญชีจริงจะพร้อมเมื่อเชื่อมต่อช่องทาง production</p>
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
