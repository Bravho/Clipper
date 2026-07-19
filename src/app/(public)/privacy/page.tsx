import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { ROUTES } from "@/config/routes";

export const metadata: Metadata = {
  title: "Privacy Policy — RClipper",
  description: "How RClipper handles account data, uploaded media, AI processing, retention, and selected Travy publication.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="mb-8">
        <p className="text-sm font-medium text-blue-700">Legal</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">
          RClipper Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Version 1.2.1 — Effective 19 July 2026
        </p>
      </div>

      <Card>
        <div className="prose prose-slate max-w-none space-y-7 text-sm leading-relaxed text-slate-700">
          <section>
            <h2 className="text-base font-semibold text-slate-900">
              1. Data we collect
            </h2>
            <p>
              RClipper collects account and authentication information, request
              briefs, uploaded images and videos, voice recordings, user-entered
              text, place names, addresses, selected map locations or coordinates,
              categories, production choices, approval history, credit and payment
              records, support communications, and technical information needed to
              operate and secure the service. Uploaded media and location information
              may contain personal data about you or other identifiable people.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              2. How we use data
            </h2>
            <p>
              We use this data to register and secure accounts, process and deliver
              video requests, generate scripts, audio, subtitles, translations and
              video outputs, administer credits and payments, provide support,
              moderate content, prevent abuse, comply with law, and improve service
              reliability. We do not sell personal data.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              3. AI and service providers
            </h2>
            <p>
              RClipper may transmit the request information and media required for a
              production step to contracted hosting, storage, authentication,
              payment, email, AI, voice, video-generation, and media-processing
              providers. Only data reasonably needed for the relevant service should
              be transmitted. These providers may process data in other countries
              under their applicable contractual and security protections.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              4. Selected Travy publication
            </h2>
            <p>
              Not every generated video is published through Travy. RClipper may
              select a reviewed video for public display in the Travy app and on the
              Travy.buzz website.
              When selected, the finished video and associated title, caption,
              thumbnail, subtitles, translations, user-entered text, place name,
              address, selected map location, coordinates, category, business or
              attraction information, and personal data visible or audible in the
              video may become publicly accessible. RClipper may present this
              information in a Travy post, place page, listing, search result, map
              marker, or related location feature in the Travy app or on Travy.buzz.
              Public viewers may copy or share
              content outside RClipper&apos;s control.
            </p>
            <p>
              The request form gives a just-in-time notice and requires confirmation
              that the requester has the necessary rights and accepts the applicable
              publication terms. Full licence terms are in the{" "}
              <Link href={ROUTES.OWNERSHIP} className="text-blue-700 underline">
                Content Ownership and Publication Rights Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              5. Storage and retention
            </h2>
            <p>
              Raw source uploads are associated with the request for which they were
              supplied and are ordinarily scheduled for deletion 90 days after
              upload, subject to active production, security, legal, dispute, backup,
              and technical requirements. Production records, approval evidence,
              credit records, and policy-acceptance records may be retained for as
              long as reasonably necessary to operate the service and establish the
              parties&apos; rights.
            </p>
            <p>
              Finished videos may be retained for delivery, quality assurance, and,
              where selected, for the duration of Travy publication plus reasonable
              backup, audit, legal, and content-integrity retention.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              6. Security
            </h2>
            <p>
              RClipper uses administrative, technical, and organisational safeguards
              designed to protect data, including access controls and encrypted
              network transmission where supported. No online service can guarantee
              absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              7. Your choices and rights
            </h2>
            <p>
              Subject to applicable law, you may request access, correction,
              deletion, restriction, objection, withdrawal of consent where consent
              is the legal basis, or information about the handling of your personal
              data. Account deletion is available through the service where provided
              or by contacting support. Some records may be retained where required
              for legal, payment, security, fraud-prevention, or dispute purposes.
            </p>
            <p>
              You may also use the{" "}
              <Link href="/delete-account" className="text-blue-700 underline">
                public account deletion request page
              </Link>
              .
            </p>
            <p>
              Privacy, rights, content-reporting, and removal requests may be sent to{" "}
              <a href="mailto:support@rclipper.com" className="text-blue-700 underline">
                support@rclipper.com
              </a>
              . Please identify the relevant request or published Travy video.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              8. Changes and contact
            </h2>
            <p>
              We may update this policy to reflect changes in the service or law.
              Material changes to ownership, data use, or publication rights will be
              presented for renewed acceptance where required. Questions may be sent
              to{" "}
              <a href="mailto:support@rclipper.com" className="text-blue-700 underline">
                support@rclipper.com
              </a>
              .
            </p>
          </section>
        </div>
      </Card>
    </div>
  );
}
