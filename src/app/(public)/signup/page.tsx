import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { redirect } from "next/navigation";
import { getRoleHomePath } from "@/config/routes";
import { Role } from "@/domain/enums/Role";
import { SignupForm } from "@/features/auth/components/SignupForm";
import { getServerI18n } from "@/i18n/server";

export const metadata: Metadata = {
  title: "สร้างบัญชี",
  description: "สร้างบัญชี RClipper ฟรีและเริ่มต้นด้วย 30 เครดิต",
};

export default async function SignupPage() {
  const { t } = getServerI18n();
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(getRoleHomePath(session.user.role as Role));
  }

  return (
    <div className="flex min-h-[calc(100vh-128px)] items-center justify-center px-4 py-12">
      <div className="auth-card">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">
            {t("signup.title")}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {t("signup.subtitle")}{" "}
            <span className="font-semibold text-blue-700">{t("signup.zeroCredits")}</span>
          </p>
        </div>

        <SignupForm />
      </div>
    </div>
  );
}
