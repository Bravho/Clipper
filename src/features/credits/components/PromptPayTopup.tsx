"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TOPUP_BUNDLES } from "@/config/credits";

type Bundle = (typeof TOPUP_BUNDLES)[number];

interface TopupResult {
  intentId: string;
  referenceNo: string;
  amountBaht: number;
  creditsToAdd: number;
  qrImageDataUrl: string;
  expiresAt: string;
}

/**
 * PromptPay top-up: pick a bundle → show GB Prime Pay QR → poll until the
 * webhook credits the wallet, then refresh the page.
 */
export function PromptPayTopup() {
  const router = useRouter();
  const [selected, setSelected] = useState<Bundle>(
    TOPUP_BUNDLES.find((b) => "popular" in b && b.popular) ?? TOPUP_BUNDLES[0]
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<TopupResult | null>(null);
  const [paid, setPaid] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startTopup = async () => {
    setLoading(true);
    setError(null);
    setPaid(false);
    try {
      const res = await fetch("/api/credits/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountBaht: selected.baht }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถสร้าง QR ได้");
      }
      const data: TopupResult = await res.json();
      setIntent(data);
      startPolling(data.intentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  };

  const startPolling = (intentId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/credits/topup/${intentId}/status`);
        if (!res.ok) return;
        const { status } = await res.json();
        if (status === "paid") {
          if (pollRef.current) clearInterval(pollRef.current);
          setPaid(true);
          router.refresh();
        } else if (status === "expired" || status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setError("การชำระเงินหมดอายุหรือไม่สำเร็จ กรุณาลองใหม่");
          setIntent(null);
        }
      } catch {
        /* transient — keep polling */
      }
    }, 3000);
  };

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-base font-semibold text-slate-900">
        เติมเครดิตด้วย PromptPay QR
      </h2>
      <p className="mb-4 text-xs text-slate-500">
        1 เครดิต = 1 บาท · สแกนจ่ายผ่านแอปธนาคาร เครดิตเข้าอัตโนมัติทันทีที่ชำระเงินสำเร็จ
      </p>

      {paid ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          ✅ เติมเครดิตสำเร็จ! ระบบได้เพิ่ม {intent?.creditsToAdd} เครดิตแล้ว
        </div>
      ) : intent ? (
        <div className="flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={intent.qrImageDataUrl}
            alt="PromptPay QR"
            className="h-56 w-56 rounded-lg border border-slate-200"
          />
          <p className="text-sm font-medium text-slate-800">
            ชำระ ฿{intent.amountBaht} เพื่อรับ {intent.creditsToAdd} เครดิต
          </p>
          <p className="text-xs text-slate-400">
            อ้างอิง: {intent.referenceNo} · รอการยืนยันการชำระเงิน…
          </p>
          <button
            className="text-xs text-slate-500 underline"
            onClick={() => {
              if (pollRef.current) clearInterval(pollRef.current);
              setIntent(null);
            }}
          >
            ยกเลิก
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TOPUP_BUNDLES.map((b) => {
              const isSel = b.baht === selected.baht;
              return (
                <button
                  key={b.baht}
                  onClick={() => setSelected(b)}
                  className={`rounded-lg border p-3 text-left transition ${
                    isSel
                      ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900">฿{b.baht}</div>
                  <div className="text-xs text-slate-500">
                    {b.credits} เครดิต · {b.label}
                  </div>
                  {"popular" in b && b.popular && (
                    <div className="mt-1 text-[10px] font-medium text-blue-600">
                      ยอดนิยม
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <Button onClick={startTopup} loading={loading} className="w-full">
            สร้าง QR PromptPay (฿{selected.baht})
          </Button>
        </>
      )}
    </Card>
  );
}
