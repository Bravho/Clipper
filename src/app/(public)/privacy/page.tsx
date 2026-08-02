import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { ROUTES } from "@/config/routes";

export const metadata: Metadata = {
  title: "Privacy Policy — RClipper",
  description: "How RClipper handles account data, uploaded media, AI processing, connected social accounts, publishing, and retention.",
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
          Version 1.4.0 — Effective 3 August 2026
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
              briefs, uploaded images and videos (including audio contained in those
              videos), user-entered text, place names, addresses, selected map locations or coordinates,
              categories, production choices, approval history, credit and payment
              records, support communications, and technical information needed to
              operate and secure the service. If you use Channel Management, we also
              collect the identifiers and display information for social accounts you
              choose to connect, publication settings, captions, hashtags, and post
              status or error information returned by the social platform. Uploaded
              media and location information may contain personal data about you or
              other identifiable people.
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
              let you organise content and publish it to social accounts you explicitly
              connect, record publication status, moderate content, prevent abuse,
              comply with law, and improve service reliability. We do not sell personal
              data or use connected social-account data for advertising.
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
              providers. When you use Channel Management, RClipper also uses a
              contracted social-publishing provider to connect the accounts you
              authorize and to submit your selected video and post information to the
              chosen social platform. Only data reasonably needed for the relevant
              service should be transmitted. These providers and social platforms may
              process data in other countries under their applicable contractual,
              privacy, and security terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              4. Publishing to accounts you connect
            </h2>
            <p>
              Channel Management does not publish automatically. You must authorize a
              supported social account, select the destination, review the video and
              post information, and confirm the publication. RClipper receives the
              account identifiers, display information, and authorization state needed
              to provide this feature, but does not receive your social-platform
              password. The selected platform may make the video, caption, hashtags,
              account name, and related post information public according to the
              privacy and visibility settings you choose there.
            </p>
            <p>
              You may disconnect an account through Channel Management. Disconnecting
              stops new publications through RClipper but does not remove posts already
              published or records that must be retained for payment, security, audit,
              dispute, or legal purposes. To remove an existing post, use the controls
              provided by the relevant social platform or contact support.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              5. Selected publication through RClipper Channels
            </h2>
            <p>
              Not every generated video is published. RClipper may select a reviewed
              video for public display through the RClipper Channels: the Travy app,
              Travy.buzz website, and official accounts owned or controlled by
              RClipper on Facebook, Instagram, TikTok, YouTube, and Xiaohongshu
              (小红书). Those platform operators may process published content and
              related data under their own privacy policies and terms.
              When selected, the finished video and associated title, caption,
              thumbnail, subtitles, translations, user-entered text, place name,
              address, selected map location, coordinates, category, business or
              attraction information, and personal data visible or audible in the
              video may become publicly accessible. RClipper may present this
              information in a Travy post, place page, listing, search result, map
              marker, or related location feature through the RClipper Channels.
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
              6. Storage and retention
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
              where selected, for the duration of RClipper Channel publication plus reasonable
              backup, audit, legal, and content-integrity retention.
            </p>
            <p>
              Content placed in Channel Management, connected-account records, and
              publication records are retained as needed to operate the feature,
              display history, enforce purchased entitlements, troubleshoot failed
              publications, and meet security, audit, payment, dispute, and legal
              obligations. Media files may be deleted separately under the retention
              period shown in the service even when a publication or purchase record
              must be kept longer.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              7. Security
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
              8. Your choices and rights
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
              <a href="mailto:pillarth@gmail.com" className="text-blue-700 underline">
                pillarth@gmail.com
              </a>
              . Please identify the relevant request or published Travy video.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              9. Changes and contact
            </h2>
            <p>
              We may update this policy to reflect changes in the service or law.
              Material changes to ownership, data use, or publication rights will be
              presented for renewed acceptance where required. Questions may be sent
              to{" "}
              <a href="mailto:pillarth@gmail.com" className="text-blue-700 underline">
                pillarth@gmail.com
              </a>
              .
            </p>
          </section>
        </div>
      </Card>
    </div>
  );
}
