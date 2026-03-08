import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Clipper Platform Privacy Policy — including content ownership rights and storage retention terms.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="mb-8">
        <p className="text-sm font-medium text-blue-700">Legal</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500">
          Version 1.0.0 — Effective January 1, 2024
        </p>
        <p className="mt-1 text-xs text-slate-400">
          This policy covers privacy, content ownership and usage rights, and
          storage and retention practices.
        </p>
      </div>

      <Card>
        <div className="prose prose-slate max-w-none space-y-8 text-sm text-slate-700 leading-relaxed">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-xs">
            <strong>Placeholder:</strong> Full policy language will be finalised before public launch.
          </div>

          {/* ---- Privacy -------------------------------------------------- */}
          <section>
            <h2 className="text-base font-semibold text-slate-900">
              1. Information We Collect
            </h2>
            <p>
              We collect your name and email address when you register. If you
              sign in with Google, we receive your name and email from Google.
              We do not collect your company name, phone number, or social media
              handles.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              2. How We Use Your Information
            </h2>
            <p>
              We use your information to operate the platform, process your clip
              requests, communicate with you about your requests, and meet our
              legal obligations. We do not sell your personal data.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              3. Third-Party Services
            </h2>
            <p>
              We use Google OAuth for authentication (if you choose this option).
              We publish clips to third-party platforms — TikTok, Facebook,
              Instagram, YouTube — as directed by you. Each of these platforms
              has its own privacy policy and data practices.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              4. Your Rights
            </h2>
            <p>
              You may request deletion of your account and associated personal
              data at any time by contacting us through the platform. Source
              files you upload are deleted automatically per the retention terms
              below.
            </p>
          </section>

          {/* ---- Ownership ------------------------------------------------ */}
          <div className="border-t border-slate-100 pt-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Content Ownership and Usage Rights
            </h2>
          </div>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              5. Ownership of Final Output
            </h2>
            <p>
              The final edited video clip produced by Clipper&rsquo;s team is
              owned by the platform operator (Clipper). You do not own the
              edited clip.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              6. Your Reshare License
            </h2>
            <p>
              Upon delivery, you are granted a non-exclusive, royalty-free
              license to reshare and redistribute the final clip on your own
              channels — including social media, your website, and messaging
              platforms. You may not sell or sublicense the clip to any third
              party.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              7. Source Material Rights
            </h2>
            <p>
              By uploading source videos and images, you confirm that you own
              or have obtained all necessary rights to use those materials. You
              grant Clipper a limited, non-exclusive license to use those
              materials solely for producing your requested clip. This license
              ends when your source files are deleted.
            </p>
          </section>

          {/* ---- Storage -------------------------------------------------- */}
          <div className="border-t border-slate-100 pt-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Storage and Retention
            </h2>
          </div>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              8. Source File Retention
            </h2>
            <p>
              Source files you upload for clip production are stored in our
              cloud infrastructure (DigitalOcean Spaces) and are automatically
              and permanently deleted after <strong>90 days</strong> from the
              date of upload. Clipper does not maintain a permanent asset
              library of your raw uploads.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              9. Final Clip Retention
            </h2>
            <p>
              Completed and published clips remain accessible via their
              delivery links for as long as the platform is active, unless
              removed at the platform's discretion or upon your request.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              10. Account Data Retention
            </h2>
            <p>
              Your account data (name, email, credit history, request history)
              is retained for as long as your account is active. If you delete
              your account, personal data is removed within 30 days, subject to
              legal obligations.
            </p>
          </section>

          {/* ---- Contact -------------------------------------------------- */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500">
              For any questions about this policy, please contact us through the
              platform.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
