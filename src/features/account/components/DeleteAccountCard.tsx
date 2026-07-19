"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ROUTES } from "@/config/routes";

interface DeleteAccountCardProps {
  /** True when the account signs in with email/password (password re-verify). */
  hasPassword: boolean;
}

/**
 * Danger-zone card: delete the account (App Store 5.1.1(v) / Play Store
 * User Data policy). Credentials accounts confirm with their password;
 * OAuth accounts type "DELETE". Signs the user out on success.
 */
export function DeleteAccountCard({ hasPassword }: DeleteAccountCardProps) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = hasPassword ? password.length > 0 : confirmText === "DELETE";

  const handleDelete = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          hasPassword ? { password } : { confirm: confirmText }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
        setLoading(false);
        return;
      }
      // Account is gone — end the session immediately.
      await signOut({ callbackUrl: ROUTES.HOME });
    } catch {
      setError("ไม่สามารถเชื่อมต่อได้ กรุณาลองอีกครั้ง");
      setLoading(false);
    }
  };

  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle>ลบบัญชี</CardTitle>
      </CardHeader>

      {!open ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-slate-500">
            ลบบัญชีและข้อมูลส่วนบุคคลของคุณอย่างถาวร
          </p>
          <Button variant="danger" onClick={() => setOpen(true)}>
            ลบบัญชี
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-semibold">การลบบัญชีไม่สามารถย้อนกลับได้</p>
            <ul className="mt-2 list-disc pl-5">
              <li>ข้อมูลส่วนบุคคล (ชื่อ อีเมล และวิธีเข้าสู่ระบบ) จะถูกลบถาวร</li>
              <li>เครดิตคงเหลือทั้งหมดจะถูกยกเลิกและไม่สามารถคืนได้</li>
              <li>
                ประวัติการชำระเงินและการยินยอมนโยบายจะถูกเก็บไว้ตามที่กฎหมายกำหนด
                (ไม่มีข้อมูลส่วนบุคคล)
              </li>
              <li>
                เพื่อป้องกันการใช้สิทธิ์ทดลองฟรีซ้ำ
                ระบบจะเก็บรหัสอ้างอิงแบบเข้ารหัสทางเดียว (hash) ของอีเมล/บัญชีที่ใช้
                — การสมัครใหม่ด้วยอีเมลเดิมจะไม่ได้รับสิทธิ์ทดลองฟรีอีก
              </li>
            </ul>
          </div>

          {hasPassword ? (
            <Input
              label="ยืนยันด้วยรหัสผ่านของคุณ"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          ) : (
            <Input
              label='พิมพ์ "DELETE" เพื่อยืนยัน'
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          )}

          {error && (
            <div
              className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setPassword("");
                setConfirmText("");
                setError(null);
              }}
            >
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              loading={loading}
              disabled={!canSubmit}
              onClick={handleDelete}
            >
              ลบบัญชีถาวร
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
