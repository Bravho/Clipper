"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages";
import type { CreatorCampaignStatus } from "@/services/campaigns/CampaignCreatorService";
import {
  CampaignApiError,
  sendPhoneCode,
  verifyPhoneCode,
  type PhoneCodeSent,
} from "@/features/campaigns/campaignClient";

/**
 * "Verify your phone" — asked once per installation, before the video.
 *
 * Why: the creator's referral code is registered at iTravy together with this
 * phone, and iTravy refuses a redemption whose verified phone is the
 * creator's. So the code works for friends, not for the creator.
 *
 * Phone → Send code → 6 digits → Verify. If iTravy cannot be reached the code
 * is not used up; the creator just taps Verify again.
 */

const ERROR_KEYS: Record<string, MessageKey> = {
  phone_invalid: "campaign.phone.err.phone_invalid",
  otp_invalid: "campaign.phone.err.otp_invalid",
  otp_expired: "campaign.phone.err.otp_expired",
  otp_locked: "campaign.phone.err.otp_locked",
  otp_not_found: "campaign.phone.err.otp_expired",
  otp_cooldown: "campaign.phone.err.otp_cooldown",
  rate_limited: "campaign.phone.err.rate_limited",
  sms_failed: "campaign.phone.err.sms_failed",
  otp_unavailable: "campaign.phone.err.sms_failed",
  itravy_failed: "campaign.phone.err.itravy_failed",
};

export function PhoneVerifyStep({
  slug,
  qrKey,
  status,
  disabled,
  onVerified,
}: {
  slug: string;
  qrKey: string;
  status: CreatorCampaignStatus;
  disabled?: boolean;
  onVerified: (status: CreatorCampaignStatus) => void;
}) {
  const { t, locale } = useI18n();
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState<PhoneCodeSent | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  if (status.phone.ok) {
    if (!status.phone.last4) return null; // not required here
    return (
      <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        {t("campaign.phone.verified", { last4: status.phone.last4 })}
      </p>
    );
  }

  const explain = (e: unknown) => {
    if (e instanceof CampaignApiError) {
      const key = ERROR_KEYS[e.code];
      const seconds = Number(e.details.retryAfterSeconds ?? 0);
      const left = Number(e.details.attemptsLeft ?? 0);
      if (key) return t(key, { seconds, left });
      return e.message;
    }
    return t("campaign.error.generic");
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await sendPhoneCode(slug, qrKey, phone, locale);
      setSent(result);
      setCode("");
      setResendIn(result.resendAfterSeconds);
    } catch (e) {
      setError(explain(e));
      if (e instanceof CampaignApiError && e.code === "otp_cooldown") {
        setResendIn(Number(e.details.retryAfterSeconds ?? 60));
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!sent) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyPhoneCode(slug, qrKey, { challengeId: sent.challengeId, code, phone });
      onVerified(result.status);
    } catch (e) {
      setError(explain(e));
      if (e instanceof CampaignApiError && ["otp_expired", "otp_locked", "otp_not_found"].includes(e.code)) {
        setSent(null);
        setCode("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4">
      <h2 className="text-base font-bold text-slate-900">{t("campaign.step.phone")}</h2>
      <p className="mt-1 text-sm text-slate-600">{t("campaign.phone.hint")}</p>

      {!sent ? (
        <div className="mt-3 flex gap-2">
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("campaign.phone.placeholder")}
            aria-label={t("campaign.phone.label")}
            disabled={disabled || busy}
            className="min-h-[48px] min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-base"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={disabled || busy || phone.trim().length < 9 || resendIn > 0}
            className="min-h-[48px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            {resendIn > 0 ? t("campaign.phone.resendIn", { seconds: resendIn }) : t("campaign.phone.send")}
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm text-slate-700">{t("campaign.phone.sent", { phone: sent.maskedPhone })}</p>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              aria-label={t("campaign.phone.codeLabel")}
              disabled={disabled || busy}
              className="min-h-[48px] w-36 rounded-lg border border-slate-300 bg-white px-3 text-center font-mono text-xl tracking-[0.3em]"
            />
            <button
              type="button"
              onClick={() => void verify()}
              disabled={disabled || busy || code.length !== 6}
              className="min-h-[48px] flex-1 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              {t("campaign.phone.verify")}
            </button>
          </div>
          <div className="flex gap-4 text-sm">
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || resendIn > 0}
              className="font-medium text-blue-700 disabled:text-slate-400"
            >
              {resendIn > 0 ? t("campaign.phone.resendIn", { seconds: resendIn }) : t("campaign.phone.resend")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSent(null);
                setCode("");
                setError(null);
              }}
              className="font-medium text-slate-600"
            >
              {t("campaign.phone.change")}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
