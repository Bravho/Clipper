"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/config/routes";
import { fetchWithTimeout, RequestTimeoutError } from "@/lib/fetchWithTimeout";
import {
  resetPasswordSchema,
  ResetPasswordInput,
} from "@/features/auth/validation/passwordResetSchema";
import { ResetTokenState } from "@/domain/enums/PasswordReset";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages";
import { localizeValidation } from "@/i18n/validationMessages";

/**
 * "ลืมรหัสผ่าน" step 2 — the screen the emailed link opens.
 *
 * The link is checked on mount, before the form is offered: a user who waited
 * two hours should be told the link expired straight away, not after choosing
 * and typing a new password twice.
 *
 * On success we do NOT sign the user in. They return to /login and use the new
 * password, which is the only thing that actually proves the reset worked.
 */

const DEAD_LINK_COPY: Record<
  Exclude<ResetTokenState, ResetTokenState.Valid>,
  { title: MessageKey; body: MessageKey }
> = {
  [ResetTokenState.Invalid]: { title: "reset.invalidTitle", body: "reset.invalidBody" },
  [ResetTokenState.Expired]: { title: "reset.expiredTitle", body: "reset.expiredBody" },
  [ResetTokenState.Used]: { title: "reset.usedTitle", body: "reset.usedBody" },
};

interface ValidateResponse {
  success: boolean;
  error?: string;
  data?: { state: ResetTokenState; maskedEmail?: string };
}

export function ResetPasswordForm({ token }: { token: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [tokenState, setTokenState] = useState<ResetTokenState>(
    ResetTokenState.Invalid
  );
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
  });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!token) {
        if (!cancelled) {
          setTokenState(ResetTokenState.Invalid);
          setChecking(false);
        }
        return;
      }

      try {
        const res = await fetchWithTimeout(
          `/api/password-reset/validate?token=${encodeURIComponent(token)}`
        );
        const payload: ValidateResponse = await res.json();
        if (cancelled) return;

        if (payload.success && payload.data) {
          setTokenState(payload.data.state);
          setMaskedEmail(payload.data.maskedEmail ?? null);
        } else {
          setTokenState(ResetTokenState.Invalid);
        }
      } catch {
        if (!cancelled) setTokenState(ResetTokenState.Invalid);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = async (data: ResetPasswordInput) => {
    setServerError(null);
    try {
      const res = await fetchWithTimeout("/api/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password: data.password,
          confirmPassword: data.confirmPassword,
        }),
      });
      const payload: { success: boolean; error?: string } = await res.json();

      if (!res.ok || !payload.success) {
        setServerError(payload.error ?? t("reset.failed"));
        return;
      }

      router.push(`${ROUTES.LOGIN}?notice=password-reset`);
      router.refresh();
    } catch (error) {
      setServerError(
        error instanceof RequestTimeoutError
          ? t("common.timeout")
          : t("common.errorRetry")
      );
    }
  };

  if (checking) {
    return (
      <p className="py-6 text-center text-sm text-slate-500">
        {t("reset.checking")}
      </p>
    );
  }

  if (tokenState !== ResetTokenState.Valid) {
    const copy = DEAD_LINK_COPY[tokenState];
    return (
      <div className="flex flex-col gap-5">
        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          role="alert"
        >
          <p className="font-semibold">{t(copy.title)}</p>
          <p className="mt-1">{t(copy.body)}</p>
        </div>

        <Link href={ROUTES.FORGOT_PASSWORD} className="w-full">
          <Button fullWidth>{t("reset.requestNew")}</Button>
        </Link>

        <p className="text-center text-sm text-slate-400">
          <Link href={ROUTES.LOGIN} className="font-medium text-blue-700 hover:underline">
            {t("forgot.backToLogin")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      {maskedEmail && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {t("reset.forAccount")}{" "}
          <span className="font-medium text-slate-800">{maskedEmail}</span>
        </p>
      )}

      {serverError && (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {serverError}
        </div>
      )}

      <Input
        label={t("password.new")}
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        hint={t("signup.passwordHint")}
        error={localizeValidation(t, errors.password?.message)}
        {...register("password")}
      />

      <Input
        label={t("password.confirmNew")}
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        error={localizeValidation(t, errors.confirmPassword?.message)}
        {...register("confirmPassword")}
      />

      <Button type="submit" fullWidth loading={isSubmitting}>
        {t("password.save")}
      </Button>

      <p className="text-center text-sm text-slate-400">
        <Link href={ROUTES.LOGIN} className="font-medium text-blue-700 hover:underline">
          {t("reset.cancel")}
        </Link>
      </p>
    </form>
  );
}
