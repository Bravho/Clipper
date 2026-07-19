"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { signupSchema, SignupInput } from "@/features/auth/validation/signupSchema";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { ROUTES } from "@/config/routes";

export function SignupForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
  });

  const onSubmit = async (data: SignupInput) => {
    setServerError(null);

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        setServerError(result.error ?? "การสมัครสมาชิกล้มเหลว กรุณาลองอีกครั้ง");
        return;
      }

      // Account created — redirect to verify-email page
      router.push(`${ROUTES.VERIFY_EMAIL}?email=${encodeURIComponent(data.email)}`);
    } catch {
      setServerError("เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      {serverError && (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {serverError}
        </div>
      )}

      <GoogleSignInButton
        label="สมัครด้วย Google"
        callbackUrl={ROUTES.DASHBOARD}
      />

      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-slate-200" />
        <span className="text-xs text-slate-400">หรือสมัครด้วยอีเมล</span>
        <div className="flex-1 border-t border-slate-200" />
      </div>

      <Input
        label="ชื่อ-นามสกุล"
        type="text"
        autoComplete="name"
        placeholder="สมชาย ใจดี"
        error={errors.name?.message}
        {...register("name")}
      />

      <Input
        label="อีเมล"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        error={errors.email?.message}
        {...register("email")}
      />

      <Input
        label="รหัสผ่าน"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        hint="อย่างน้อย 8 ตัวอักษร ต้องมีตัวพิมพ์ใหญ่ พิมพ์เล็ก และตัวเลข"
        error={errors.password?.message}
        {...register("password")}
      />

      <Input
        label="ยืนยันรหัสผ่าน"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />

      <Button type="submit" fullWidth loading={isSubmitting} size="lg">
        สร้างบัญชี
      </Button>

      <p className="text-center text-xs text-slate-500 leading-relaxed">
        การคลิก &ldquo;สร้างบัญชี&rdquo; หรือ &ldquo;สมัครด้วย Google&rdquo; ถือว่าคุณยอมรับ{" "}
        <Link href={ROUTES.TERMS} className="underline hover:text-slate-700">
          ข้อกำหนดการใช้งาน
        </Link>{" "}
        และ{" "}
        <Link href={ROUTES.PRIVACY} className="underline hover:text-slate-700">
          นโยบายความเป็นส่วนตัว
        </Link>{" "}
        และ{" "}
        <Link href={ROUTES.OWNERSHIP} className="underline hover:text-slate-700">
          นโยบายสิทธิ์ในเนื้อหาและการเผยแพร่
        </Link>
        ซึ่งอธิบายการคัดเลือกวิดีโอบางรายการเพื่อเผยแพร่บน Travy
      </p>

      <div className="border-t border-slate-100 pt-2">
        <p className="text-center text-sm text-slate-500">
          มีบัญชีอยู่แล้ว?{" "}
          <Link
            href={ROUTES.LOGIN}
            className="text-blue-700 font-medium hover:underline"
          >
            เข้าสู่ระบบ
          </Link>
        </p>
      </div>
    </form>
  );
}
