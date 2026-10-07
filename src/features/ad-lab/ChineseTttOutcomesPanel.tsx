"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

interface LineOutcome {
  stub: boolean;
  message: string;
  latest: { capturedAt: string; friendCount: number } | null;
  previous: { capturedAt: string; friendCount: number } | null;
  delta: number | null;
  series: Array<{ capturedAt: string; friendCount: number }>;
}

interface StripeOutcome {
  stub: boolean;
  message: string;
  amountBaht: number;
  chargeCount: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  productFilter: string;
}

/**
 * Chinese_TTT Analyze section: LINE OA friends + Stripe received payments (read-only).
 */
export function ChineseTttOutcomesPanel({ brandId }: { brandId: string }) {
  const [line, setLine] = useState<LineOutcome | null>(null);
  const [stripe, setStripe] = useState<StripeOutcome | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"line" | "stripe" | null>(null);

  const loadLine = useCallback(async (capture: boolean) => {
    if (!brandId) return;
    setBusy("line");
    setError("");
    try {
      const url = capture
        ? `/api/ad-lab/outcomes/line?brandId=${encodeURIComponent(brandId)}`
        : `/api/ad-lab/outcomes/line?brandId=${encodeURIComponent(brandId)}&history=1`;
      const res = await fetch(url, { method: capture ? "POST" : "GET", cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `LINE outcomes failed (${res.status})`);
      setLine(data.line as LineOutcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลด LINE ไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }, [brandId]);

  const loadStripe = useCallback(async () => {
    if (!brandId) return;
    setBusy("stripe");
    setError("");
    try {
      const res = await fetch(`/api/ad-lab/outcomes/stripe?brandId=${encodeURIComponent(brandId)}&days=30`, {
        method: "POST",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Stripe outcomes failed (${res.status})`);
      setStripe(data.stripe as StripeOutcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลด Stripe ไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }, [brandId]);

  useEffect(() => {
    void loadLine(false);
  }, [loadLine]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chinese_TTT outcomes</CardTitle>
        <CardDescription>
          เพื่อน LINE OA + รายได้ Stripe (อ่านอย่างเดียว) สำหรับเทียบ CPA / ROAS กับค่าโฆษณา TikTok
        </CardDescription>
      </CardHeader>

      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold text-slate-900">LINE Official Account</h4>
            <Button size="sm" variant="secondary" loading={busy === "line"} onClick={() => void loadLine(true)}>
              ดึงจำนวนเพื่อน
            </Button>
          </div>
          {line ? (
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-3xl font-bold text-slate-950">
                {(line.latest?.friendCount ?? 0).toLocaleString()}
                <span className="ml-2 text-sm font-medium text-slate-500">friends</span>
              </p>
              <p className="text-slate-600">
                Delta จากครั้งก่อน:{" "}
                <strong>{line.delta === null ? "—" : `${line.delta >= 0 ? "+" : ""}${line.delta}`}</strong>
              </p>
              <p className={`text-xs ${line.stub ? "text-amber-700" : "text-slate-500"}`}>{line.message}</p>
              {line.series.length > 1 && (
                <p className="text-xs text-slate-500">เก็บประวัติแล้ว {line.series.length} จุด</p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">ยังไม่มีข้อมูล — กดดึงจำนวนเพื่อน (stub ได้ถ้ายังไม่มี token)</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold text-slate-900">Stripe received (30 วัน)</h4>
            <Button size="sm" variant="secondary" loading={busy === "stripe"} onClick={() => void loadStripe()}>
              ดึงรายได้
            </Button>
          </div>
          {stripe ? (
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-3xl font-bold text-slate-950">
                ฿{stripe.amountBaht.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
              <p className="text-slate-600">{stripe.chargeCount} successful payment(s)</p>
              <p className="text-xs text-slate-500">Filter: {stripe.productFilter}</p>
              <p className={`text-xs ${stripe.stub ? "text-amber-700" : "text-slate-500"}`}>{stripe.message}</p>
              <p className="text-[11px] text-slate-400">
                Read-only — Ad Lab ไม่สร้าง charge / checkout / payout
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">กดดึงรายได้จาก Stripe (metadata product=chinese_ttt)</p>
          )}
        </div>
      </div>
    </Card>
  );
}
