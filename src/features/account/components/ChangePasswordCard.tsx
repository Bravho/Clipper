"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * Change-password card — rendered only for credentials (email/password)
 * accounts. OAuth accounts (Google/Apple) have no password.
 */
export function ChangePasswordCard() {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 8) {
      setError("รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("รหัสผ่านใหม่และการยืนยันไม่ตรงกัน");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
        return;
      }
      setSuccess(true);
      setOpen(false);
      reset();
    } catch {
      setError("ไม่สามารถเชื่อมต่อได้ กรุณาลองอีกครั้ง");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>รหัสผ่าน</CardTitle>
      </CardHeader>

      {success && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          เปลี่ยนรหัสผ่านเรียบร้อยแล้ว
        </div>
      )}

      {!open ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            เปลี่ยนรหัสผ่านสำหรับการเข้าสู่ระบบด้วยอีเมล
          </p>
          <Button variant="outline" onClick={() => setOpen(true)}>
            เปลี่ยนรหัสผ่าน
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="รหัสผ่านปัจจุบัน"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <Input
            label="รหัสผ่านใหม่"
            type="password"
            autoComplete="new-password"
            hint="อย่างน้อย 8 ตัวอักษร"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <Input
            label="ยืนยันรหัสผ่านใหม่"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />

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
                reset();
              }}
            >
              ยกเลิก
            </Button>
            <Button type="submit" loading={loading}>
              บันทึกรหัสผ่านใหม่
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
