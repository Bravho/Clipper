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
import { GoogleSignInButton } from "./GoogleSignInButton";
import { getRoleHomePath } from "@/config/routes";
import { Role } from "@/domain/enums/Role";
import { ROUTES } from "@/config/routes";

export function LoginForm() {
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
        setServerError(
          "Please verify your email before signing in. Check your inbox for the verification link."
        );
        return;
      }

      if (result?.error) {
        setServerError("Invalid email or password. Please try again.");
        return;
      }

      if (result?.ok) {
        // Fetch session to get role for redirect
        const session = await getSession();
        const role = session?.user?.role as Role | undefined;
        const destination = role ? getRoleHomePath(role) : ROUTES.DASHBOARD;
        router.push(destination);
        router.refresh();
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
        autoComplete="current-password"
        placeholder="••••••••"
        error={errors.password?.message}
        {...register("password")}
      />

      <Button type="submit" fullWidth loading={isSubmitting}>
        Sign in
      </Button>

      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-slate-200" />
        <span className="text-xs text-slate-400">or</span>
        <div className="flex-1 border-t border-slate-200" />
      </div>

      <GoogleSignInButton label="Sign in with Google" />

      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-slate-200" />
        <span className="text-xs text-slate-400">new here?</span>
        <div className="flex-1 border-t border-slate-200" />
      </div>

      <Link href={ROUTES.SIGNUP} className="w-full">
        <Button variant="outline" fullWidth>
          Create a free account
        </Button>
      </Link>
    </form>
  );
}
