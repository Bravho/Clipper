"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/config/routes";
import { fetchWithTimeout, RequestTimeoutError } from "@/lib/fetchWithTimeout";
import {
  resetPasswordSchema,
  ResetPasswordInput,
} from "@/features/auth/validation/passwordResetSchema";
import { ResetTokenState } from "@/domain/enums/PasswordReset";

/**
 * "ลืมรหัสผ่าน" step 2 — the screen the emailed link opens.
 *
 * The link is checked on mount, before the form is offered: a user who waited
 * two hours should be told the link expired straight away, not after choosing
 * and typing a new password twice.
 *
 * On success we do NOT sign the user in. They return to /login and use the new
 * password, which is the only thing that actually proves the reset worked.
 */

const DEAD_LINK_COPY: Record<
  Exclude<ResetTokenState, ResetTokenState.Valid>,
  { title: string; body: string }
> = {
  [ResetTokenState.Invalid]: {
    title: "ลิงก์นี้ใช้งานไม่ได้",
    body: "ลิงก์อาจไม่สมบูรณ์ หรือถูกแทนที่ด้วยลิงก์ใหม่ที่คุณขอภายหลัง กรุณาขอลิงก์ตั้งรหัสผ่านใหม่อีกครั้ง",
  },
  [ResetTokenState.Expired]: {
    title: "ลิงก์นี้หมดอายุแล้ว",
    body: "ลิงก์ตั้งรหัสผ่านใหม่มีอายุ 60 นาที กรุณาขอลิงก์ใหม่อีกครั้ง",
  },
  [ResetTokenState.Used]: {
    title: "ลิงก์นี้ถูกใช้ไปแล้ว",
    body: "รหัสผ่านถูกตั้งใหม่ด้วยลิงก์นี้ไปแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่ หากยังเข้าไม่ได้ กรุณาขอลิงก์ใหม่",
  },
};

interface ValidateResponse {
  success: boolean;
  error?: string;
  data?: { state: ResetTokenState; maskedEmail?: string };
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [tokenState, setTokenState] = useState<ResetTokenState>(
    ResetTokenState.Invalid
  );
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
  });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!token) {
        if (!cancelled) {
          setTokenState(ResetTokenState.Invalid);
          setChecking(false);
        }
        return;
      }

      try {
        const res = await fetchWithTimeout(
          `/api/password-reset/validate?token=${encodeURIComponent(token)}`
        );
        const payload: ValidateResponse = await res.json();
        if (cancelled) return;

        if (payload.success && payload.data) {
          setTokenState(payload.data.state);
          setMaskedEmail(payload.data.maskedEmail ?? null);
        } else {
          setTokenState(ResetTokenState.Invalid);
        }
      } catch {
        if (!cancelled) setTokenState(ResetTokenState.Invalid);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = async (data: ResetPasswordInput) => {
    setServerError(null);
    try {
      const res = await fetchWithTimeout("/api/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password: data.password,
          confirmPassword: data.confirmPassword,
        }),
      });
      const payload: { success: boolean; error?: string } = await res.json();

      if (!res.ok || !payload.success) {
        setServerError(payload.error ?? "ตั้งรหัสผ่านใหม่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        return;
      }

      router.push(
        `${ROUTES.LOGIN}?message=${encodeURIComponent(
          "ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่"
        )}`
      );
      router.refresh();
    } catch (error) {
      setServerError(
        error instanceof RequestTimeoutError
          ? "เซิร์ฟเวอร์ใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง"
          : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"
      );
    }
  };

  if (checking) {
    return (
      <p className="py-6 text-center text-sm text-slate-500">
        กำลังตรวจสอบลิงก์…
      </p>
    );
  }

  if (tokenState !== ResetTokenState.Valid) {
    const copy = DEAD_LINK_COPY[tokenState];
    return (
      <div className="flex flex-col gap-5">
        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          role="alert"
        >
          <p className="font-semibold">{copy.title}</p>
          <p className="mt-1">{copy.body}</p>
        </div>

        <Link href={ROUTES.FORGOT_PASSWORD} className="w-full">
          <Button fullWidth>ขอลิงก์ตั้งรหัสผ่านใหม่</Button>
        </Link>

        <p className="text-center text-sm text-slate-400">
          <Link href={ROUTES.LOGIN} className="font-medium text-blue-700 hover:underline">
            กลับไปเข้าสู่ระบบ
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      {maskedEmail && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          กำลังตั้งรหัสผ่านใหม่สำหรับบัญชี{" "}
          <span className="font-medium text-slate-800">{maskedEmail}</span>
        </p>
      )}

      {serverError && (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {serverError}
        </div>
      )}

      <Input
        label="รหัสผ่านใหม่"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        hint="อย่างน้อย 8 ตัวอักษร ประกอบด้วยตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก และตัวเลข"
        error={errors.password?.message}
        {...register("password")}
      />

      <Input
        label="ยืนยันรหัสผ่านใหม่"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />

      <Button type="submit" fullWidth loading={isSubmitting}>
        บันทึกรหัสผ่านใหม่
      </Button>

      <p className="text-center text-sm text-slate-400">
        <Link href={ROUTES.LOGIN} className="font-medium text-blue-700 hover:underline">
          ยกเลิกและกลับไปเข้าสู่ระบบ
        </Link>
      </p>
    </form>
  );
}
