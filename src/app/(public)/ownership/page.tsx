import type { Metadata } from "next";
import Link from "next/link";
import { ROUTES } from "@/config/routes";

export const metadata: Metadata = {
  title: "Ownership and Usage Rights",
  description: "Content Ownership and Usage Rights — see Clipper Privacy Policy.",
};

export default function OwnershipPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <p className="text-sm font-medium text-blue-700">Legal</p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900">
        Ownership and Usage Rights
      </h1>
      <p className="mt-4 text-slate-600 max-w-md mx-auto">
        Our content ownership and usage rights terms are covered in our{" "}
        <Link
          href={ROUTES.PRIVACY}
          className="text-blue-700 font-medium underline hover:text-blue-800"
        >
          Privacy Policy
        </Link>
        , under the &ldquo;Content Ownership and Usage Rights&rdquo; section.
      </p>
      <Link
        href={ROUTES.PRIVACY}
        className="mt-6 inline-block rounded-md bg-blue-700 px-5 py-2 text-sm font-medium text-white hover:bg-blue-800"
      >
        View Privacy Policy &rarr;
      </Link>
    </div>
  );
}
