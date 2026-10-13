"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, getSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { loginSchema, LoginInput } from "@/features/auth/validation/loginSchema";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SocialSignInButtons } from "./SocialSignInButtons";
import { getRoleHomePath } from "@/config/routes";
import { Role } from "@/domain/enums/Role";
import { ROUTES } from "@/config/routes";
import { useI18n } from "@/i18n/client";
import { localizeValidation } from "@/i18n/validationMessages";

export function LoginForm() {
  const { t } = useI18n();
  const v = (message: string | undefined) => localizeValidation(t, message);
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginInput) => {
    setServerError(null);
    try {
      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error === "EmailNotVerified") {
        setServerError(t("login.verifyFirst"));
        return;
      }

      if (result?.error === "CredentialsSignin") {
        setServerError(t("login.wrongCredentials"));
        return;
      }

      if (result?.error || !result?.ok) {
        setServerError(t("login.unavailable"));
        return;
      }

      if (result.ok) {
        // Fetch session to get role for redirect
        const session = await getSession();
        const role = session?.user?.role as Role | undefined;
        const destination = role ? getRoleHomePath(role) : ROUTES.DASHBOARD;
        router.push(destination);
        router.refresh();
      }
    } catch {
      setServerError(t("common.errorRetry"));
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

      <Input
        label={t("account.email")}
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        error={v(errors.email?.message)}
        {...register("email")}
      />

      <Input
        label={t("password.title")}
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        error={v(errors.password?.message)}
        {...register("password")}
      />

      <div className="-mt-2 text-right">
        <Link
          href={ROUTES.FORGOT_PASSWORD}
          className="text-sm font-medium text-blue-700 hover:underline"
        >
          {t("login.forgot")}
        </Link>
      </div>

      <Button type="submit" fullWidth loading={isSubmitting}>
        {t("nav.signIn")}
      </Button>

      <SocialSignInButtons
        dividerLabel={t("login.or")}
        dividerPlacement="before"
        googleLabel={t("login.google")}
        appleLabel={t("login.apple")}
      />

      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-slate-200" />
        <span className="text-xs text-slate-400">{t("login.noAccount")}</span>
        <div className="flex-1 border-t border-slate-200" />
      </div>

      <Link href={ROUTES.SIGNUP} className="w-full">
        <Button variant="outline" fullWidth>
          {t("login.createFree")}
        </Button>
      </Link>
    </form>
  );
}
