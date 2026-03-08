"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ROUTES } from "@/config/routes";

type State = "verifying" | "success" | "error";

export default function VerifyEmailConfirmPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [state, setState] = useState<State>("verifying");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("No verification token provided.");
      setState("error");
      return;
    }

    fetch("/api/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setState("success");
          // Redirect to login after a short delay so the user sees the success message
          setTimeout(() => {
            router.push(`${ROUTES.LOGIN}?message=Email verified! You can now sign in.`);
          }, 2500);
        } else {
          setError(data.error ?? "Verification failed.");
          setState("error");
        }
      })
      .catch(() => {
        setError("An unexpected error occurred. Please try again.");
        setState("error");
      });
  }, [token, router]);

  return (
    <div className="flex min-h-[calc(100vh-128px)] items-center justify-center px-4 py-12">
      <div className="auth-card text-center">
        {state === "verifying" && (
          <>
            <div className="mx-auto mb-6 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
            <p className="text-slate-600">Verifying your email address&hellip;</p>
          </>
        )}

        {state === "success" && (
          <>
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
              <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Email verified!</h1>
            <p className="mt-2 text-sm text-slate-500">
              Your account is now active. Redirecting you to sign in&hellip;
            </p>
          </>
        )}

        {state === "error" && (
          <>
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
              <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Verification failed</h1>
            <p className="mt-2 text-sm text-slate-500">{error}</p>
            <div className="mt-6 flex flex-col gap-2">
              <Link
                href={ROUTES.VERIFY_EMAIL}
                className="text-sm text-blue-700 font-medium hover:underline"
              >
                Request a new verification email
              </Link>
              <Link
                href={ROUTES.LOGIN}
                className="text-sm text-slate-500 hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
