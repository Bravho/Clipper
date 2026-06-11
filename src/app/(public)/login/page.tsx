import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { redirect } from "next/navigation";
import { getRoleHomePath, ROUTES } from "@/config/routes";
import { Role } from "@/domain/enums/Role";
import { LoginForm } from "@/features/auth/components/LoginForm";

export const metadata: Metadata = {
  title: "เข้าสู่ระบบ",
  description: "เข้าสู่ระบบบัญชี RClipper ของคุณ",
};

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: "ไม่สามารถเชื่อมต่อกับ Google ได้ กรุณาลองอีกครั้ง",
  OAuthCallback: "การยืนยันตัวตนกับ Google ล้มเหลว กรุณาลองอีกครั้ง",
  OAuthAccountNotLinked:
    "อีเมลนี้ถูกใช้สมัครด้วยวิธีอื่นแล้ว กรุณาเข้าสู่ระบบด้วยอีเมลและรหัสผ่าน",
  AccessDenied: "ไม่สามารถเข้าสู่ระบบด้วยบัญชี Google นี้ได้",
  Configuration: "ระบบเข้าสู่ระบบด้วย Google ยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลระบบ",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { message?: string; error?: string };
}) {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(getRoleHomePath(session.user.role as Role));
  }

  const authError = searchParams?.error
    ? AUTH_ERROR_MESSAGES[searchParams.error] ??
      "เกิดข้อผิดพลาดในการเข้าสู่ระบบ กรุณาลองอีกครั้ง"
    : null;

  return (
    <div className="flex min-h-[calc(100vh-128px)] items-center justify-center px-4 py-12">
      <div className="auth-card">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">ยินดีต้อนรับกลับ</h1>
          <p className="mt-2 text-sm text-slate-500">
            เข้าสู่ระบบด้วยบัญชีที่คุณสมัครไว้
          </p>
        </div>

        {authError && (
          <div
            className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {authError}
          </div>
        )}

        {searchParams?.message && (
          <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            {searchParams.message}
          </div>
        )}

        <LoginForm />

        <div className="mt-6 border-t border-slate-200 pt-4">
          <p className="text-center text-xs text-slate-400">
            การเข้าสู่ระบบถือว่าคุณยอมรับ{" "}
            <a href={ROUTES.TERMS} className="underline hover:text-slate-600">
              ข้อกำหนดการใช้งาน
            </a>{" "}
            และ{" "}
            <a href={ROUTES.PRIVACY} className="underline hover:text-slate-600">
              นโยบายความเป็นส่วนตัว
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
