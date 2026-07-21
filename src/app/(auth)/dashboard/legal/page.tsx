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
        A summary of the key policies that govern your use of RClipper. Please review
        the complete public policies linked below.
      </p>

      {/* Terms of Service */}
      <PolicySection
        title="Terms of Service"
        items={[
          "RClipper is a managed short-video production and distribution service.",
          "You may use the platform to submit clip requests and receive delivered content.",
          "Eligible first trial videos are free to generate and preview with a watermark; downloading the unwatermarked version currently costs 49 credits.",
          "Your account, credits, and requests are personal and non-transferable.",
          "We reserve the right to reject any request that violates these terms.",
          "Service timelines are targets, not guarantees. Our standard aim is to complete accepted requests within 2 working days of receiving complete and usable materials.",
          "Not every generated video is published. RClipper may select certain reviewed videos for public publication through the Travy app, Travy.buzz, and RClipper-owned or controlled Facebook, Instagram, TikTok, YouTube, and Xiaohongshu (小红书) accounts.",
        ]}
      />

      {/* Ownership & Usage Rights */}
      <PolicySection
        title="Ownership & Usage Rights"
        items={[
          "RClipper owns the original editing, arrangement, graphics, captions, translations, and other production elements it creates, subject to underlying source-material rights.",
          "You are granted a free, non-exclusive licence to repost and share the delivered clip on your own channels (e.g. your social media accounts, website).",
          "You may NOT resell, redistribute, or relicence the final clip to third parties.",
          "Uploaded source materials remain your property. You grant RClipper the licences needed to produce the request and, if selected, publish the materials and related request text, place names, and selected locations through the defined RClipper Channels.",
          "By uploading materials, you confirm that you own or have all necessary licences, releases, consents, and permissions.",
        ]}
      />

      {/* Privacy Policy */}
      <PolicySection
        title="Privacy Policy"
        items={[
          "We collect account information, request briefs, uploaded media, production choices, approval history, and credit/payment records needed to provide the service.",
          "Required request data and media may be processed by contracted hosting, storage, authentication, payment, AI, voice, video-generation, and media-processing providers.",
          "We do not sell your personal data to third parties.",
          "A selected video, together with its title, caption, hashtags, thumbnail, subtitles, user-entered text, place names, selected map locations, and visible or audible information, may become publicly accessible through the defined RClipper Channels.",
          "You may exercise applicable data rights or submit a privacy, content-reporting, or removal request by contacting support.",
        ]}
      />

      {/* Storage & Retention */}
      <PolicySection
        title="Storage & Retention Policy"
        items={[
          "Uploaded source files (videos and images) are stored only for the purpose of fulfilling your request.",
          "Source files are NOT maintained as a reusable asset library — they are tied to the specific request they were uploaded for.",
          "Raw uploads are scheduled for deletion 90 days after the request is submitted.",
          "Finished videos may be retained for delivery and quality assurance and, if selected, for Travy publication plus reasonable backup, audit, and legal retention.",
          "If you wish to have your source files removed sooner, please contact our support team.",
        ]}
      />

      <Card className="mb-5">
        <h2 className="mb-3 text-base font-semibold text-slate-900">Complete policies</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={ROUTES.TERMS} className="text-blue-700 underline">
            Terms and Conditions
          </Link>
          <Link href={ROUTES.OWNERSHIP} className="text-blue-700 underline">
            Content Ownership and Publication Rights
          </Link>
          <Link href={ROUTES.PRIVACY} className="text-blue-700 underline">
            Privacy Policy
          </Link>
        </div>
      </Card>

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
          Last updated: 22 July 2026. Material changes will be presented for renewed
          acceptance where required.
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
