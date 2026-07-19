import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "Delete your RClipper account",
  description: "Request deletion of an RClipper account and associated data.",
};

export default function DeleteAccountRequestPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-bold text-slate-900">Delete your account</h1>
      <p className="mt-3 text-slate-600">
        RClipper users can permanently delete their account from the Account
        screen inside the app or website.
      </p>
      <Card className="mt-8">
        <h2 className="font-semibold text-slate-900">Delete while signed in</h2>
        <p className="mt-2 text-sm text-slate-600">
          Open Account, select Delete account, and complete the confirmation.
        </p>
        <Link href="/account" className="mt-4 inline-block text-sm font-medium text-blue-700 underline">
          Open Account settings
        </Link>
      </Card>
      <Card className="mt-4">
        <h2 className="font-semibold text-slate-900">Cannot sign in?</h2>
        <p className="mt-2 text-sm text-slate-600">
          Email support from the address registered to your account using the
          subject “Account deletion request”. We may verify account ownership.
        </p>
        <a href="mailto:support@rclipper.com?subject=Account%20deletion%20request" className="mt-4 inline-block text-sm font-medium text-blue-700 underline">
          support@rclipper.com
        </a>
      </Card>
      <p className="mt-6 text-sm text-slate-500">
        Login identities and personal profile data are removed or anonymized.
        Limited payment, consent, security, fraud-prevention, dispute, or legal
        records may be retained where required, as described in the Privacy Policy.
      </p>
    </div>
  );
}

