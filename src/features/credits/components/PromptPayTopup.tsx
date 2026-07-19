"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TOPUP_BUNDLES } from "@/config/credits";

type Bundle = (typeof TOPUP_BUNDLES)[number];
type PaymentMethod = "promptpay" | "card";

interface TopupResult {
  intentId: string;
  referenceNo: string;
  amountBaht: number;
  creditsToAdd: number;
  qrImageDataUrl?: string;
  checkoutUrl?: string;
  /** False when Stripe runs in test mode — the QR is a simulation, unscannable by bank apps. */
  livemode?: boolean;
  hostedInstructionsUrl?: string;
}

interface Props {
  currentBalance?: number;
  unlockRequestId?: string;
  returnTo?: string;
  unlockPrice?: number;
}

export function PromptPayTopup({
  currentBalance = 0,
  unlockRequestId,
  returnTo,
  unlockPrice = 0,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [method, setMethod] = useState<PaymentMethod>("promptpay");
  const [selected, setSelected] = useState<Bundle>(
    TOPUP_BUNDLES.find((b) => "popular" in b && b.popular) ?? TOPUP_BUNDLES[0]
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<TopupResult | null>(null);
  const [paid, setPaid] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const safeReturnTo =
    returnTo?.startsWith("/dashboard/requests/") ? returnTo : undefined;

  const completeUnlock = async () => {
    if (!unlockRequestId) return;
    setUnlocking(true);
    const res = await fetch(`/api/requests/${unlockRequestId}/unlock-download`, {
      method: "POST",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUnlocking(false);
      throw new Error(body.error ?? "ไม่สามารถหักเครดิตและปลดล็อกวิดีโอได้");
    }
    router.push(safeReturnTo ?? `/dashboard/requests/${unlockRequestId}`);
    router.refresh();
  };

  const startPolling = (intentId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const poll = async () => {
      try {
        const res = await fetch(`/api/credits/topup/${intentId}/status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const { status } = await res.json();
        if (status === "paid") {
          if (pollRef.current) clearInterval(pollRef.current);
          setPaid(true);
          router.refresh();
          if (unlockRequestId) await completeUnlock();
        } else if (status === "expired" || status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setError("การชำระเงินหมดอายุหรือไม่สำเร็จ กรุณาลองใหม่");
          setIntent(null);
        }
      } catch (err) {
        if (err instanceof Error && unlockRequestId) setError(err.message);
      }
    };
    void poll();
    pollRef.current = setInterval(poll, 3000);
  };

  useEffect(() => {
    const returnedIntent = searchParams.get("topupIntent");
    if (returnedIntent) startPolling(returnedIntent);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // The return intent is intentionally read once on page entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startTopup = async () => {
    setLoading(true);
    setError(null);
    setPaid(false);
    try {
      const query = searchParams.toString();
      const returnPath = `${pathname}${query ? `?${query}` : ""}`;
      const res = await fetch("/api/credits/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountBaht: selected.baht,
          paymentMethod: method,
          returnPath,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "ไม่สามารถเริ่มชำระเงินได้");
      const topup = data as TopupResult;
      if (method === "card") {
        if (!topup.checkoutUrl) throw new Error("Stripe ไม่ได้ส่งหน้าชำระเงินกลับมา");
        window.location.assign(topup.checkoutUrl);
        return;
      }
      setIntent(topup);
      startPolling(topup.intentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900">เติมเครดิต</h2>
      <p className="mt-1 text-xs text-slate-500">
        เลือกวิธีชำระเงิน · 1 เครดิต = 1 บาท · เครดิตเข้าหลัง Stripe ยืนยันการชำระ
      </p>

      {unlockRequestId && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          ต้องใช้ {unlockPrice} เครดิตเพื่อปลดล็อกวิดีโอทั้งหมดในคำขอนี้
          ปัจจุบันมี {currentBalance} เครดิต
          {currentBalance < unlockPrice
            ? ` — กรุณาเติมอย่างน้อย ${unlockPrice - currentBalance} เครดิต`
            : " — พร้อมหักเครดิตและปลดล็อกทันที"}
        </div>
      )}

      {unlockRequestId && currentBalance >= unlockPrice && !paid ? (
        <Button
          className="mt-4 w-full"
          loading={unlocking}
          onClick={() => void completeUnlock().catch((err) => setError(err.message))}
        >
          ใช้ {unlockPrice} เครดิตและปลดล็อกวิดีโอ
        </Button>
      ) : paid ? (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          ชำระเงินสำเร็จ เครดิตถูกเพิ่มแล้ว
          {unlockRequestId && " ระบบกำลังหักเครดิตและปลดล็อกวิดีโอให้คุณ…"}
        </div>
      ) : intent?.qrImageDataUrl ? (
        <div className="mt-5 flex flex-col items-center gap-3">
          {/* Stripe test mode: the QR encodes a simulation URL, NOT a real
              PromptPay payload — bank apps cannot scan it. Explain, and offer
              the hosted page to authorise a simulated payment instead. */}
          {intent.livemode === false && (
            <div className="w-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-left">
              <p className="text-sm font-semibold text-amber-800">
                โหมดทดสอบ (Stripe Test Mode)
              </p>
              <p className="mt-1 text-xs text-amber-700">
                QR นี้เป็น QR จำลอง — แอปธนาคารจะสแกนไม่ได้
                ให้สแกนด้วยแอปกล้องของโทรศัพท์ หรือกดปุ่มด้านล่างเพื่อจำลองการชำระเงิน
              </p>
              {intent.hostedInstructionsUrl && (
                <a
                  href={intent.hostedInstructionsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  เปิดหน้าจำลองการชำระเงิน →
                </a>
              )}
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={intent.qrImageDataUrl}
            alt="PromptPay QR สำหรับชำระทันที"
            className="h-56 w-56 rounded-lg border border-slate-200"
          />
          <p className="text-sm font-medium text-slate-800">
            ชำระ ฿{intent.amountBaht} เพื่อรับ {intent.creditsToAdd} เครดิต
          </p>
          <p className="text-xs text-slate-500">
            สแกนและชำระตอนนี้ · อ้างอิง {intent.referenceNo}
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
          <fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">เลือกวิธีชำระเงิน</legend>
            {([
              ["promptpay", "PromptPay QR", "สแกนจ่ายทันทีผ่านแอปธนาคาร"],
              ["card", "Credit card", "ชำระทันทีบนหน้าชำระเงินที่ปลอดภัยของ Stripe"],
            ] as const).map(([value, label, description]) => (
              <label
                key={value}
                className={`flex cursor-pointer gap-3 rounded-lg border p-4 ${
                  method === value ? "border-blue-600 bg-blue-50" : "border-slate-200"
                }`}
              >
                <input
                  type="radio"
                  name="payment-method"
                  value={value}
                  checked={method === value}
                  onChange={() => setMethod(value)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{label}</span>
                  <span className="block text-xs text-slate-500">{description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TOPUP_BUNDLES.map((bundle) => (
              <button
                key={bundle.baht}
                onClick={() => setSelected(bundle)}
                className={`rounded-lg border p-3 text-left transition ${
                  bundle.baht === selected.baht
                    ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <span className="block text-sm font-semibold text-slate-900">
                  ฿{bundle.baht}
                </span>
                <span className="block text-xs text-slate-500">
                  {bundle.credits} เครดิต · {bundle.label}
                </span>
                {"popular" in bundle && bundle.popular && (
                  <span className="mt-1 block text-[10px] font-medium text-blue-600">
                    ยอดนิยม
                  </span>
                )}
              </button>
            ))}
          </div>

          {searchParams.get("card") === "cancelled" && !error && (
            <p className="mb-3 text-sm text-amber-700">ยกเลิกการชำระด้วยบัตรแล้ว</p>
          )}
          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <Button onClick={startTopup} loading={loading} className="w-full">
            {method === "promptpay"
              ? `สร้าง QR PromptPay และชำระทันที (฿${selected.baht})`
              : `ไปยังหน้าชำระด้วย Credit card (฿${selected.baht})`}
          </Button>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            เป็นการชำระครั้งเดียว ไม่มีการตั้งเวลาหรือตัดเงินภายหลัง
          </p>
        </>
      )}
    </Card>
  );
}
