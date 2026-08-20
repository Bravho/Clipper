import type { Metadata } from "next";
import { ResetPasswordForm } from "@/features/auth/components/ResetPasswordForm";

export const metadata: Metadata = {
  title: "ตั้งรหัสผ่านใหม่",
  description: "ตั้งรหัสผ่านใหม่สำหรับบัญชี RClipper ของคุณ",
};

/**
 * The page the emailed link opens.
 *
 * The token is read from `searchParams` on the server and handed down as a
 * prop rather than read with `useSearchParams()` in the client component —
 * that hook forces a Suspense boundary at build time and would otherwise
 * bail the whole route out of static analysis.
 *
 * Note there is no signed-in redirect here: an already-authenticated user
 * following a reset link (e.g. from a second device) should still be able to
 * complete it.
 */
export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: { token?: string };
}) {
  return (
    <div className="flex min-h-[calc(100vh-128px)] items-center justify-center px-4 py-12">
      <div className="auth-card">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">ตั้งรหัสผ่านใหม่</h1>
          <p className="mt-2 text-sm text-slate-500">
            กำหนดรหัสผ่านใหม่ แล้วเข้าสู่ระบบอีกครั้งด้วยรหัสผ่านนี้
          </p>
        </div>

        <ResetPasswordForm token={searchParams?.token ?? ""} />
      </div>
    </div>
  );
}
