import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { ROUTES } from "@/config/routes";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Legal & Policy — RClipper" };

export default async function LegalPage() {
  await requireRole(Role.Requester);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-slate-500">
        <Link href={ROUTES.DASHBOARD} className="hover:text-slate-700">
          Dashboard
        </Link>
        <span>/</span>
        <span className="font-medium text-slate-700">Legal & Policy</span>
      </nav>

      <h1 className="mb-2 text-2xl font-bold text-slate-900">Legal & Policy</h1>
      <p className="mb-8 text-sm text-slate-500">
        A summary of the key policies that govern your use of the RClipper platform.
        By using this platform you agree to these terms.
      </p>

      {/* Terms of Service */}
      <PolicySection
        title="Terms of Service"
        items={[
          "RClipper is a managed short-video production and distribution service.",
          "You may use the platform to submit clip requests and receive delivered content.",
          "Your account, credits, and requests are personal and non-transferable.",
          "We reserve the right to reject any request that violates these terms.",
          "Service timelines are targets, not guarantees. Our standard aim is to complete accepted requests within 2 working days of receiving complete and usable materials.",
          "We do not offer refunds on credits used for rejected requests unless the rejection was due to an error on our part.",
        ]}
      />

      {/* Ownership & Usage Rights */}
      <PolicySection
        title="Ownership & Usage Rights"
        items={[
          "The final edited clip produced for each request is the intellectual property of RClipper.",
          "You are granted a free, non-exclusive licence to repost and share the delivered clip on your own channels (e.g. your social media accounts, website).",
          "You may NOT resell, redistribute, or relicence the final clip to third parties.",
          "Uploaded source materials remain your property. You grant us a limited licence to use them solely for the purpose of fulfilling your clip request.",
          "By uploading materials, you confirm you have the rights to do so and that the materials do not infringe any third-party rights.",
        ]}
      />

      {/* Privacy Policy */}
      <PolicySection
        title="Privacy Policy"
        items={[
          "We collect your name and email address at signup. We do not collect company names, phone numbers, or social media handles.",
          "Your data is used only to provide and improve the RClipper service.",
          "We do not sell your personal data to third parties.",
          "Your request briefs and uploaded materials are handled confidentially within our production team.",
          "You may request deletion of your account and associated data by contacting support.",
        ]}
      />

      {/* Storage & Retention */}
      <PolicySection
        title="Storage & Retention Policy"
        items={[
          "Uploaded source files (videos and images) are stored only for the purpose of fulfilling your request.",
          "Source files are NOT maintained as a reusable asset library — they are tied to the specific request they were uploaded for.",
          "Raw uploads are scheduled for deletion 90 days after the request is submitted.",
          "Final delivered clips may be retained by RClipper for portfolio and quality assurance purposes.",
          "If you wish to have your source files removed sooner, please contact our support team.",
        ]}
      />

      {/* Contact */}
      <Card className="mt-4">
        <p className="text-sm text-slate-600">
          Have questions about our policies?{" "}
          <a
            href="mailto:support@rclipper.com"
            className="text-blue-600 hover:underline"
          >
            Contact our support team
          </a>
          .
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Last updated: March 2026. These policies may be updated from time to time.
          Continued use of the platform constitutes acceptance of the current version.
        </p>
      </Card>
    </div>
  );
}

function PolicySection({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <Card className="mb-5">
      <h2 className="mb-4 text-base font-semibold text-slate-900">{title}</h2>
      <ul className="flex flex-col gap-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-slate-400 flex-shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </Card>
  );
}
