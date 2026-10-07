"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type { AdLabPublication } from "@/domain/models/AdLabPublication";
import { plannedVsActual } from "@/services/ad-lab/adLabCsvImport";

export function AdsImportPanel({
  brandId,
  publications,
  onImported,
}: {
  brandId: string;
  publications: AdLabPublication[];
  onImported: (publication: AdLabPublication | null) => void;
}) {
  const tiktokTargets = useMemo(
    () =>
      publications
        .filter((p) => !brandId || p.brandId === brandId)
        .flatMap((p) =>
          p.targets
            .filter((t) => t.channel === "tiktok")
            .map((t) => ({
              id: t.id,
              label: `${p.campaignName} · ${t.accountLabel}${t.ads?.adId ? ` · ad ${t.ads.adId}` : ""}`,
              plannedBudget: t.plannedBudget,
              spend: t.spend,
            }))
        ),
    [brandId, publications]
  );

  const [targetId, setTargetId] = useState("");
  const [csv, setCsv] = useState(
    "campaign,ad_id,spend,impressions,clicks,conversions,revenue\nChinese_TTT,demo_ad,1200,50000,800,12,3600\n"
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = tiktokTargets.find((t) => t.id === targetId);
  const pva = selected ? plannedVsActual(selected.plannedBudget, selected.spend) : null;

  async function submit() {
    if (!brandId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/ad-lab/ads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, targetId: targetId || null, csvText: csv }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
      setMessage(`นำเข้า ${data.rows?.length ?? 0} แถว${data.appliedToTarget ? " และอัปเดต target แล้ว" : ""}`);
      onImported(data.publication ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>นำเข้าจาก TikTok Ads Manager (CSV / วางตาราง)</CardTitle>
        <CardDescription>
          สำรองเมื่อยังไม่มี Marketing API token — วางแถวจาก Ads Manager แล้วผูกกับโพสต์ TikTok ได้
        </CardDescription>
      </CardHeader>
      <div className="space-y-3">
        <Select
          label="ผูกกับ target (ไม่บังคับ)"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          options={[
            { value: "", label: "— บันทึกเป็น import อย่างเดียว —" },
            ...tiktokTargets.map((t) => ({ value: t.id, label: t.label })),
          ]}
        />
        {pva && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Planned vs actual: งบวางแผน ฿{pva.planned.toLocaleString()} · ใช้จริง ฿{pva.actual.toLocaleString()}
            {pva.pctOfPlan !== null ? ` (${pva.pctOfPlan.toFixed(0)}% ของแผน)` : ""}
          </p>
        )}
        <Textarea label="CSV" value={csv} onChange={(e) => setCsv(e.target.value)} rows={6} />
        <Button loading={busy} onClick={() => void submit()}>นำเข้า</Button>
        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
    </Card>
  );
}
