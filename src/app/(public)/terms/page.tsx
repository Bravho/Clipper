import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { ROUTES } from "@/config/routes";

export const metadata: Metadata = {
  title: "Terms and Conditions — RClipper",
  description: "RClipper Terms and Conditions — Version 1.2.1",
};

const EFFECTIVE_DATE = "19 July 2026";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="mb-8">
        <p className="text-sm font-medium text-blue-700">Legal</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">
          RClipper Terms and Conditions
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Version 1.2.1 — Effective {EFFECTIVE_DATE}
        </p>
      </div>

      <Card>
        <div className="prose prose-slate max-w-none space-y-7 text-sm leading-relaxed text-slate-700">
          <section>
            <h2 className="text-base font-semibold text-slate-900">1. The service</h2>
            <p>
              RClipper is a managed short-video production service. A requester
              submits a brief and source materials, reviews production stages, and
              receives a finished video subject to these Terms. RClipper may reject
              or stop a request that is unlawful, unsafe, technically unsuitable, or
              inconsistent with these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              2. Trial video and credits
            </h2>
            <p>
              If the interface identifies a request as an eligible free trial,
              creating and previewing its watermarked video does not consume credits.
              Downloading the unwatermarked version costs the number of credits shown
              beside the request confirmation and download control (currently 49
              credits). For a non-trial request, the applicable credit charge and
              charging point are shown before submission. Credits are personal,
              non-transferable, and have no cash value except where applicable law
              requires otherwise.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              3. Your uploaded materials
            </h2>
            <p>
              You must own or have all licences, releases, consents, and permissions
              needed for every uploaded image, video, recording, voice, performance,
              song, logo, trademark, text, place name, selected location, and
              identifiable person. Information entered in a request, including a
              title, description, address, map point, category, or other place
              information, is treated as request content. You must not
              submit material that infringes another person&apos;s rights, is unlawful,
              deceptive, defamatory, abusive, or otherwise prohibited by RClipper.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              4. Ownership and licences
            </h2>
            <p>
              You retain ownership of your original uploaded materials. RClipper owns
              the original editing, arrangement, graphics, captions, translations,
              and other production elements it creates, subject to rights in the
              underlying materials. Your licence to use a delivered video and
              RClipper&apos;s licence to use uploaded materials are described in the{" "}
              <Link href={ROUTES.OWNERSHIP} className="text-blue-700 underline">
                Content Ownership and Publication Rights Policy
              </Link>
              , which forms part of these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              5. Selection for Travy
            </h2>
            <p>
              Not every generated video is published through Travy. RClipper may
              select certain reviewed videos for public publication on the Travy app
              and Travy.buzz website under an RClipper or Travy-controlled account. Selection is
              discretionary, is not guaranteed, and does not entitle the requester to
              payment, promotion, audience size, or a minimum publication period.
            </p>
            <p>
              By confirming the content-rights checkbox for a request, you authorise
              RClipper to use the uploaded materials and request content for this
              selected Travy publication. This includes text, place names, addresses,
              selected map locations, coordinates, categories, descriptions, and
              business or attraction information, whether or not each item appears
              inside the finished video. RClipper may display this information in a
              Travy post, place page, listing, caption, search result, map marker, or
              related location feature in the Travy app or on Travy.buzz, and may prepare subtitles, translations,
              thumbnails, crops, and technical formats reasonably required for Travy.
              This permission does not
              authorise unrelated advertising or publication on other third-party
              social networks unless separately disclosed and authorised.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              6. Review, moderation, and removal
            </h2>
            <p>
              RClipper may review, decline, unpublish, or remove content at any time
              for quality, safety, legal, operational, or policy reasons. Requests to
              report rights violations, privacy concerns, or objectionable content
              may be sent to{" "}
              <a href="mailto:support@rclipper.com" className="text-blue-700 underline">
                support@rclipper.com
              </a>
              . A removal request will be assessed under applicable law and the
              rights of affected people; ownership of RClipper&apos;s production
              elements does not override applicable privacy or third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              7. Service availability and liability
            </h2>
            <p>
              Production estimates are targets rather than guarantees. To the extent
              permitted by law, RClipper is not responsible for delays or failures
              caused by incomplete materials, third-party providers, platform
              outages, force majeure, or the requester&apos;s lack of necessary
              rights. Nothing in these Terms excludes rights or remedies that cannot
              lawfully be excluded.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              8. Privacy, changes, and contact
            </h2>
            <p>
              The{" "}
              <Link href={ROUTES.PRIVACY} className="text-blue-700 underline">
                Privacy Policy
              </Link>{" "}
              explains how RClipper handles personal data, media, retention, AI
              providers, and Travy publication. Material changes to ownership or
              publication rights will be presented for renewed acceptance where
              required. Questions may be sent to{" "}
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
