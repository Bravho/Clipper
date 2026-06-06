"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export function ManualBuyForm() {
  const router = useRouter();
  const [creditsAmount, setCreditsAmount] = useState<string>("50");
  const [pricePaidBaht, setPricePaidBaht] = useState<string>("500");
  const [reference, setReference] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Automatically estimate price based on standard 10 THB / credit
  const handleCreditsChange = (val: string) => {
    setCreditsAmount(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0) {
      setPricePaidBaht((parsed * 10).toString());
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(null);
    setError(null);

    try {
      const res = await fetch("/api/credits/buy-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creditsAmount,
          pricePaidBaht,
          reference,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถดำเนินการได้");
      }

      setSuccess("ยืนยันการโอนเงินสำเร็จ! ระบบได้เพิ่มเครดิตในกระเป๋าเงินของคุณแล้ว");
      setReference("");
      
      // Refresh the server component state (balance & transaction history)
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="mb-4 text-base font-semibold text-slate-900">
        แจ้งโอนเงินเพื่อซื้อเครดิต (ซื้อแบบแมนนวล)
      </h2>
      <p className="mb-4 text-xs text-slate-500">
        ทำการโอนเงินไปยังบัญชีธนาคารของบริษัท จากนั้นกรอกข้อมูลการโอนเงินด้านล่างเพื่อรับเครดิตทันที (1 เครดิต = 10 บาท)
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="จำนวนเครดิต"
            type="number"
            min="1"
            value={creditsAmount}
            onChange={(e) => handleCreditsChange(e.target.value)}
            required
          />
          <Input
            label="ยอดเงินโอน (บาท)"
            type="number"
            min="0"
            step="0.01"
            value={pricePaidBaht}
            onChange={(e) => setPricePaidBaht(e.target.value)}
            required
          />
        </div>

        <Input
          label="รหัสอ้างอิงการโอนเงิน / เลขสลิป"
          placeholder="เช่น KBANK-123456"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          hint="กรอกหมายเลขอ้างอิงที่ระบุบนสลิปเพื่อการตรวจสอบย้อนหลัง"
          required
        />

        {success && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            {success}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <Button type="submit" loading={loading} className="w-full">
          บันทึกแจ้งโอนเงินและรับเครดิต
        </Button>
      </form>
    </Card>
  );
}
