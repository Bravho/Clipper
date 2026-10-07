"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import type { AdLabChannel } from "@/domain/models/AdLab";
import type { AdLabPublication, AdLabPublicationTarget } from "@/domain/models/AdLabPublication";
import {
  adLabChannelInsights,
  compareChannels,
  evaluateTarget,
  type AdLabChannelSummary,
} from "@/services/ad-lab/adLabInsights";
import {
  listAdLabPublications,
  refreshAdLabPublication,
  deleteAdLabPublication,
  updateAdLabTargetEconomics,
  createAdLabAdsDraft,
  syncAdLabAdsReport,
} from "./adLabPublishingClient";
import { CHANNEL_ACCENT, CHANNEL_LABELS } from "./socialAccountChannels";
import { defaultAdLabAdTargeting } from "@/domain/models/AdLabAdTargeting";
import { plannedVsActual } from "@/services/ad-lab/adLabCsvImport";

/**
 * Real results of posts published from the Ad Lab: per-post outcome and
 * metrics, the owner's spend/revenue, cost-effectiveness, and a channel
 * comparison. Server data (migration 039) — not the local workspace.
 */

const fmt = (value: number | null, digits = 0) =>
  value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const pct = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)}%`);
const baht = (value: number | null, digits = 2) => (value === null ? "—" : `฿${fmt(value, digits)}`);

const STATUS_LABEL: Record<AdLabPublication["status"], string> = {
  sending: "กำลังส่ง",
  processing: "แพลตฟอร์มกำลังประมวลผล",
  published: "เผยแพร่แล้ว",
  partially_failed: "สำเร็จบางบัญชี",
  failed: "ไม่สำเร็จ",
};

const TARGET_STATUS: Record<AdLabPublicationTarget["status"], { label: string; className: string }> = {
  pending: { label: "รอผล", className: "bg-slate-100 text-slate-700" },
  published: { label: "ขึ้นแล้ว", className: "bg-emerald-100 text-emerald-800" },
  failed: { label: "ไม่สำเร็จ", className: "bg-red-100 text-red-800" },
};

type CompareKey = "views" | "engagementRate" | "cpe" | "roas";
const COMPARE_OPTIONS: Array<{ key: CompareKey; label: string; format: (s: AdLabChannelSummary) => string }> = [
  { key: "views", label: "ยอดดู", format: (s) => fmt(s.views) },
  { key: "engagementRate", label: "Engagement rate", format: (s) => pct(s.engagementRate) },
  { key: "cpe", label: "ต้นทุนต่อ engagement", format: (s) => baht(s.cpe) },
  { key: "roas", label: "ROAS", format: (s) => (s.roas === null ? "—" : `${s.roas.toFixed(2)}x`) },
];

function EconomicsInput({
  label,
  value,
  onSave,
  integer = false,
}: {
  label: string;
  value: number;
  onSave: (value: number) => Promise<void>;
  integer?: boolean;
}) {
  const [draft, setDraft] = useState(value ? String(value) : "");
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value ? String(value) : ""), [value]);

  async function commit() {
    const next = Math.max(0, Number(draft) || 0);
    if ((integer ? Math.round(next) : next) === value) return;
    setSaving(true);
    try {
      await onSave(integer ? Math.round(next) : next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="block">
      <span className="text-[11px] uppercase text-slate-400">{label}</span>
      <input
        type="number"
        min="0"
        step={integer ? "1" : "any"}
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
        className={`mt-0.5 w-24 rounded-md border border-slate-300 px-2 py-1 text-sm ${saving ? "opacity-60" : ""}`}
      />
    </label>
  );
}

function ChannelComparison({ summaries }: { summaries: AdLabChannelSummary[] }) {
  const [key, setKey] = useState<CompareKey>("views");
  const option = COMPARE_OPTIONS.find((o) => o.key === key)!;
  const lowerIsBetter = key === "cpe";
  const values = summaries.map((s) => s[key]).filter((v): v is number => v !== null);
  const max = values.length ? Math.max(...values) : 0;
  const bestValue = values.length < 2 ? null : lowerIsBetter ? Math.min(...values) : Math.max(...values);

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="เปรียบเทียบด้วย">
        {COMPARE_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={o.key === key}
            onClick={() => setKey(o.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              o.key === key ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* One measure at a time, one hue: the bar length carries magnitude and
          the channel name (text) carries identity, so no legend is needed. */}
      <ul className="mt-4 space-y-3">
        {summaries.map((s) => {
          const value = s[key];
          const width = value !== null && max > 0 ? Math.max(2, (value / max) * 100) : 0;
          const isBest = bestValue !== null && value === bestValue;
          return (
            <li key={s.channel} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span className="font-medium text-slate-800">{CHANNEL_LABELS[s.channel]}</span>
              <span className="h-3 rounded-full bg-slate-100" title={`${CHANNEL_LABELS[s.channel]}: ${option.format(s)}`}>
                {width > 0 && (
                  <span className="block h-3 rounded-full bg-blue-600" style={{ width: `${width}%` }} />
                )}
              </span>
              <span className="min-w-[7.5rem] whitespace-nowrap text-right tabular-nums text-slate-700">
                {isBest && <span className="mr-1.5 text-xs font-semibold text-emerald-700">★ ดีที่สุด</span>}
                {option.format(s)}
              </span>
            </li>
          );
        })}
      </ul>
      {lowerIsBetter && <p className="mt-2 text-xs text-slate-500">ต้นทุน: ยิ่งต่ำยิ่งคุ้ม</p>}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm [&_td]:pr-3 [&_th]:pr-3">
          <caption className="sr-only">ตารางเปรียบเทียบช่องทาง</caption>
          <thead className="text-xs uppercase text-slate-400">
            <tr>
              <th className="pb-2">ช่องทาง</th><th className="pb-2">โพสต์</th><th className="pb-2">ยอดดู</th>
              <th className="pb-2">Engagement</th><th className="pb-2">ER</th><th className="pb-2">ค่าโฆษณา</th>
              <th className="pb-2">CPM</th><th className="pb-2">CPE</th><th className="pb-2">CPA</th><th className="pb-2">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => (
              <tr key={s.channel} className="border-t border-slate-100">
                <td className="py-2 font-medium">{CHANNEL_LABELS[s.channel]}</td>
                <td>{s.posts}</td>
                <td>{fmt(s.views)}</td>
                <td>{fmt(s.engagements)}</td>
                <td>{pct(s.engagementRate)}</td>
                <td>{baht(s.spend, 0)}</td>
                <td>{baht(s.cpm)}</td>
                <td>{baht(s.cpe)}</td>
                <td>{baht(s.cpa)}</td>
                <td>{s.roas === null ? "—" : `${s.roas.toFixed(2)}x`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PublishedResults({ brandId }: { brandId: string }) {
  const [publications, setPublications] = useState<AdLabPublication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Record<string, string[]>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPublications(await listAdLabPublications());
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดผลโพสต์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const replace = (next: AdLabPublication) =>
    setPublications((current) => current.map((p) => (p.id === next.id ? next : p)));

  async function refresh(id: string) {
    setBusyId(id);
    try {
      const result = await refreshAdLabPublication(id);
      replace(result.publication);
      setWarnings((current) => ({ ...current, [id]: result.warnings }));
    } catch (err) {
      setWarnings((current) => ({ ...current, [id]: [err instanceof Error ? err.message : "อัปเดตไม่สำเร็จ"] }));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      await deleteAdLabPublication(id);
      setPublications((current) => current.filter((p) => p.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setWarnings((current) => ({ ...current, [id]: [err instanceof Error ? err.message : "ลบไม่สำเร็จ"] }));
    } finally {
      setDeletingId(null);
    }
  }

  async function saveEconomics(targetId: string, values: { spend?: number; revenue?: number; conversions?: number }) {
    replace(await updateAdLabTargetEconomics(targetId, values));
  }

  const brandPublications = useMemo(
    () => publications.filter((p) => !brandId || p.brandId === brandId),
    [brandId, publications]
  );
  const allTargets = useMemo(() => brandPublications.flatMap((p) => p.targets), [brandPublications]);
  const summaries = useMemo(() => compareChannels(allTargets), [allTargets]);
  const insights = useMemo(() => adLabChannelInsights(summaries), [summaries]);
  const totals = useMemo(() => {
    const published = allTargets.filter((t) => t.status === "published");
    const e = evaluateTarget({
      metrics: null,
      spend: published.reduce((s, t) => s + t.spend, 0),
      revenue: published.reduce((s, t) => s + t.revenue, 0),
      conversions: published.reduce((s, t) => s + t.conversions, 0),
    });
    const views = summaries.reduce((s, c) => s + (c.views ?? 0), 0);
    const engagements = summaries.reduce((s, c) => s + (c.engagements ?? 0), 0);
    return {
      posts: published.length,
      views,
      engagementRate: views > 0 ? (engagements / views) * 100 : null,
      spend: e.spend,
      roas: e.roas,
    };
  }, [allTargets, summaries]);

  if (loading) return <Card><p className="text-sm text-slate-500">กำลังโหลดผลโพสต์จริง…</p></Card>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">ผลจากโพสต์จริง</h3>
          <p className="text-sm text-slate-500">โพสต์ที่เผยแพร่จากแท็บ Publishing พร้อมตัวเลขจากแพลตฟอร์มและความคุ้มค่า</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>โหลดรายการใหม่</Button>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {brandPublications.length === 0 ? (
        <Card className="border-dashed text-center">
          <p className="text-sm text-slate-500">ยังไม่มีโพสต์จริงของแบรนด์นี้ — ไปที่แท็บ Publishing แล้วกด “เผยแพร่ตอนนี้”</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["โพสต์ที่ขึ้นแล้ว", fmt(totals.posts)],
              ["ยอดดูรวม", fmt(totals.views)],
              ["Engagement rate", pct(totals.engagementRate)],
              ["ค่าโฆษณารวม", baht(totals.spend, 0)],
              ["ROAS รวม", totals.roas === null ? "—" : `${totals.roas.toFixed(2)}x`],
            ].map(([name, value]) => (
              <Card key={name} padding="sm">
                <p className="text-xs font-medium uppercase text-slate-400">{name}</p>
                <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>เปรียบเทียบช่องทาง</CardTitle>
                <CardDescription>รวมทุกโพสต์ของแบรนด์นี้ต่อช่องทาง แล้วคำนวณอัตราส่วนจากยอดรวม</CardDescription>
              </CardHeader>
              {summaries.length === 0 ? (
                <p className="text-sm text-slate-500">ยังไม่มีโพสต์ที่ขึ้นแพลตฟอร์มสำเร็จ</p>
              ) : (
                <ChannelComparison summaries={summaries} />
              )}
            </Card>
            <Card className="h-fit min-w-0">
              <CardHeader><CardTitle>ข้อสังเกต</CardTitle><CardDescription>จุดตั้งต้นสำหรับทดลองรอบถัดไป ไม่ใช่ข้อสรุปสุดท้าย</CardDescription></CardHeader>
              <ul className="space-y-2">
                {insights.map((item) => <li key={item} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{item}</li>)}
              </ul>
            </Card>
          </div>

          <div className="space-y-4">
            {brandPublications.map((publication) => (
              <Card key={publication.id} padding="none" className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{publication.campaignName}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {new Date(publication.createdAt).toLocaleString()} · {STATUS_LABEL[publication.status]}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {publication.status === "failed" && (
                      confirmDeleteId === publication.id ? (
                        <>
                          <span className="text-xs text-red-700">ลบรายการนี้ พร้อมวิดีโอที่อัปโหลดและข้อมูลผลทั้งหมด?</span>
                          <Button size="sm" variant="ghost" disabled={deletingId === publication.id} onClick={() => setConfirmDeleteId(null)}>
                            ยกเลิก
                          </Button>
                          <Button size="sm" variant="danger" loading={deletingId === publication.id} onClick={() => void remove(publication.id)}>
                            ยืนยันลบ
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" className="text-red-700" onClick={() => setConfirmDeleteId(publication.id)}>
                          ลบรายการ
                        </Button>
                      )
                    )}
                    {confirmDeleteId !== publication.id && (
                      <Button size="sm" variant="secondary" loading={busyId === publication.id} onClick={() => void refresh(publication.id)}>
                        อัปเดตผลล่าสุด
                      </Button>
                    )}
                  </div>
                </div>
                {publication.error && <p className="px-5 pt-3 text-sm text-red-700">{publication.error}</p>}
                {(warnings[publication.id] ?? []).length > 0 && (
                  <ul className="mx-5 mt-3 space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                    {warnings[publication.id].map((w) => <li key={w}>{w}</li>)}
                  </ul>
                )}
                <div className="overflow-x-auto px-5 py-4">
                  <table className="w-full min-w-[60rem] text-left text-sm [&_td]:pr-3 [&_th]:pr-3">
                    <thead className="text-xs uppercase text-slate-400">
                      <tr>
                        <th className="pb-2">บัญชี</th><th className="pb-2">สถานะ</th><th className="pb-2">ยอดดู</th>
                        <th className="pb-2">Engagement</th><th className="pb-2">ER</th><th className="pb-2">คลิก</th>
                        <th className="pb-2">ค่าโฆษณา / ยอดขาย / ลูกค้า</th><th className="pb-2">CPV</th><th className="pb-2">CPE</th><th className="pb-2">ROAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {publication.targets.map((target) => {
                        const e = evaluateTarget(target);
                        const status = TARGET_STATUS[target.status];
                        return (
                          <tr key={target.id} className="border-t border-slate-100 align-top">
                            <td className="py-3 pr-3">
                              <span className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHANNEL_ACCENT[target.channel as AdLabChannel]}`}>
                                {CHANNEL_LABELS[target.channel as AdLabChannel]}
                              </span>
                              <span className="font-medium text-slate-800">{target.accountLabel}</span>
                              {target.platformUrl && (
                                <a href={target.platformUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-blue-700 underline">
                                  ดูโพสต์
                                </a>
                              )}
                              {target.metricsFetchedAt && (
                                <p className="mt-1 text-[11px] text-slate-400">ตัวเลขเมื่อ {new Date(target.metricsFetchedAt).toLocaleString()}</p>
                              )}
                              {target.error && <p className="mt-1 text-xs text-red-700">{target.error}</p>}
                            </td>
                            <td className="py-3"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${status.className}`}>{status.label}</span></td>
                            <td className="py-3 tabular-nums">{fmt(e.views)}</td>
                            <td className="py-3 tabular-nums">{fmt(e.engagements)}</td>
                            <td className="py-3 tabular-nums">{pct(e.engagementRate)}</td>
                            <td className="py-3 tabular-nums">{fmt(e.clicks)}</td>
                            <td className="py-3">
                              <div className="flex gap-2">
                                <EconomicsInput label="ค่าโฆษณา ฿" value={target.spend} onSave={(v) => saveEconomics(target.id, { spend: v })} />
                                <EconomicsInput label="ยอดขาย ฿" value={target.revenue} onSave={(v) => saveEconomics(target.id, { revenue: v })} />
                                <EconomicsInput label="ลูกค้า" integer value={target.conversions} onSave={(v) => saveEconomics(target.id, { conversions: v })} />
                              </div>
                              {target.plannedBudget > 0 && (() => {
                                const pva = plannedVsActual(target.plannedBudget, target.spend);
                                return (
                                  <p className="mt-1 text-[11px] text-slate-400">
                                    plan {baht(pva.planned, 0)}
                                    {pva.pctOfPlan !== null ? ` / actual ${pva.pctOfPlan.toFixed(0)}% of plan` : ""}
                                    {pva.delta > 0 ? ` / over ${baht(pva.delta, 0)}` : ""}
                                  </p>
                                );
                              })()}
                              {target.channel === "tiktok" && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {!target.ads?.adId ? (
                                    <button
                                      type="button"
                                      className="rounded-full border border-violet-300 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-800"
                                      onClick={() => void (async () => {
                                        try {
                                          const targeting = defaultAdLabAdTargeting({
                                            sparkMode: true,
                                            sparkPostId: target.platformPostId || "",
                                            utmCampaign: "chinese_ttt",
                                          });
                                          const result = await createAdLabAdsDraft({
                                            targetId: target.id,
                                            targeting,
                                            dailyBudgetBaht: target.plannedBudget > 0 ? target.plannedBudget / 7 : 0,
                                            campaignName: publication.campaignName,
                                          });
                                          replace(result.publication);
                                        } catch (err) {
                                          setWarnings((current) => ({
                                            ...current,
                                            [publication.id]: [err instanceof Error ? err.message : "Ads draft failed"],
                                          }));
                                        }
                                      })()}
                                    >
                                      Create Ads draft (paused)
                                    </button>
                                  ) : (
                                    <>
                                      <span className="text-[11px] text-slate-500">
                                        ad {target.ads.adId}{target.ads.stub ? " · stub" : ""} · {target.ads.status}
                                      </span>
                                      <button
                                        type="button"
                                        className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700"
                                        onClick={() => void (async () => {
                                          try {
                                            replace(await syncAdLabAdsReport(target.id));
                                          } catch (err) {
                                            setWarnings((current) => ({
                                              ...current,
                                              [publication.id]: [err instanceof Error ? err.message : "Ads sync failed"],
                                            }));
                                          }
                                        })()}
                                      >
                                        Sync Ads report
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-3 tabular-nums">{baht(e.cpv)}</td>
                            <td className="py-3 tabular-nums">{baht(e.cpe)}</td>
                            <td className="py-3 tabular-nums">{e.roas === null ? "—" : `${e.roas.toFixed(2)}x`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
