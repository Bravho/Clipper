"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { signupSchema, SignupInput } from "@/features/auth/validation/signupSchema";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SocialSignInButtons } from "./SocialSignInButtons";
import { ROUTES } from "@/config/routes";
import { fetchWithTimeout, RequestTimeoutError } from "@/lib/fetchWithTimeout";
import { useI18n } from "@/i18n/client";
import { localizeValidation } from "@/i18n/validationMessages";

/** `callbackUrl`: already sanitised (safeReturnPath); where to land after social sign-up. */
export function SignupForm({ callbackUrl }: { callbackUrl?: string } = {}) {
  const { t } = useI18n();
  const v = (message: string | undefined) => localizeValidation(t, message);
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
  });

  const onSubmit = async (data: SignupInput) => {
    setServerError(null);

    try {
      const response = await fetchWithTimeout("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          if (result.data?.existingAccountVerified === true) {
            // A code, not a sentence: the login page words it in the
            // language picked in the menu.
            router.push(`${ROUTES.LOGIN}?notice=account-exists`);
            return;
          }

          // A previous attempt may have created the account successfully before
          // verification-email delivery failed. Preserve that account/password
          // and take the user to the resend flow instead of leaving them stuck.
          router.push(
            `${ROUTES.VERIFY_EMAIL}?email=${encodeURIComponent(data.email)}&existing=1`
          );
          return;
        }

        if (result.fieldErrors && typeof result.fieldErrors === "object") {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            if (
              (field === "name" ||
                field === "email" ||
                field === "password" ||
                field === "confirmPassword") &&
              Array.isArray(messages) &&
              typeof messages[0] === "string"
            ) {
              setError(field, { type: "server", message: messages[0] });
            }
          }
        }
        setServerError(result.error ?? t("signup.failed"));
        return;
      }

      // Account created — redirect to verify-email page
      const deliveryFailed =
        result.data?.verificationEmailSent === false ? "&delivery=failed" : "";
      router.push(
        `${ROUTES.VERIFY_EMAIL}?email=${encodeURIComponent(data.email)}${deliveryFailed}`
      );
    } catch (error) {
      // A timeout is reported distinctly: the account may well have been created
      // before the server stalled, so telling the user to retry blindly would
      // walk them into a duplicate-email error on the next attempt.
      setServerError(
        error instanceof RequestTimeoutError
          ? t("signup.timeout")
          : t("common.errorRetry")
      );
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

      <SocialSignInButtons
        callbackUrl={callbackUrl ?? ROUTES.DASHBOARD}
        dividerLabel={t("signup.orEmail")}
        dividerPlacement="after"
        googleLabel={t("signup.google")}
        appleLabel={t("signup.apple")}
      />

      <Input
        label={t("account.name")}
        type="text"
        autoComplete="name"
        placeholder={t("signup.namePlaceholder")}
        error={v(errors.name?.message)}
        {...register("name")}
      />

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
        autoComplete="new-password"
        placeholder="••••••••"
        hint={t("signup.passwordHint")}
        error={v(errors.password?.message)}
        {...register("password")}
      />

      <Input
        label={t("signup.confirmPassword")}
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        error={v(errors.confirmPassword?.message)}
        {...register("confirmPassword")}
      />

      <Button type="submit" fullWidth loading={isSubmitting} size="lg">
        {t("signup.submit")}
      </Button>

      <p className="text-center text-xs text-slate-500 leading-relaxed">
        {t("signup.consentLead")}{" "}
        <Link href={ROUTES.TERMS} className="underline hover:text-slate-700">
          {t("account.policyTerms")}
        </Link>
        {t("common.listComma")}
        <Link href={ROUTES.PRIVACY} className="underline hover:text-slate-700">
          {t("legal.privacy")}
        </Link>{" "}
        {t("common.and")}{" "}
        <Link href={ROUTES.OWNERSHIP} className="underline hover:text-slate-700">
          {t("legal.ownership")}
        </Link>
        {t("signup.consentTail")}
      </p>

      <div className="border-t border-slate-100 pt-2">
        <p className="text-center text-sm text-slate-500">
          {t("signup.haveAccount")}{" "}
          <Link
            href={callbackUrl ? `${ROUTES.LOGIN}?callbackUrl=${encodeURIComponent(callbackUrl)}` : ROUTES.LOGIN}
            className="text-blue-700 font-medium hover:underline"
          >
            {t("nav.signIn")}
          </Link>
        </p>
      </div>
    </form>
  );
}
