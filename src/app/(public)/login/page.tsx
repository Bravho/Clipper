import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { redirect } from "next/navigation";
import { getRoleHomePath, ROUTES } from "@/config/routes";
import { Role } from "@/domain/enums/Role";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { getServerI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages";

export const metadata: Metadata = {
  title: "เข้าสู่ระบบ",
  description: "เข้าสู่ระบบบัญชี RClipper ของคุณ",
};

const AUTH_ERROR_KEYS: Record<string, MessageKey> = {
  OAuthSignin: "login.error.oauthSignin",
  OAuthCallback: "login.error.oauthCallback",
  OAuthAccountNotLinked: "login.error.notLinked",
  AccessDenied: "login.error.accessDenied",
  Configuration: "login.error.configuration",
};

/** Notices other pages send here by code (?notice=), worded in the menu's language. */
const NOTICE_KEYS: Record<string, MessageKey> = {
  "account-exists": "login.notice.accountExists",
  "password-reset": "login.notice.passwordReset",
  "email-verified": "login.notice.emailVerified",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { message?: string; error?: string; notice?: string };
}) {
  const { t } = getServerI18n();
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(getRoleHomePath(session.user.role as Role));
  }

  const authError = searchParams?.error
    ? t(AUTH_ERROR_KEYS[searchParams.error] ?? "login.error.generic")
    : null;
  const noticeKey = searchParams?.notice ? NOTICE_KEYS[searchParams.notice] : undefined;
  // `?message=` (free text) is still read for links already sent out.
  const notice = noticeKey ? t(noticeKey) : searchParams?.message ?? null;

  return (
    <div className="flex min-h-[calc(100vh-128px)] items-center justify-center px-4 py-12">
      <div className="auth-card">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">{t("login.title")}</h1>
          <p className="mt-2 text-sm text-slate-500">
            {t("login.subtitle")}
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

        {notice && (
          <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            {notice}
          </div>
        )}

        <LoginForm />

        <div className="mt-6 border-t border-slate-200 pt-4">
          <p className="text-center text-xs text-slate-400">
            {t("login.consentLead")}{" "}
            <a href={ROUTES.TERMS} className="underline hover:text-slate-600">
              {t("account.policyTerms")}
            </a>{" "}
            {t("common.and")}{" "}
            <a href={ROUTES.PRIVACY} className="underline hover:text-slate-600">
              {t("legal.privacy")}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
