"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ROUTES } from "@/config/routes";

export default function VerifyEmailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const initialDeliveryFailed = searchParams.get("delivery") === "failed";
  const existingAccount = searchParams.get("existing") === "1";

  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [resendError, setResendError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifyState, setVerifyState] = useState<"idle" | "verifying" | "error">("idle");
  const [verifyError, setVerifyError] = useState<string | null>(null);

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setVerifyError("Enter the six-digit code from your email.");
      return;
    }

    setVerifyState("verifying");
    setVerifyError(null);
    try {
      const res = await fetch("/api/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyError(data.error ?? "Verification failed.");
        setVerifyState("error");
        return;
      }
      router.push(
        `${ROUTES.LOGIN}?message=${encodeURIComponent(
          "Email verified! You can now sign in."
        )}`
      );
    } catch {
      setVerifyError("An unexpected error occurred. Please try again.");
      setVerifyState("error");
    }
  }

  async function handleResend() {
    setResendState("sending");
    setResendError(null);

    try {
      const res = await fetch("/api/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        setResendError(data.error ?? "Failed to resend. Please try again.");
        setResendState("error");
      } else {
        setResendState("sent");
      }
    } catch {
      setResendError("An unexpected error occurred.");
      setResendState("error");
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-128px)] items-center justify-center px-4 py-12">
      <div className="auth-card text-center">
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
          <svg className="h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0l-9.75 6.75L2.25 6.75" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-slate-900">Check your inbox</h1>
        <p className="mt-3 text-sm text-slate-500 leading-relaxed">
          {existingAccount
            ? "An account with this email already exists but may still need verification: "
            : initialDeliveryFailed
            ? "Your account was created, but we could not send the verification email to "
            : "We sent a six-digit verification code to "}
          {email ? (
            <span className="font-medium text-slate-700">{email}</span>
          ) : (
            "your email address"
          )}
          .<br />
          {existingAccount
            ? "Use the button below to send a fresh verification link, or sign in if you have already verified it."
            : initialDeliveryFailed
            ? "Use the button below to try sending it again."
            : "Enter the code below to activate your account."}
        </p>

        <p className="mt-2 text-xs text-slate-400">
          The code expires in 10 minutes.
        </p>

        <form onSubmit={handleVerify} className="mt-6">
          <label htmlFor="verification-code" className="sr-only">
            Six-digit verification code
          </label>
          <input
            id="verification-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="000000"
            className="w-full rounded-md border border-slate-300 px-4 py-3 text-center text-2xl font-semibold tracking-[0.5em] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          {verifyError && (
            <p className="mt-2 text-sm text-red-600">{verifyError}</p>
          )}
          <div className="mt-4">
            <Button
              type="submit"
              fullWidth
              loading={verifyState === "verifying"}
              disabled={!email || code.length !== 6}
            >
              Verify email
            </Button>
          </div>
        </form>

        <div className="mt-8 border-t border-slate-100 pt-6">
          {resendState === "sent" ? (
            <p className="text-sm text-green-700 font-medium">
              A new verification code was sent. Check your inbox.
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-500 mb-3">
                Didn&rsquo;t receive it? Check your spam folder, or:
              </p>
              {resendError && (
                <p className="mb-3 text-sm text-red-600">{resendError}</p>
              )}
              <Button
                variant="outline"
                fullWidth
                loading={resendState === "sending"}
                onClick={handleResend}
                disabled={!email}
              >
                Resend verification code
              </Button>
            </>
          )}
        </div>

        <p className="mt-4 text-sm text-slate-400">
          Already verified?{" "}
          <Link href={ROUTES.LOGIN} className="text-blue-700 font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
