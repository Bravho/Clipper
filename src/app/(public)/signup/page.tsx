import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { redirect } from "next/navigation";
import { getRoleHomePath, ROUTES } from "@/config/routes";
import { Role } from "@/domain/enums/Role";
import { SignupForm } from "@/features/auth/components/SignupForm";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create your free Clipper account and start with 30 free credits.",
};

export default async function SignupPage() {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(getRoleHomePath(session.user.role as Role));
  }

  return (
    <div className="flex min-h-[calc(100vh-128px)] items-center justify-center px-4 py-12">
      <div className="auth-card">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">
            Create your Clipper account
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Sign up with Google or email. New accounts receive{" "}
            <span className="font-semibold text-blue-700">30 free credits</span>.
          </p>
        </div>

        <SignupForm />
      </div>
    </div>
  );
}
