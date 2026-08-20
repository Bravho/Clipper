"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/config/routes";
import { fetchWithTimeout, RequestTimeoutError } from "@/lib/fetchWithTimeout";
import {
  forgotPasswordSchema,
  ForgotPasswordInput,
} from "@/features/auth/validation/passwordResetSchema";
import { ResetRequestOutcome } from "@/domain/enums/PasswordReset";
import { AuthProvider } from "@/domain/enums/AuthProvider";

/**
 * "ลืมรหัสผ่าน" step 1 — look the address up, then send the link.
 *
 * The two results are reported as two separate lines on purpose. "เราไม่พบ
 * อีเมลนี้" and "พบบัญชีแล้ว แต่ส่งอีเมลไม่สำเร็จ" call for completely
 * different next actions from the user (retype vs. retry), and a single
 * merged "check your inbox" message would hide both.
 */

const PROVIDER_LABELS: Record<string, string> = {
  [AuthProvider.Google]: "Google",
  [AuthProvider.Apple]: "Apple",
};

interface RequestResetResponse {
  success: boolean;
  error?: string;
  data?: {
    outcome: ResetRequestOutcome;
    emailFound: boolean;
    emailSent: boolean;
    providers?: AuthProvider[];
  };
}

type Result =
  | { kind: "outcome"; outcome: ResetRequestOutcome; providers?: AuthProvider[]; email: string }
  | { kind: "error"; message: string };

export function ForgotPasswordForm() {
  const [result, setResult] = useState<Result | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordInput) => {
    setResult(null);
    try {
      const res = await fetchWithTimeout("/api/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email }),
      });
      const payload: RequestResetResponse = await res.json();

      if (!res.ok || !payload.success || !payload.data) {
        setResult({
          kind: "error",
          message: payload.error ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
        });
        return;
      }

      setResult({
        kind: "outcome",
        outcome: payload.data.outcome,
        providers: payload.data.providers,
        email: data.email,
      });
    } catch (error) {
      setResult({
        kind: "error",
        message:
          error instanceof RequestTimeoutError
            ? "เซิร์ฟเวอร์ใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง"
            : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
      });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {result?.kind === "error" && (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {result.message}
        </div>
      )}

      {result?.kind === "outcome" && (
        <ResultPanel
          outcome={result.outcome}
          providers={result.providers}
          email={result.email}
        />
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <Input
          label="อีเมลที่ใช้สมัคร"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...register("email")}
        />

        <Button type="submit" fullWidth loading={isSubmitting}>
          {result?.kind === "outcome" &&
          result.outcome === ResetRequestOutcome.Sent &&
          result.email === getValues("email")
            ? "ส่งลิงก์อีกครั้ง"
            : "ส่งลิงก์ตั้งรหัสผ่านใหม่"}
        </Button>
      </form>

      <p className="text-center text-sm text-slate-400">
        จำรหัสผ่านได้แล้ว?{" "}
        <Link href={ROUTES.LOGIN} className="font-medium text-blue-700 hover:underline">
          กลับไปเข้าสู่ระบบ
        </Link>
      </p>
    </div>
  );
}

/**
 * Renders the check result and the delivery result as two explicit lines, so
 * the user can always tell which of the two steps is the one that failed.
 */
function ResultPanel({
  outcome,
  providers,
  email,
}: {
  outcome: ResetRequestOutcome;
  providers?: AuthProvider[];
  email: string;
}) {
  const emailTag = <span className="font-medium">{email}</span>;

  if (outcome === ResetRequestOutcome.UnknownEmail) {
    return (
      <div
        className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        role="alert"
      >
        <p className="font-semibold">1. ตรวจสอบอีเมล: ไม่พบบัญชี</p>
        <p className="mt-1">
          ไม่พบบัญชีที่ใช้อีเมล {emailTag} ในระบบ กรุณาตรวจสอบตัวสะกดอีกครั้ง
        </p>
        <p className="mt-2 font-semibold">2. ส่งอีเมล: ยังไม่ได้ส่ง</p>
        <p className="mt-1">
          เรายังไม่ได้ส่งลิงก์ใด ๆ ออกไป หากคุณยังไม่มีบัญชี{" "}
          <Link href={ROUTES.SIGNUP} className="font-medium underline">
            สมัครใช้งานฟรีที่นี่
          </Link>
        </p>
      </div>
    );
  }

  if (outcome === ResetRequestOutcome.SocialOnly) {
    const names = (providers ?? [])
      .map((p) => PROVIDER_LABELS[p] ?? p)
      .join(" หรือ ");
    return (
      <div
        className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
        role="alert"
      >
        <p className="font-semibold">1. ตรวจสอบอีเมล: พบบัญชีแล้ว</p>
        <p className="mt-1">
          บัญชี {emailTag} เข้าสู่ระบบด้วย {names || "Google/Apple"} จึงไม่มีรหัสผ่านให้ตั้งใหม่
        </p>
        <p className="mt-2 font-semibold">2. ส่งอีเมล: ยังไม่ได้ส่ง</p>
        <p className="mt-1">
          กรุณา{" "}
          <Link href={ROUTES.LOGIN} className="font-medium underline">
            เข้าสู่ระบบด้วย {names || "Google/Apple"}
          </Link>{" "}
          แทน
        </p>
      </div>
    );
  }

  if (outcome === ResetRequestOutcome.EmailFailed) {
    return (
      <div
        className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        role="alert"
      >
        <p className="font-semibold">1. ตรวจสอบอีเมล: พบบัญชีแล้ว</p>
        <p className="mt-1">อีเมล {emailTag} มีบัญชีอยู่ในระบบ</p>
        <p className="mt-2 font-semibold">2. ส่งอีเมล: ไม่สำเร็จ</p>
        <p className="mt-1">
          ระบบส่งอีเมลขัดข้องชั่วคราว กรุณากดส่งอีกครั้งในอีกสักครู่
          หากยังไม่สำเร็จ กรุณาติดต่อทีมงาน RClipper
        </p>
      </div>
    );
  }

  if (outcome === ResetRequestOutcome.Throttled) {
    return (
      <div
        className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
        role="status"
      >
        <p className="font-semibold">1. ตรวจสอบอีเมล: พบบัญชีแล้ว</p>
        <p className="mt-1">อีเมล {emailTag} มีบัญชีอยู่ในระบบ</p>
        <p className="mt-2 font-semibold">2. ส่งอีเมล: เพิ่งส่งไปเมื่อครู่นี้</p>
        <p className="mt-1">
          เราเพิ่งส่งลิงก์ไปให้แล้ว กรุณาตรวจสอบกล่องจดหมาย (รวมถึงอีเมลขยะ)
          ก่อนขอลิงก์ใหม่อีกครั้งในอีก 1 นาที
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      role="status"
    >
      <p className="font-semibold">1. ตรวจสอบอีเมล: พบบัญชีแล้ว</p>
      <p className="mt-1">อีเมล {emailTag} มีบัญชีอยู่ในระบบ</p>
      <p className="mt-2 font-semibold">2. ส่งอีเมล: สำเร็จ</p>
      <p className="mt-1">
        เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ {emailTag} แล้ว
        กรุณาเปิดอีเมลแล้วกดลิงก์ภายใน 60 นาที
        (หากไม่พบ กรุณาตรวจสอบในโฟลเดอร์อีเมลขยะ)
      </p>
    </div>
  );
}
