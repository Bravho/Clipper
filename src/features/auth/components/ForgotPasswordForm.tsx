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
import { useI18n } from "@/i18n/client";
import { localizeValidation } from "@/i18n/validationMessages";
import { rich } from "@/i18n/rich";

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
  const { t } = useI18n();
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
          message: payload.error ?? t("common.errorRetry"),
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
            ? t("common.timeout")
            : t("common.errorRetry"),
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
          label={t("forgot.emailLabel")}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={localizeValidation(t, errors.email?.message)}
          {...register("email")}
        />

        <Button type="submit" fullWidth loading={isSubmitting}>
          {result?.kind === "outcome" &&
          result.outcome === ResetRequestOutcome.Sent &&
          result.email === getValues("email")
            ? t("forgot.resend")
            : t("forgot.send")}
        </Button>
      </form>

      <p className="text-center text-sm text-slate-400">
        {t("forgot.remembered")}{" "}
        <Link href={ROUTES.LOGIN} className="font-medium text-blue-700 hover:underline">
          {t("forgot.backToLogin")}
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
  const { t } = useI18n();
  const emailTag = <span className="font-medium">{email}</span>;
  const checkFound = <p className="font-semibold">{t("forgot.checkFound")}</p>;
  const accountExists = <p className="mt-1">{rich(t("forgot.accountExists"), { email: emailTag })}</p>;

  if (outcome === ResetRequestOutcome.UnknownEmail) {
    return (
      <div
        className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        role="alert"
      >
        <p className="font-semibold">{t("forgot.checkNotFound")}</p>
        <p className="mt-1">{rich(t("forgot.notFoundBody"), { email: emailTag })}</p>
        <p className="mt-2 font-semibold">{t("forgot.sendNotYet")}</p>
        <p className="mt-1">
          {t("forgot.notSentBody")}{" "}
          <Link href={ROUTES.SIGNUP} className="font-medium underline">
            {t("forgot.signupHere")}
          </Link>
        </p>
      </div>
    );
  }

  if (outcome === ResetRequestOutcome.SocialOnly) {
    const names = (providers ?? [])
      .map((p) => PROVIDER_LABELS[p] ?? p)
      .join(t("forgot.orJoin"));
    return (
      <div
        className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
        role="alert"
      >
        {checkFound}
        <p className="mt-1">
          {rich(t("forgot.socialBody"), { email: emailTag, providers: names || "Google/Apple" })}
        </p>
        <p className="mt-2 font-semibold">{t("forgot.sendNotYet")}</p>
        <p className="mt-1">
          {rich(t("forgot.socialAction"), {
            link: (
              <Link href={ROUTES.LOGIN} className="font-medium underline">
                {t("forgot.signInWith", { providers: names || "Google/Apple" })}
              </Link>
            ),
          })}
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
        {checkFound}
        {accountExists}
        <p className="mt-2 font-semibold">{t("forgot.sendFailed")}</p>
        <p className="mt-1">{t("forgot.sendFailedBody")}</p>
      </div>
    );
  }

  if (outcome === ResetRequestOutcome.Throttled) {
    return (
      <div
        className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
        role="status"
      >
        {checkFound}
        {accountExists}
        <p className="mt-2 font-semibold">{t("forgot.sendThrottled")}</p>
        <p className="mt-1">{t("forgot.sendThrottledBody")}</p>
      </div>
    );
  }

  return (
    <div
      className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      role="status"
    >
      {checkFound}
      {accountExists}
      <p className="mt-2 font-semibold">{t("forgot.sendOk")}</p>
      <p className="mt-1">{rich(t("forgot.sendOkBody"), { email: emailTag })}</p>
    </div>
  );
}
