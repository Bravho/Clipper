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

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { message?: string };
}) {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(getRoleHomePath(session.user.role as Role));
  }

  return (
    <div className="flex min-h-[calc(100vh-128px)] items-center justify-center px-4 py-12">
      <div className="auth-card">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">ยินดีต้อนรับกลับ</h1>
          <p className="mt-2 text-sm text-slate-500">
            เข้าสู่ระบบด้วยบัญชีที่คุณสมัครไว้
          </p>
        </div>

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
