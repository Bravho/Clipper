"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { STUDIO_CHANNELS, type StudioChannel, type StudioScriptDraft } from "@/domain/models/Studio";
import { useStudioStore, type StudioClientPersistence } from "./useStudioStore";
import { PRESENTATION_DIRECTIONS } from "@/services/studio/storytellingKnowledge";
import type { StudioScriptPlan } from "@/services/studio/StudioPrototypeService";
import { formatScriptDocument, parseScriptDocument } from "@/services/studio/scriptDocument";
import { ScriptDocumentEditor } from "./ScriptDocumentEditor";
import { StudioScriptList } from "./StudioScriptList";

const channelLabels: Record<StudioChannel, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
};

export function CreateWorkspace() {
  const { store, ready, update, persistence } = useStudioStore();
  const [mainMessage, setMainMessage] = useState("");
  const [detailedContent, setDetailedContent] = useState("");
  const [presentationDirection, setPresentationDirection] = useState("problem-solution");
  const [customPresentationDirection, setCustomPresentationDirection] = useState("");
  const [objective, setObjective] = useState("conversion");
  const [duration, setDuration] = useState("30");
  const [title, setTitle] = useState("");
  const [mainHook, setMainHook] = useState("");
  const [scriptPlan, setScriptPlan] = useState("");
  const [scriptPlanHtml, setScriptPlanHtml] = useState("");
  const [revisionComment, setRevisionComment] = useState("");
  const [channels, setChannels] = useState<StudioChannel[]>(["tiktok"]);
  const [saved, setSaved] = useState(false);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [isApproved, setIsApproved] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const [draftLoadMessage, setDraftLoadMessage] = useState("");
  const [saveLocation, setSaveLocation] = useState<StudioClientPersistence | null>(null);
  const [hydratedBrandId, setHydratedBrandId] = useState("");
  /** True when the editor holds changes that have not been saved yet. */
  const [isDirty, setIsDirty] = useState(false);

  const selectedBrandId = store.selectedBrandId || store.brands[0]?.id || "";
  const brand = useMemo(
    () => store.brands.find((item) => item.id === selectedBrandId),
    [selectedBrandId, store.brands]
  );
  const brandDrafts = useMemo(
    () => store.drafts.filter((item) => item.brandId === selectedBrandId),
    [selectedBrandId, store.drafts]
  );

  /** Wraps a field setter so any user edit marks the form as unsaved. */
  function edited<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setSaved(false);
      setIsDirty(true);
    };
  }

  function confirmDiscardChanges() {
    if (!isDirty) return true;
    return window.confirm("มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกจากสคริปต์นี้หรือไม่?");
  }

  const restoreDraft = useCallback((draft: StudioScriptDraft) => {
    const knownDirection = PRESENTATION_DIRECTIONS.some(
      (item) => item.value !== "custom" && item.value === draft.presentationDirection
    );
    const legacyCombinedDocument = draft.scriptPlan?.includes("【ชื่อคลิป】")
      || draft.scriptPlan?.includes("【1. Main Hook");
    setMainMessage(draft.mainMessage);
    setDetailedContent(draft.detailedContent);
    setPresentationDirection(knownDirection ? draft.presentationDirection : "custom");
    setCustomPresentationDirection(knownDirection ? "" : draft.presentationDirection);
    setObjective(draft.objective);
    setDuration(draft.duration);
    setTitle(draft.title);
    setMainHook(draft.mainHook);
    setScriptPlan(draft.scriptPlan && !legacyCombinedDocument ? draft.scriptPlan : formatScriptDocument(draft));
    setScriptPlanHtml(legacyCombinedDocument ? "" : draft.scriptPlanHtml || "");
    setRevisionComment(draft.revisionComment || "");
    setChannels(draft.channels);
    setSavedDraftId(draft.id);
    setIsApproved(false);
    setSaveLocation(persistence);
    setSaved(true);
    setGenerationError("");
    setIsDirty(false);
  }, [persistence]);

  /** Open an existing script in the editor (read-only load, no save indicator). */
  const openDraft = useCallback((draft: StudioScriptDraft) => {
    restoreDraft(draft);
    setIsApproved(draft.status === "approved");
    setSaved(false);
    setSaveLocation(null);
    setDraftLoadMessage("");
  }, [restoreDraft]);

  /** Clear the editor for a brand-new script under the selected brand. */
  const resetToNewScript = useCallback(() => {
    setMainMessage("");
    setDetailedContent("");
    setPresentationDirection("problem-solution");
    setCustomPresentationDirection("");
    setObjective("conversion");
    setDuration("30");
    setTitle("");
    setMainHook("");
    setScriptPlan("");
    setScriptPlanHtml("");
    setRevisionComment("");
    setChannels(["tiktok"]);
    setSavedDraftId(null);
    setIsApproved(false);
    setSaveLocation(null);
    setSaved(false);
    setGenerationError("");
    setDraftLoadMessage("");
    setIsDirty(false);
  }, []);

  useEffect(() => {
    if (!ready || !selectedBrandId || hydratedBrandId === selectedBrandId) return;

    // Switching brand opens that brand's most recently edited script, if any.
    const draft = [...brandDrafts]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

    if (draft) openDraft(draft);
    else resetToNewScript();
    setHydratedBrandId(selectedBrandId);
  }, [brandDrafts, hydratedBrandId, openDraft, ready, resetToNewScript, selectedBrandId]);

  function selectBrand(id: string) {
    if (id === selectedBrandId || !confirmDiscardChanges()) return;
    update((current) => ({ ...current, selectedBrandId: id }));
  }

  function selectScript(draft: StudioScriptDraft) {
    if (draft.id === savedDraftId || !confirmDiscardChanges()) return;
    openDraft(draft);
  }

  function createNewScript() {
    // Already on a new script: keep whatever the user has typed so far.
    if (savedDraftId === null || !confirmDiscardChanges()) return;
    resetToNewScript();
  }

  function applyScript(script: StudioScriptPlan) {
    setTitle(script.title);
    setMainHook(script.mainHook);
    setScriptPlan(formatScriptDocument(script));
    setScriptPlanHtml("");
    setSaved(false);
    setIsDirty(true);
  }

  async function generateOutline(withRevisionComment = false) {
    if (!brand) return;
    if (withRevisionComment && !revisionComment.trim()) {
      setGenerationError("กรุณาเขียน Comment ก่อนให้ AI สร้างสคริปต์ใหม่");
      return;
    }
    const resolvedDirection = presentationDirection === "custom"
      ? customPresentationDirection.trim()
      : presentationDirection;
    setIsGenerating(true);
    setGenerationError("");
    try {
      const response = await fetch("/api/studio/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand,
          input: {
            mainMessage, detailedContent, presentationDirection: resolvedDirection, objective, duration,
            ...(withRevisionComment ? {
              revisionComment: revisionComment.trim(),
              currentDraft: { title, mainHook, scriptPlan },
            } : {}),
          },
        }),
      });
      const data = await response.json() as {
        script?: StudioScriptPlan;
        source?: "openai" | "fallback";
        warning?: string;
        error?: string;
      };
      if (!response.ok || !data.script) throw new Error(data.error || "สร้างสคริปต์ไม่สำเร็จ");
      applyScript(data.script);
      if (data.source === "fallback") {
        setGenerationError(`ยังไม่ได้ใช้ ChatGPT: ${data.warning || "ตรวจสอบ OpenAI API configuration"}`);
      }
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "สร้างสคริปต์ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setIsGenerating(false);
    }
  }

  async function persistPlan(status: StudioScriptDraft["status"]) {
    if (!brand || !title.trim() || !mainHook.trim() || !scriptPlan.trim() || channels.length === 0) return;
    setDraftLoadMessage("");
    const resolvedDirection = presentationDirection === "custom"
      ? customPresentationDirection.trim()
      : presentationDirection;
    const id = savedDraftId ?? crypto.randomUUID();
    const parsedScript = parseScriptDocument(scriptPlan, { title, mainHook });
    const draft: StudioScriptDraft = {
      id, brandId: brand.id, mainMessage, detailedContent,
      presentationDirection: resolvedDirection, objective, duration, scriptPlan, scriptPlanHtml, revisionComment,
      ...parsedScript,
      channels, status, updatedAt: new Date().toISOString(),
    };
    setIsSaving(true);
    setSaved(false);
    try {
      const destination = await update((current) => ({
        ...current,
        drafts: current.drafts.some((item) => item.id === id)
          ? current.drafts.map((item) => item.id === id ? draft : item)
          : [draft, ...current.drafts],
      }));
      setSavedDraftId(id);
      setIsApproved(status === "approved");
      setSaveLocation(destination);
      setSaved(true);
      setIsDirty(false);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    await persistPlan("draft");
  }

  async function approvePlan() {
    await persistPlan("approved");
  }

  async function loadLatestDraft() {
    if (!confirmDiscardChanges()) return;
    setIsLoadingDraft(true);
    setDraftLoadMessage("");
    setGenerationError("");
    setSaved(false);
    setSaveLocation(null);
    try {
      const response = await fetch("/api/studio/workspace", { cache: "no-store" });
      if (!response.ok) throw new Error("ไม่สามารถโหลด Draft จากฐานข้อมูลได้");
      const payload = await response.json() as {
        store: typeof store | null;
      };
      const latestDraft = payload.store?.drafts
        .filter((item) => item.brandId === selectedBrandId && item.status === "draft")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      if (!latestDraft) {
        setDraftLoadMessage("ไม่พบ Draft ที่บันทึกไว้สำหรับแบรนด์นี้");
        return;
      }

      restoreDraft(latestDraft);
      // Loading is read-only: do not reuse the save-success indicators.
      setSaved(false);
      setSaveLocation(null);
      setDraftLoadMessage("โหลด Draft ล่าสุดจากฐานข้อมูลแล้ว");
    } catch (error) {
      setDraftLoadMessage(error instanceof Error ? error.message : "ไม่สามารถโหลด Draft จากฐานข้อมูลได้");
    } finally {
      setIsLoadingDraft(false);
    }
  }

  function editApprovedPlan() {
    if (savedDraftId) {
      update((current) => ({
        ...current,
        drafts: current.drafts.map((item) => item.id === savedDraftId
          ? { ...item, status: "draft", updatedAt: new Date().toISOString() }
          : item),
      }));
    }
    setIsApproved(false);
    setSaved(false);
  }

  function toggleChannel(channel: StudioChannel) {
    setChannels((current) => current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel]);
    setSaved(false);
    setIsDirty(true);
  }

  if (!ready) return <Card><p className="text-sm text-slate-500">กำลังโหลดข้อมูล…</p></Card>;
  if (!brand) {
    return (
      <Card className="border-dashed text-center">
        <h2 className="text-lg font-semibold">เพิ่ม Brand ก่อนเริ่มสร้างสคริปต์</h2>
        <p className="mt-1 text-sm text-slate-500">ไปที่แท็บ Brands แล้วกรอกข้อมูลพื้นฐานเพียง 5 ช่อง</p>
      </Card>
    );
  }

  return (
    <form onSubmit={saveDraft} className="space-y-6">
      {/* Brand + script navigation stay outside the fieldset so an approved
          (read-only) script never blocks switching to another script. */}
      <Card className="border-blue-200 bg-blue-50/40">
        <div className="grid gap-4 md:grid-cols-[1fr_2fr] md:items-end">
          <Select label="แบรนด์ที่ใช้กับคลิปนี้" value={selectedBrandId} onChange={(e) => selectBrand(e.target.value)} disabled={isSaving || isGenerating} options={store.brands.map((item) => ({ value: item.id, label: item.name }))} />
          <div className="rounded-lg bg-white px-4 py-3 text-sm text-slate-600">
            <span className="font-medium text-slate-900">{brand.product || "สินค้า/บริการยังไม่ระบุ"}</span>
            <span className="mx-2 text-slate-300">•</span>{brand.audience || "กลุ่มเป้าหมายยังไม่ระบุ"}
          </div>
        </div>
      </Card>

      <StudioScriptList
        drafts={brandDrafts}
        activeDraftId={savedDraftId}
        onSelect={selectScript}
        onCreate={createNewScript}
        disabled={isSaving || isGenerating || isLoadingDraft}
      />

      <fieldset disabled={isApproved} className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card className="h-fit">
          <CardHeader><CardTitle>1. Campaign brief</CardTitle><CardDescription>กำหนดเป้าหมายก่อนเขียน เพื่อให้ทุกฉากทำหน้าที่ชัดเจน</CardDescription></CardHeader>
          <div className="space-y-4">
            <Textarea autoGrow label="ข้อความหลักที่ต้องการจะนำเสนอ" value={mainMessage} onChange={(e) => edited(setMainMessage)(e.target.value)} placeholder={`เช่น ${brand.promise || `${brand.name} ช่วยให้ลูกค้าได้ผลลัพธ์ที่ดีขึ้น`}`} />
            <Textarea autoGrow label="เนื้อหาและข้อมูลอ้างอิง" value={detailedContent} onChange={(e) => edited(setDetailedContent)(e.target.value)} placeholder="ใส่ข้อเท็จจริงจากเอกสารสินค้า จุดเด่น ตัวอย่าง เหตุผล หรือข้อมูลที่ AI ต้องใช้เขียนบท (AI จะไม่แต่งข้ออ้างที่ไม่มีในข้อมูลนี้)" />
            <Select label="แนวทางการนำเสนอ" value={presentationDirection} onChange={(e) => edited(setPresentationDirection)(e.target.value)} options={[...PRESENTATION_DIRECTIONS]} />
            {presentationDirection === "custom" && (
              <Input label="กำหนดแนวทางการนำเสนอเอง" value={customPresentationDirection} onChange={(e) => edited(setCustomPresentationDirection)(e.target.value)} placeholder="เช่น เล่าผ่านหนึ่งวันของเจ้าของร้าน แบบอบอุ่นและเป็นกันเอง" />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="ความยาว" value={duration} onChange={(e) => edited(setDuration)(e.target.value)} options={[{ value: "15", label: "15 วินาที" }, { value: "30", label: "30 วินาที" }, { value: "45", label: "45 วินาที" }, { value: "60", label: "1 นาที" }, { value: "90", label: "1 นาที 30 วินาที" }, { value: "120", label: "2 นาที" }, { value: "180", label: "3 นาที" }, { value: "300", label: "5 นาที" }, { value: "600", label: "10 นาที" }]} />
              <Select label="เป้าหมายหลัก" value={objective} onChange={(e) => edited(setObjective)(e.target.value)} options={[{ value: "awareness", label: "ให้คนรู้จักและจดจำแบรนด์" }, { value: "consideration", label: "ให้คนสนใจและพิจารณาสินค้า" }, { value: "conversion", label: "ให้คนตัดสินใจซื้อ สมัคร หรือติดต่อ" }]} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">ช่องทางเผยแพร่</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {STUDIO_CHANNELS.map((channel) => (
                  <label key={channel} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                    <input type="checkbox" checked={channels.includes(channel)} onChange={() => toggleChannel(channel)} className="h-4 w-4" />
                    <span className="text-sm font-medium">{channelLabels[channel]}</span>
                  </label>
                ))}
              </div>
            </div>
            <Button type="button" onClick={() => void generateOutline()} loading={isGenerating} fullWidth>
              {isGenerating ? "AI กำลังเขียนสคริปต์…" : "สร้างสคริปต์พร้อมพูดด้วย AI"}
            </Button>
            {generationError && <p role="alert" className="text-sm text-red-600">{generationError}</p>}
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>2. Script & scene plan</CardTitle><CardDescription>ชื่อและ Hook แยกสำหรับตรวจแก้ได้รวดเร็ว ส่วนบทพูดแบ่งเพียง 3–4 หัวข้อที่ AI เลือกให้เหมาะกับบริบทของเนื้อหา</CardDescription></CardHeader>
          <div className="mb-4 grid gap-4">
            <Input label="ชื่อคลิป" value={title} onChange={(event) => edited(setTitle)(event.target.value)} placeholder="ชื่อที่สื่อสารแก่นของคลิปอย่างกระชับ" />
            <Input label="Main Hook" value={mainHook} onChange={(event) => edited(setMainHook)(event.target.value)} hint="ประโยคเปิดคลิปหลักหนึ่งประโยค" />
          </div>
          <ScriptDocumentEditor
            value={scriptPlan}
            htmlValue={scriptPlanHtml}
            onChange={(value, html) => {
              // The editor also emits on blur; only real content changes count as edits.
              if (value === scriptPlan && html === scriptPlanHtml) return;
              setScriptPlan(value);
              setScriptPlanHtml(html);
              setSaved(false);
              setIsDirty(true);
            }}
            readOnly={isApproved}
          />
          <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
            <Textarea
              autoGrow
              label="Comment สำหรับแก้ไขสคริปต์"
              value={revisionComment}
              onChange={(event) => edited(setRevisionComment)(event.target.value)}
              placeholder="เช่น ทำให้น้ำเสียงเป็นกันเองขึ้น ลดการพูดถึงแบรนด์ช่วงต้น และเพิ่มตัวอย่างที่เห็นภาพชัดเจน"
              hint="AI จะใช้ Comment นี้แก้ไขชื่อคลิป Main Hook หัวข้อ และบทพูด โดยยังอ้างอิงเฉพาะข้อมูลจริงใน Campaign Brief"
            />
            <Button
              type="button"
              className="mt-3"
              onClick={() => void generateOutline(true)}
              loading={isGenerating}
              disabled={!revisionComment.trim()}
              fullWidth
            >
              {isGenerating ? "AI กำลังแก้ไขสคริปต์…" : "ให้ AI สร้างใหม่ตาม Comment"}
            </Button>
          </div>
        </Card>
      </div>
      </fieldset>

      <Card>
        <CardHeader><CardTitle>3. Script approval</CardTitle><CardDescription>อนุมัติแผนเพื่อส่งต่อไปยัง Publishing หรือเปิดแก้ไขอีกครั้งเมื่อต้องการ</CardDescription></CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          {isApproved ? (
            <>
              <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-800">อนุมัติแล้ว</span>
              <Button type="button" variant="outline" onClick={editApprovedPlan}>แก้ไขแผนอีกครั้ง</Button>
            </>
          ) : (
            <>
              <Button type="submit" variant="outline" loading={isSaving} disabled={channels.length === 0}>บันทึก Draft</Button>
              <Button type="button" variant="outline" onClick={() => void loadLatestDraft()} loading={isLoadingDraft} disabled={isSaving || isGenerating}>โหลด Draft ล่าสุด</Button>
              <Button type="button" variant="success" onClick={approvePlan} loading={isSaving} disabled={channels.length === 0}>อนุมัติ Script plan</Button>
            </>
          )}
          {saved && !isApproved && saveLocation === "database" && <span className="text-sm font-medium text-emerald-700">บันทึก Draft ใน PostgreSQL แล้ว</span>}
          {saved && !isApproved && saveLocation === "local" && <span className="text-sm font-medium text-amber-700">บันทึก Draft ในเครื่องแล้ว — รอซิงก์ไป PostgreSQL</span>}
          {saved && !isApproved && saveLocation === "browser" && <span className="text-sm font-medium text-amber-700">บันทึกใน browser เท่านั้น — ไม่สามารถเชื่อมต่อ PostgreSQL ได้</span>}
          {saved && isApproved && saveLocation === "database" && <span className="text-sm font-medium text-emerald-700">บันทึก Campaign Brief และ Script Plan ใน PostgreSQL แล้ว</span>}
          {saved && isApproved && saveLocation === "local" && <span className="text-sm font-medium text-amber-700">อนุมัติและบันทึกในเครื่องแล้ว — รอซิงก์ไป PostgreSQL</span>}
          {saved && isApproved && saveLocation === "browser" && <span className="text-sm font-medium text-amber-700">อนุมัติแล้ว แต่ยังบันทึกได้เฉพาะใน browser</span>}
          {draftLoadMessage && <span role="status" className="text-sm font-medium text-blue-700">{draftLoadMessage}</span>}
          <span className="ml-auto text-xs text-slate-400">Draft ทั้งหมด: {store.drafts.length}</span>
        </div>
      </Card>
    </form>
  );
}
