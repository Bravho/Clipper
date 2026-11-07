"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import type { NormalizedAdMetricRow } from "@/services/ad-lab/ads-reporting/adsReportingModel";
import type {
  EfficiencyRanking,
  FatigueSignal,
  PlatformComparison,
  BudgetSuggestion,
  ResultTypeSummary,
} from "@/services/ad-lab/ads-reporting/analysis";

// ─── Types from API ───────────────────────────────────────────────────────────

interface PlatformStatus {
  platform: "tiktok" | "meta";
  configured: boolean;
  connected: boolean;
  accountIds: string[];
  accountNames?: string[];
  lastSyncAt?: string;
  lastSyncError?: string;
  tokenSource?: string;
  systemUserLabel?: string;
  oauthError?: string;
}

interface StatusResponse {
  platforms: PlatformStatus[];
  envNames: { tiktok: string[]; meta: string[] };
}

interface MetricsResponse {
  rows: NormalizedAdMetricRow[];
  analysis: {
    ranking: EfficiencyRanking[];
    fatigue: FatigueSignal[];
    platformComparison: PlatformComparison[];
    suggestions: BudgetSuggestion[];
    resultSummary?: ResultTypeSummary[];
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLATFORM_LABEL: Record<string, string> = { tiktok: "TikTok", meta: "Meta (Facebook/Instagram)" };

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}

function fmtN(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "-";
  return n.toLocaleString("th-TH", { maximumFractionDigits: decimals });
}

function pct(n: number | null | undefined): string {
  if (n == null) return "-";
  return `${n.toFixed(2)}%`;
}

const DAYS_OPTIONS = [
  { value: "7", label: "7 วัน" },
  { value: "14", label: "14 วัน" },
  { value: "28", label: "28 วัน" },
  { value: "90", label: "90 วัน" },
];

const LEVEL_OPTIONS = [
  { value: "campaign", label: "แคมเปญ" },
  { value: "adset", label: "Ad Set" },
  { value: "ad", label: "Ad (ครีเอทีฟ)" },
];

const PLATFORM_OPTIONS = [
  { value: "", label: "ทุก Platform" },
  { value: "tiktok", label: "TikTok" },
  { value: "meta", label: "Meta" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <Card padding="sm">
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-950">{value}</p>
    </Card>
  );
}

function ConnectionCard({
  status,
  envNames,
  onConnect,
  onDisconnect,
  connecting,
  disconnecting,
  connectError,
}: {
  status: PlatformStatus;
  envNames: string[];
  onConnect: () => void;
  onDisconnect: () => void;
  connecting: boolean;
  disconnecting: boolean;
  connectError?: string | null;
}) {
  const label = PLATFORM_LABEL[status.platform] ?? status.platform;
  const viaSystemUser = status.connected && status.tokenSource === "env_system_user";
  const oauthBlocked = Boolean(status.oauthError);
  const hasMissingEnv = !status.configured && envNames.length > 0;

  return (
    <Card padding="sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{label}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            สถานะ:{" "}
            <span className={status.connected ? "text-emerald-600" : "text-slate-400"}>
              {status.connected ? "เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ"}
            </span>
          </p>
          {status.connected && (
            <>
              <p className="mt-0.5 text-xs text-slate-500">
                บัญชี: {status.accountNames?.join(", ") || status.accountIds.join(", ") || "—"}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">ซิงค์ล่าสุด: {fmtDate(status.lastSyncAt)}</p>
              {status.lastSyncError && (
                <p className="mt-1 text-xs text-red-600">⚠ {status.lastSyncError}</p>
              )}
            </>
          )}
          {viaSystemUser && (
            <p className="mt-1 text-xs text-emerald-700">
              เชื่อมต่อผ่าน System User ({status.systemUserLabel ?? "Ads_Labs"}) จาก .env.local แล้ว ไม่ต้องกดเชื่อมต่อ OAuth
              <span className="block text-slate-500">บัญชีโฆษณา: {status.accountIds.join(", ") || "-"}</span>
            </p>
          )}
          {!status.connected && status.oauthError && (
            <p className="mt-1 text-xs text-red-600">{status.oauthError}</p>
          )}
          {connectError && <p className="mt-1 text-xs text-red-600">{connectError}</p>}
          {hasMissingEnv && (
            <p className="mt-1 text-xs text-amber-700">
              ต้องตั้งค่า env: {envNames.join(", ")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {viaSystemUser ? null : status.connected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? "กำลังยกเลิก…" : "ยกเลิกการเชื่อมต่อ"}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onConnect}
              disabled={connecting || !status.configured || oauthBlocked}
              title={status.oauthError}
            >
              {connecting ? "กำลังเชื่อมต่อ…" : "เชื่อมต่อ"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function RankingTable({ rankings }: { rankings: EfficiencyRanking[] }) {
  if (!rankings.length) {
    return <p className="text-sm text-slate-500">ไม่มีข้อมูลในช่วงนี้</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-400">
          <tr>
            <th className="pb-2">#</th>
            <th className="pb-2">ชื่อ</th>
            <th className="pb-2">Platform</th>
            <th className="pb-2 text-right">Spend</th>
            <th className="pb-2 text-right">สัดส่วน</th>
            <th className="pb-2 text-right" title="จำนวนครั้งที่วิดีโอเริ่มเล่น (Meta: video plays, TikTok: video_play_actions) และต้นทุนต่อวิว (Spend / Views)">Views</th>
            <th className="pb-2 text-right">ผลลัพธ์ (Results)</th>
            <th className="pb-2 text-right">Cost/Result</th>
            <th className="pb-2 text-right">CPC</th>
            <th className="pb-2 text-right">CPM</th>
          </tr>
        </thead>
        <tbody>
          {rankings.map((r, idx) => (
            <tr key={r.entityId} className="border-t border-slate-100">
              <td className="py-2 text-slate-400">{idx + 1}</td>
              <td className="py-2 font-medium">
                {r.entityName ?? r.entityId}
                {r.lowData && (
                  <span className="ml-1 text-[10px] text-slate-400">(ข้อมูลน้อย)</span>
                )}
              </td>
              <td className="py-2 text-slate-500">{PLATFORM_LABEL[r.platform]}</td>
              <td className="py-2 text-right">{fmtN(r.totalSpend)}</td>
              <td className="py-2 text-right">{pct(r.spendShare * 100)}</td>
              <td className="py-2 text-right">
                {r.totalVideoPlays == null ? (
                  <span className="cursor-help text-slate-400" title="ไม่มีข้อมูลการเล่นวิดีโอ (อาจไม่ใช่โฆษณาวิดีโอ หรือข้อมูลซิงก์ก่อนเพิ่มคอลัมน์นี้ ให้กดรีเฟรชข้อมูล)">-</span>
                ) : (
                  <>
                    {fmtN(r.totalVideoPlays, 0)}
                    {r.costPerView != null && (
                      <span className="block text-[10px] text-slate-400" title="ต้นทุนต่อวิว (Spend / Views)">{fmtN(r.costPerView, 3)} / view</span>
                    )}
                  </>
                )}
              </td>
              <td className="py-2 text-right">
                {r.resultType === "mixed" ? "หลายประเภท" : fmtN(r.totalConversions, 0)}
                {r.resultLabelTh && r.resultType !== "mixed" && (
                  <span className="block text-[10px] text-slate-400" title={r.resultLabelEn}>{r.resultLabelTh}</span>
                )}
              </td>
              <td className="py-2 text-right">{fmtN(r.costPerResult)}</td>
              <td className="py-2 text-right">{fmtN(r.cpc)}</td>
              <td className="py-2 text-right">{fmtN(r.cpm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function AdsReportingPanel() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [days, setDays] = useState("28");
  const [platform, setPlatform] = useState("");
  const [level, setLevel] = useState<NormalizedAdMetricRow["level"]>("campaign");
  const [syncing, setSyncing] = useState(false);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [connectErrors, setConnectErrors] = useState<Record<string, string>>({});

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/ad-lab/ads-reporting/status");
      if (res.ok) setStatus(await res.json() as StatusResponse);
    } catch {
      // ignore
    }
  }, []);

  const fetchMetrics = useCallback(async () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - Number(days));
    const params = new URLSearchParams({
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      level,
      ...(platform ? { platform } : {}),
    });
    try {
      const res = await fetch(`/api/ad-lab/ads-reporting/metrics?${params.toString()}`);
      if (res.ok) setMetrics(await res.json() as MetricsResponse);
    } catch {
      // ignore
    }
  }, [days, platform, level]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  // Handle OAuth redirect success/error params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ads = params.get("ads");
    const err = params.get("ads_error");
    if (ads || err) {
      void fetchStatus();
      void fetchMetrics();
      // Clean up URL params without navigation
      const clean = new URL(window.location.href);
      clean.searchParams.delete("ads");
      clean.searchParams.delete("ads_error");
      clean.searchParams.delete("detail");
      window.history.replaceState({}, "", clean.toString());
      if (ads) setSyncMessage(`เชื่อมต่อสำเร็จ`);
      if (err) setSyncMessage(`เชื่อมต่อไม่สำเร็จ: ${params.get("detail") ?? err}`);
    }
  }, [fetchStatus, fetchMetrics]);

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const body: { days: number; platform?: string } = { days: Number(days) };
      if (platform) body.platform = platform;
      const res = await fetch("/api/ad-lab/ads-reporting/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (res.ok) {
        setSyncMessage("รีเฟรชข้อมูลสำเร็จ");
        await fetchStatus();
        await fetchMetrics();
      } else {
        setSyncMessage(`เกิดข้อผิดพลาด: ${json.error ?? "unknown"}`);
      }
    } catch {
      setSyncMessage("รีเฟรชไม่สำเร็จ");
    } finally {
      setSyncing(false);
    }
  }

  async function handleConnect(p: "tiktok" | "meta") {
    setConnectingPlatform(p);
    setConnectErrors((c) => ({ ...c, [p]: "" }));
    try {
      // Preflight: the route answers with a Thai error (no redirect) when the app id/secret is missing.
      const res = await fetch(`/api/ad-lab/ads-reporting/${p}/connect?check=1`);
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setConnectErrors((c) => ({ ...c, [p]: json.error ?? "เชื่อมต่อไม่สำเร็จ" }));
        setConnectingPlatform(null);
        return;
      }
    } catch {
      setConnectErrors((c) => ({ ...c, [p]: "เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง" }));
      setConnectingPlatform(null);
      return;
    }
    window.location.href = `/api/ad-lab/ads-reporting/${p}/connect`;
  }

  async function handleDisconnect(p: "tiktok" | "meta") {
    setDisconnectingPlatform(p);
    try {
      await fetch("/api/ad-lab/ads-reporting/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: p }),
      });
      await fetchStatus();
      await fetchMetrics();
    } finally {
      setDisconnectingPlatform(null);
    }
  }

  const allRows = useMemo(() => metrics?.rows ?? [], [metrics]);
  // Totals use the selected level only (campaign + ad set + ad rows would triple-count).
  const rows = useMemo(() => allRows.filter((r) => r.level === level), [allRows, level]);
  const resultSummary = metrics?.analysis?.resultSummary ?? [];
  const singleResult = resultSummary.length === 1 ? resultSummary[0] : null;
  const analysis = metrics?.analysis;
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);
  const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null;
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : null;
  const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : null;
  const avgFreq = useMemo(() => {
    const withFreq = rows.filter((r) => r.frequency != null);
    if (!withFreq.length) return null;
    return withFreq.reduce((s, r) => s + (r.frequency ?? 0), 0) / withFreq.length;
  }, [rows]);
  const totalVideoViews2s = rows.some((r) => r.videoViews2s != null)
    ? rows.reduce((s, r) => s + (r.videoViews2s ?? 0), 0)
    : null;
  const totalVideoViews100 = rows.some((r) => r.videoViews100 != null)
    ? rows.reduce((s, r) => s + (r.videoViews100 ?? 0), 0)
    : null;
  const avgRoas = useMemo(() => {
    const withRoas = rows.filter((r) => r.roas != null);
    if (!withRoas.length) return null;
    return withRoas.reduce((s, r) => s + (r.roas ?? 0), 0) / withRoas.length;
  }, [rows]);

  const anyConnected = status?.platforms.some((p) => p.connected) ?? false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">ข้อมูลโฆษณาจาก API</h3>
          <p className="text-sm text-slate-500">เชื่อมต่อ TikTok Ads / Meta Ads เพื่อดึงข้อมูลแบบ Read-only</p>
        </div>
        {anyConnected && (
          <Button onClick={() => void handleSync()} disabled={syncing} size="sm">
            {syncing ? "กำลังรีเฟรช…" : "รีเฟรชข้อมูล"}
          </Button>
        )}
      </div>

      {syncMessage && (
        <p className={`text-sm ${syncMessage.includes("ไม่สำเร็จ") || syncMessage.includes("ข้อผิดพลาด") ? "text-red-600" : "text-emerald-600"}`}>
          {syncMessage}
        </p>
      )}

      {/* Connection cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {(status?.platforms ?? [{ platform: "tiktok" as const, configured: false, connected: false, accountIds: [] }, { platform: "meta" as const, configured: false, connected: false, accountIds: [] }]).map((ps) => (
          <ConnectionCard
            key={ps.platform}
            status={ps}
            envNames={status?.envNames[ps.platform] ?? []}
            onConnect={() => void handleConnect(ps.platform)}
            onDisconnect={() => void handleDisconnect(ps.platform)}
            connecting={connectingPlatform === ps.platform}
            disconnecting={disconnectingPlatform === ps.platform}
            connectError={connectErrors[ps.platform] || null}
          />
        ))}
      </div>

      {!anyConnected ? (
        <Card>
          <p className="text-sm text-slate-500">เชื่อมต่อบัญชีโฆษณาเพื่อดู KPI และการวิเคราะห์</p>
        </Card>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <Select
              label="ช่วงเวลา"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              options={DAYS_OPTIONS}
            />
            <Select
              label="Platform"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              options={PLATFORM_OPTIONS}
            />
            <Select
              label="ระดับ"
              value={level}
              onChange={(e) => setLevel(e.target.value as NormalizedAdMetricRow["level"])}
              options={LEVEL_OPTIONS}
            />
          </div>

          {/* KPI tiles */}
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
            <KpiTile label="Spend" value={fmtN(totalSpend)} />
            <KpiTile label="Impressions" value={fmtN(totalImpressions, 0)} />
            <KpiTile label="Clicks" value={fmtN(totalClicks, 0)} />
            <KpiTile label="CTR" value={pct(avgCtr)} />
            <KpiTile label="CPC" value={fmtN(avgCpc)} />
            <KpiTile label="CPM" value={fmtN(avgCpm)} />
            <KpiTile
              label={singleResult ? `ผลลัพธ์: ${singleResult.labelTh}` : "ผลลัพธ์ (Results)"}
              value={singleResult ? fmtN(singleResult.results, 0) : resultSummary.length > 1 ? "หลายประเภท" : "-"}
            />
            <KpiTile label="Cost / Result" value={singleResult ? fmtN(singleResult.costPerResult) : resultSummary.length > 1 ? "ดูตามประเภท" : "-"} />
            <KpiTile label="Frequency" value={fmtN(avgFreq)} />
            <KpiTile label="Video 2s" value={fmtN(totalVideoViews2s, 0)} />
            <KpiTile label="Video 100%" value={fmtN(totalVideoViews100, 0)} />
            <KpiTile label="ROAS" value={fmtN(avgRoas)} />
          </div>

          {resultSummary.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>ผลลัพธ์แยกตามประเภท (Results by type)</CardTitle>
                <CardDescription>แต่ละแคมเปญนับผลลัพธ์ตามเป้าหมายการเพิ่มประสิทธิภาพของตัวเอง จึงไม่รวมผลลัพธ์ต่างประเภทเข้าด้วยกัน</CardDescription>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-400">
                    <tr>
                      <th className="pb-2">ประเภทผลลัพธ์</th>
                      <th className="pb-2">Platform</th>
                      <th className="pb-2 text-right">ผลลัพธ์</th>
                      <th className="pb-2 text-right">Spend</th>
                      <th className="pb-2 text-right">Cost/Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultSummary.map((t) => (
                      <tr key={`${t.platform}-${t.resultType}`} className="border-t border-slate-100">
                        <td className="py-2 font-medium">{t.labelTh} <span className="text-xs text-slate-400">({t.labelEn})</span></td>
                        <td className="py-2 text-slate-500">{PLATFORM_LABEL[t.platform]}</td>
                        <td className="py-2 text-right">{fmtN(t.results, 0)}</td>
                        <td className="py-2 text-right">{fmtN(t.spend)}</td>
                        <td className="py-2 text-right">{fmtN(t.costPerResult)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Ranking table */}
          <Card>
            <CardHeader>
              <CardTitle>จัดอันดับความคุ้มค่า</CardTitle>
              <CardDescription>เรียงตาม Cost per Result (น้อยไปมาก)</CardDescription>
            </CardHeader>
            <RankingTable rankings={analysis?.ranking ?? []} />
          </Card>

          {/* Fatigue alerts */}
          {(analysis?.fatigue ?? []).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>สัญญาณครีเอทีฟล้า</CardTitle>
                <CardDescription>CTR ลดลง ≥20% พร้อมกับความถี่เพิ่มขึ้น ≥20%</CardDescription>
              </CardHeader>
              <ul className="space-y-2">
                {(analysis?.fatigue ?? []).map((f) => (
                  <li key={f.entityId} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                    <strong>{f.entityName ?? f.entityId}</strong> ({PLATFORM_LABEL[f.platform]}){" "}
                    — CTR: {pct(f.ctrBefore)} → {pct(f.ctrAfter)} (ลด {pct(f.ctrDropPct * 100)}){" "}
                    {f.freqRisePct != null && `| Frequency เพิ่ม ${pct(f.freqRisePct * 100)}`}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Platform comparison */}
          {(analysis?.platformComparison ?? []).length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>เปรียบเทียบ TikTok กับ Meta</CardTitle>
                {analysis?.platformComparison.some((p) => p.currencyMixed) && (
                  <CardDescription className="text-amber-600">
                    ⚠ สกุลเงินต่างกันในบัญชี — เปรียบเทียบได้เบื้องต้นเท่านั้น
                  </CardDescription>
                )}
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-400">
                    <tr>
                      <th className="pb-2">Platform</th>
                      <th className="pb-2 text-right">Spend</th>
                      <th className="pb-2 text-right">CTR</th>
                      <th className="pb-2 text-right">CPC</th>
                      <th className="pb-2 text-right">CPM</th>
                      <th className="pb-2 text-right">Conversions</th>
                      <th className="pb-2 text-right">CPR</th>
                      <th className="pb-2 text-right">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(analysis?.platformComparison ?? []).map((pc) => (
                      <tr key={pc.platform} className="border-t border-slate-100">
                        <td className="py-2 font-medium">{PLATFORM_LABEL[pc.platform]}</td>
                        <td className="py-2 text-right">{fmtN(pc.totalSpend)}</td>
                        <td className="py-2 text-right">{pct(pc.avgCtr)}</td>
                        <td className="py-2 text-right">{fmtN(pc.avgCpc)}</td>
                        <td className="py-2 text-right">{fmtN(pc.avgCpm)}</td>
                        <td className="py-2 text-right">{pc.resultsMixed ? "หลายประเภท" : fmtN(pc.totalConversions, 0)}</td>
                        <td className="py-2 text-right">{pc.resultsMixed ? "-" : fmtN(pc.avgCostPerResult)}</td>
                        <td className="py-2 text-right">{fmtN(pc.avgRoas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Budget suggestions */}
          {(analysis?.suggestions ?? []).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>ข้อเสนอแนะงบประมาณ</CardTitle>
                <CardDescription className="text-amber-700 font-medium">
                  แนะนำเท่านั้น — ระบบไม่เปลี่ยนงบหรือแคมเปญให้อัตโนมัติ
                </CardDescription>
              </CardHeader>
              <ul className="space-y-2">
                {(analysis?.suggestions ?? []).map((s, idx) => (
                  <li key={idx} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="font-medium text-slate-900">{s.suggestion}</p>
                    <p className="mt-1 text-slate-500">{s.reason}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{s.evidence}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
