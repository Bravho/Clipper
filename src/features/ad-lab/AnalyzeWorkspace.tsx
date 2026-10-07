"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { AD_LAB_CHANNELS, type AdLabAdResult, type AdLabChannel } from "@/domain/models/AdLab";
import { useAdLabStore } from "./useAdLabStore";
import { calculateAdLabMetrics, diagnoseAdLabMetrics } from "@/services/ad-lab/AdLabPrototypeService";
import { PublishedResults } from "./PublishedResults";
import { ChineseTttOutcomesPanel } from "./ChineseTttOutcomesPanel";
import { AdsImportPanel } from "./AdsImportPanel";
import { listAdLabPublications } from "./adLabPublishingClient";
import type { AdLabPublication } from "@/domain/models/AdLabPublication";

const labels: Record<AdLabChannel, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube" };
const n = (value: string) => Math.max(0, Number(value) || 0);

export function AnalyzeWorkspace() {
  const { store, ready, update } = useAdLabStore();
  const brandId = store.selectedBrandId || store.brands[0]?.id || "";
  const [campaignName, setCampaignName] = useState("");
  const [channel, setChannel] = useState<AdLabChannel>("tiktok");
  const [values, setValues] = useState({ spend: "", revenue: "", impressions: "", views3s: "", completedViews: "", clicks: "", conversions: "" });

  const brandResults = useMemo(() => store.results.filter((item) => !brandId || item.brandId === brandId), [brandId, store.results]);
  const [publications, setPublications] = useState<AdLabPublication[]>([]);
  useEffect(() => {
    void listAdLabPublications().then(setPublications).catch(() => setPublications([]));
  }, [brandId]);
  const metrics = useMemo(() => calculateAdLabMetrics(brandResults), [brandResults]);

  function save(event: FormEvent) {
    event.preventDefault();
    if (!brandId || !campaignName.trim()) return;
    const result: AdLabAdResult = { id: crypto.randomUUID(), brandId, campaignName: campaignName.trim(), channel, spend: n(values.spend), revenue: n(values.revenue), impressions: n(values.impressions), views3s: n(values.views3s), completedViews: n(values.completedViews), clicks: n(values.clicks), conversions: n(values.conversions), createdAt: new Date().toISOString() };
    update((current) => ({ ...current, results: [result, ...current.results] }));
    setCampaignName("");
    setValues({ spend: "", revenue: "", impressions: "", views3s: "", completedViews: "", clicks: "", conversions: "" });
  }

  const findings = brandResults.length === 0 ? [] : diagnoseAdLabMetrics(metrics);

  if (!ready) return <Card><p className="text-sm text-slate-500">กำลังโหลดข้อมูล…</p></Card>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-950">Ad Analysis</h2>
        <p className="mt-1 text-sm text-slate-500">รวมผลจากหลายช่องทางให้อยู่ใน funnel เดียว และแปลงตัวเลขเป็นสิ่งที่ควรแก้ในคลิปถัดไป</p>
      </div>

      <PublishedResults brandId={brandId} />

      {brandId ? <ChineseTttOutcomesPanel brandId={brandId} /> : null}

      {brandId ? (
        <AdsImportPanel
          brandId={brandId}
          publications={publications}
          onImported={(publication) => {
            if (!publication) return;
            setPublications((current) => {
              const exists = current.some((p) => p.id === publication.id);
              return exists
                ? current.map((p) => (p.id === publication.id ? publication : p))
                : [publication, ...current];
            });
          }}
        />
      ) : null}

      <div className="border-t border-slate-200 pt-6">
        <h3 className="text-lg font-semibold text-slate-950">ผลที่กรอกเอง</h3>
        <p className="text-sm text-slate-500">สำหรับแคมเปญที่ไม่ได้โพสต์ผ่าน Ad Lab หรือข้อมูลจาก Ads Manager (impressions, 3s views, conversions)</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[ ["Hook rate", `${metrics.hookRate.toFixed(1)}%`], ["Completion", `${metrics.completionRate.toFixed(1)}%`], ["CTR", `${metrics.ctr.toFixed(2)}%`], ["CVR", `${metrics.cvr.toFixed(1)}%`], ["ROAS", `${metrics.roas.toFixed(2)}x`] ].map(([name, value]) => (
          <Card key={name} padding="sm"><p className="text-xs font-medium uppercase text-slate-400">{name}</p><p className="mt-1 text-2xl font-bold text-slate-950">{value}</p></Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>สิ่งที่ควรปรับปรุง</CardTitle><CardDescription>กฎวิเคราะห์ชุดแรกสำหรับใช้ตั้งสมมติฐาน—not a final verdict</CardDescription></CardHeader>
            {findings.length ? <ul className="space-y-3">{findings.map((item) => <li key={item} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{item}</li>)}</ul> : <p className="text-sm text-slate-500">เพิ่มผลแคมเปญอย่างน้อยหนึ่งรายการเพื่อเริ่มวิเคราะห์</p>}
          </Card>
          <Card>
            <CardHeader><CardTitle>Campaign history</CardTitle><CardDescription>ข้อมูลจริงที่กรอกหรือ import เข้ามาใน Lab</CardDescription></CardHeader>
            {brandResults.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีข้อมูล</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="pb-2">Campaign</th><th className="pb-2">Channel</th><th className="pb-2">Spend</th><th className="pb-2">Revenue</th><th className="pb-2">ROAS</th></tr></thead><tbody>{brandResults.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="py-3 font-medium">{item.campaignName}</td><td>{labels[item.channel]}</td><td>{item.spend.toLocaleString()}</td><td>{item.revenue.toLocaleString()}</td><td>{item.spend ? (item.revenue / item.spend).toFixed(2) : "—"}</td></tr>)}</tbody></table></div>}
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader><CardTitle>เพิ่มผลแคมเปญ</CardTitle><CardDescription>Manual entry สำหรับทดสอบ model ก่อนเชื่อม API จริง</CardDescription></CardHeader>
          {!brandId ? <p className="text-sm text-amber-700">เพิ่ม Brand ก่อนบันทึกผล</p> : <form onSubmit={save} className="space-y-3">
            <Input label="ชื่อแคมเปญ *" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} required />
            <Select label="ช่องทาง" value={channel} onChange={(e) => setChannel(e.target.value as AdLabChannel)} options={AD_LAB_CHANNELS.map((item) => ({ value: item, label: labels[item] }))} />
            <div className="grid grid-cols-2 gap-3">
              {Object.entries({ impressions: "Impressions", views3s: "3s views", completedViews: "Completed", clicks: "Clicks", conversions: "Conversions", spend: "Spend", revenue: "Revenue" }).map(([key, label]) => <Input key={key} label={label} type="number" min="0" step="any" value={values[key as keyof typeof values]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />)}
            </div>
            <Button type="submit" fullWidth>บันทึกและวิเคราะห์</Button>
          </form>}
          <div className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500">TikTok Ads Manager + LINE OA + Stripe outcomes ใช้ได้ด้านบน (stub ได้ถ้ายังไม่มี secret)</div>
        </Card>
      </div>
    </div>
  );
}
