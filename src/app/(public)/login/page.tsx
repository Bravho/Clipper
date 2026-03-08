import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { redirect } from "next/navigation";
import { getRoleHomePath, ROUTES } from "@/config/routes";
import { Role } from "@/domain/enums/Role";
import { LoginForm } from "@/features/auth/components/LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Clipper account.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { message?: string };
}) {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(getRoleHomePath(session.user.role as Role));
  }

  return (
    <div className="flex min-h-[calc(100vh-128px)] items-center justify-center px-4 py-12">
      <div className="auth-card">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-500">
            Sign in with the same account you used to register.
          </p>
        </div>

        {searchParams?.message && (
          <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            {searchParams.message}
          </div>
        )}

        <LoginForm />

        <div className="mt-6 border-t border-slate-200 pt-4">
          <p className="text-center text-xs text-slate-400">
            By signing in, you agree to our{" "}
            <a href={ROUTES.TERMS} className="underline hover:text-slate-600">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href={ROUTES.PRIVACY} className="underline hover:text-slate-600">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
