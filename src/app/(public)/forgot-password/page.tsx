import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/authOptions";
import { getRoleHomePath } from "@/config/routes";
import { Role } from "@/domain/enums/Role";
import { ForgotPasswordForm } from "@/features/auth/components/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "ลืมรหัสผ่าน",
  description: "ขอลิงก์ตั้งรหัสผ่านใหม่สำหรับบัญชี RClipper ของคุณ",
};

export default async function ForgotPasswordPage() {
  // Someone already signed in has no business here — send them home.
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(getRoleHomePath(session.user.role as Role));
  }

  return (
    <div className="flex min-h-[calc(100vh-128px)] items-center justify-center px-4 py-12">
      <div className="auth-card">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">ลืมรหัสผ่าน</h1>
          <p className="mt-2 text-sm text-slate-500">
            กรอกอีเมลที่ใช้สมัคร เราจะตรวจสอบบัญชีและส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้
          </p>
        </div>

        <ForgotPasswordForm />
      </div>
    </div>
  );
}
