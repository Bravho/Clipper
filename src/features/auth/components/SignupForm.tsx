"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { signupSchema, SignupInput } from "@/features/auth/validation/signupSchema";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { ROUTES } from "@/config/routes";

export function SignupForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
  });

  const onSubmit = async (data: SignupInput) => {
    setServerError(null);

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        setServerError(result.error ?? "Registration failed. Please try again.");
        return;
      }

      // Auto sign-in after successful registration
      setSuccess(true);
      const signInResult = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (signInResult?.ok) {
        router.push(ROUTES.DASHBOARD);
        router.refresh();
      } else {
        router.push(
          `${ROUTES.LOGIN}?message=Account created. Please sign in.`
        );
      }
    } catch {
      setServerError("An unexpected error occurred. Please try again.");
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

      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Account created! Signing you in&hellip;
        </div>
      )}

      <GoogleSignInButton
        label="Sign up with Google"
        callbackUrl={ROUTES.DASHBOARD}
      />

      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-slate-200" />
        <span className="text-xs text-slate-400">or sign up with email</span>
        <div className="flex-1 border-t border-slate-200" />
      </div>

      <Input
        label="Full name"
        type="text"
        autoComplete="name"
        placeholder="Alex Smith"
        error={errors.name?.message}
        {...register("name")}
      />

      <Input
        label="Email address"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        error={errors.email?.message}
        {...register("email")}
      />

      <Input
        label="Password"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        hint="At least 8 characters with uppercase, lowercase, and a number."
        error={errors.password?.message}
        {...register("password")}
      />

      <Input
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />

      <Button type="submit" fullWidth loading={isSubmitting} size="lg">
        Create my account
      </Button>

      {/* Implicit consent notice */}
      <p className="text-center text-xs text-slate-500 leading-relaxed">
        By clicking &ldquo;Create my account&rdquo; or &ldquo;Sign up with Google&rdquo; you agree to our{" "}
        <Link href={ROUTES.TERMS} className="underline hover:text-slate-700">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href={ROUTES.PRIVACY} className="underline hover:text-slate-700">
          Privacy Policy
        </Link>
        , including our content ownership rights and storage retention terms.
      </p>

      <div className="border-t border-slate-100 pt-2">
        <p className="text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link
            href={ROUTES.LOGIN}
            className="text-blue-700 font-medium hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </form>
  );
}
