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
} from "@/domain/models/Studio";
import { useStudioStore } from "./useStudioStore";
import { saveStudioPublishingVideo } from "./studioVideoStorage";

const channelLabels: Record<StudioChannel, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
};

function defaultChannelSettings(channels: StudioChannel[]): Record<StudioChannel, StudioChannelPublishingSettings> {
  return Object.fromEntries(STUDIO_CHANNELS.map((channel) => [channel, {
    publish: channels.includes(channel),
    advertisingEnabled: false,
    budgetType: "daily",
    budget: 0,
    targetAudience: "",
  }])) as Record<StudioChannel, StudioChannelPublishingSettings>;
}

export function PublishingWorkspace() {
  const { store, ready, update } = useStudioStore();
  const approvedDrafts = useMemo(
    () => store.drafts.filter((draft) => draft.status === "approved"),
    [store.drafts]
  );
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [channelSettings, setChannelSettings] = useState(() => defaultChannelSettings([]));
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!selectedDraftId && approvedDrafts[0]) {
      setSelectedDraftId(approvedDrafts[0].id);
      setChannelSettings(defaultChannelSettings(approvedDrafts[0].channels));
    }
  }, [approvedDrafts, selectedDraftId]);

  const selectedDraft = approvedDrafts.find((draft) => draft.id === selectedDraftId);

  function selectDraft(id: string) {
    const draft = approvedDrafts.find((item) => item.id === id);
    setSelectedDraftId(id);
    setChannelSettings(defaultChannelSettings(draft?.channels ?? []));
    setSaved(false);
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
  }

  async function savePublishingPlan(event: FormEvent) {
    event.preventDefault();
    if (!selectedDraft || !video || !selectedDraft.channels.some((channel) => channelSettings[channel].publish)) return;

    const id = crypto.randomUUID();
    const plan: StudioPublishingPlan = {
      id,
      draftId: selectedDraft.id,
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
    try {
      await saveStudioPublishingVideo(id, video);
      update((current) => ({ ...current, publishingPlans: [plan, ...current.publishingPlans] }));
      setSaved(true);
    } catch {
      setSaveError("ไม่สามารถจัดเก็บไฟล์วิดีโอใน browser ได้ โปรดตรวจพื้นที่ว่างแล้วลองใหม่");
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return <Card><p className="text-sm text-slate-500">กำลังโหลดข้อมูล…</p></Card>;

  if (approvedDrafts.length === 0) {
    return (
      <Card className="border-dashed text-center">
        <h2 className="text-lg font-semibold text-slate-900">ยังไม่มี Script plan ที่อนุมัติแล้ว</h2>
        <p className="mt-1 text-sm text-slate-500">ไปที่แท็บ Create สร้างและอนุมัติแผนก่อน แล้วแผนนั้นจะพร้อมให้เลือกที่นี่</p>
      </Card>
    );
  }

  return (
    <form onSubmit={savePublishingPlan} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>1. เลือก Script plan</CardTitle>
          <CardDescription>วิดีโอและการตั้งค่าเผยแพร่จะถูกบันทึกให้ตรงกับแผนที่เลือก</CardDescription>
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
            <p className="mt-2 text-xs text-slate-500">ความยาว {Number(selectedDraft.duration) >= 60 ? `${Number(selectedDraft.duration) / 60} นาที` : `${selectedDraft.duration} วินาที`} · {selectedDraft.channels.map((channel) => channelLabels[channel]).join(", ")}</p>
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
          <Textarea label="Caption กลาง" value={caption} onChange={(event) => { setCaption(event.target.value); setSaved(false); }} placeholder="ข้อความหลักที่จะใช้เป็นจุดเริ่มต้นสำหรับทุกช่องทาง" />
        </div>
      </Card>

      {selectedDraft && (
        <Card>
          <CardHeader>
            <CardTitle>3. ตั้งค่าการเผยแพร่และโฆษณา</CardTitle>
            <CardDescription>ตั้งค่าแยกตามช่องทางที่เลือกไว้ใน Campaign brief</CardDescription>
          </CardHeader>
          <div className="grid gap-4 lg:grid-cols-2">
            {selectedDraft.channels.map((channel) => {
              const settings = channelSettings[channel];
              return (
                <section key={channel} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-slate-900">{channelLabels[channel]}</h3>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={settings.publish} onChange={(event) => updateChannel(channel, { publish: event.target.checked, advertisingEnabled: event.target.checked ? settings.advertisingEnabled : false })} />
                      เผยแพร่ช่องทางนี้
                    </label>
                  </div>
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input type="checkbox" disabled={!settings.publish} checked={settings.advertisingEnabled} onChange={(event) => updateChannel(channel, { advertisingEnabled: event.target.checked })} />
                      เปิดการโฆษณา
                    </label>
                    {settings.advertisingEnabled && (
                      <div className="mt-4 space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Select label="ประเภทงบประมาณ" value={settings.budgetType} onChange={(event) => updateChannel(channel, { budgetType: event.target.value as "daily" | "total" })} options={[{ value: "daily", label: "งบต่อวัน" }, { value: "total", label: "งบรวมทั้งแคมเปญ" }]} />
                          <Input label="งบประมาณ (บาท)" type="number" min="0" step="1" value={settings.budget || ""} onChange={(event) => updateChannel(channel, { budget: Number(event.target.value) })} />
                        </div>
                        <Input label="กลุ่มเป้าหมายโฆษณา" value={settings.targetAudience} onChange={(event) => updateChannel(channel, { targetAudience: event.target.value })} placeholder="เช่น เจ้าของร้านอาหาร อายุ 25–45 ปี ในกรุงเทพฯ" />
                      </div>
                    )}
                  </div>
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
        {saveError && <p className="mt-3 text-sm text-red-600" role="alert">{saveError}</p>}
        <p className="mt-3 text-xs text-amber-700">Private Lab เก็บแผนและไฟล์วิดีโอไว้ใน browser เครื่องนี้ การส่งขึ้นบัญชีจริงจะพร้อมเมื่อเชื่อมต่อช่องทาง production</p>
      </Card>
    </form>
  );
}
