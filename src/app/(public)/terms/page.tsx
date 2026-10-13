import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { ROUTES } from "@/config/routes";
import { FREE_FACTS, perVideoLimits, tierFacts } from "@/config/planLimits";
import { VOICE_MAKE_TOP_UP } from "@/config/requestLimits";
import { MANAGEMENT_UPLOAD_KEEP_LIMIT } from "@/services/management/ManagementUploadService";

export const metadata: Metadata = {
  title: "Terms and Conditions — RClipper",
  description: "RClipper Terms and Conditions — Version 1.6.0",
};

const EFFECTIVE_DATE = "13 October 2026";

export default function TermsPage() {
  // Every number below is read from the configuration that enforces it, so
  // these Terms cannot promise more (or less) than the service does.
  const starter = tierFacts("starter");
  const pro = tierFacts("pro");
  const limits = perVideoLimits();
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="mb-8">
        <p className="text-sm font-medium text-blue-700">Legal</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">
          RClipper Terms and Conditions
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Version 1.6.0 — Effective {EFFECTIVE_DATE}
        </p>
      </div>

      <Card>
        <div className="prose prose-slate max-w-none space-y-7 text-sm leading-relaxed text-slate-700">
          <section>
            <h2 className="text-base font-semibold text-slate-900">1. The service</h2>
            <p>
              RClipper is a short-video production service. In the RClipper mobile
              app, a requester writes a brief and picks photos and clips; RClipper
              writes the storyboard, script and voice-over, and the video is made on
              the requester&apos;s phone. The requester reviews each stage and receives
              the finished video subject to these Terms. RClipper also offers
              Channel Management, which lets a requester publish videos to social
              accounts they connect. RClipper may reject or stop a request that is
              unlawful, unsafe, technically unsuitable, or inconsistent with these
              Terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              2. Eligibility and minors
            </h2>
            <p>
              You must be at least 13 years old to use RClipper. If you are under
              the age of legal majority where you live, you may use the service
              only with permission from a parent or legal guardian, including
              permission for purchases and submission of media. A parent or legal
              guardian who permits a minor to use RClipper is responsible for that
              minor&apos;s use of the service and compliance with these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              3. Free videos
            </h2>
            <p>
              Each person may make {FREE_FACTS.videos} videos free of charge in
              total. This allowance does not renew, and it belongs to the person
              rather than to the account: if an account is deleted and a new one is
              created with the same email address or sign-in, the free videos
              already used carry over.
            </p>
            <p>
              A free video can be watched in the RClipper app only. It cannot be
              downloaded or sent to Channel Management unless a package is bought.
              A free video is kept for {FREE_FACTS.freeDays} days after it is
              finished; the date is shown on the video. If a package is bought
              within that time, every free video made before the purchase that has
              not yet expired becomes downloadable and is kept for {FREE_FACTS.days}{" "}
              days from the date of purchase. A free video that has expired is
              deleted and cannot be restored by a later purchase.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              4. Packages and credits
            </h2>
            <p>
              Packages are bought with RClipper credits and last 1, 3, 6 or 12
              months. Every package includes video making and Channel Management for
              its whole term. A Starter package includes {starter.videosPerMonth}{" "}
              videos per month and a Pro package {pro.videosPerMonth} videos per
              month. Current prices are shown on the{" "}
              <Link href={ROUTES.PUBLIC_PRICING} className="text-blue-700 underline">
                plans page
              </Link>{" "}
              and in the app before you buy.
            </p>
            <p>
              A package is a one-time, prepaid purchase. It does not renew
              automatically and nothing is charged again when it ends. Each month of
              a package is a separate allowance: videos not used in a month do not
              carry over to the next. Buying a package while another is active adds
              the new time after the current one, so paid time is never lost. When a
              package&apos;s videos for the current month are used up, a further
              request uses the free allowance, if any remains, and is treated as a
              free video under section 3.
            </p>
            <p>
              Each video may use up to {limits.voiceMakes} voice-over generations;
              more can be bought for that video ({VOICE_MAKE_TOP_UP.makes} for{" "}
              {VOICE_MAKE_TOP_UP.priceCredits} credits). A video may be up to{" "}
              {limits.maxSeconds} seconds long, use up to {limits.maxItems} photos
              and clips, and be made in up to {limits.shapes} channel shapes. Once a
              production step is approved it cannot be reopened or regenerated. If
              the production of a package video fails, that video is returned to the
              package&apos;s allowance.
            </p>
            <p>
              Credits are bought on the RClipper website or through the App Store or
              Google Play; the price of a credit may differ between them, but a
              package costs the same number of credits everywhere. Credits are
              personal, non-transferable, have no cash value, and credits spent on a
              package cannot be refunded, except where applicable law requires
              otherwise. Credits remaining when an account is deleted are cancelled.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              5. How long videos are kept
            </h2>
            <p>
              RClipper keeps each finished video for a limited time: a video made
              under a package for {FREE_FACTS.days} days after it is finished, and a
              free video as set out in section 3. The date is shown on every video,
              in the studio and in Channel Management. Until that date the video can
              be downloaded (where section 3 allows) and, while a package is active,
              sent to and published from Channel Management. On that date RClipper
              deletes its copy, and the copy kept inside the RClipper app on your
              phone is deleted on the same date. A video you have already downloaded
              to your phone&apos;s gallery or elsewhere stays yours to keep and is not
              affected. The photos and clips you pick are kept in the app for{" "}
              {limits.originalsDays} days so that the video and its shapes can be
              made.
            </p>
            <p>
              Channel Management is available only while a package is active. A
              video sent to it keeps the same expiry date. Videos you upload yourself
              require an active package, are kept for {FREE_FACTS.days} days, and up
              to {MANAGEMENT_UPLOAD_KEEP_LIMIT} uploaded videos may be kept at once.
              When a package ends, videos already downloadable remain downloadable
              until their date, but new publishing and uploads stop. Posts already
              published on a social platform are not removed by RClipper when a video
              or package expires.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              6. Your uploaded materials
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
              7. Ownership and licences
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
              8. Selection for RClipper Channels
            </h2>
            <p>
              Not every generated video is published. RClipper may select certain
              reviewed videos for public publication through the “RClipper Channels.”
              RClipper Channels means the TravyBuzz app, Travy.buzz website, and official
              accounts owned or controlled by RClipper on Facebook, Instagram,
              TikTok, YouTube, and Xiaohongshu (小红书). Selection is discretionary,
              is not guaranteed, and does not entitle the requester to payment,
              promotion, audience size, or a minimum publication period.
            </p>
            <p>
              By confirming the content-rights checkbox for a request, you authorise
              RClipper to use the uploaded materials and request content for selected
              publication through the RClipper Channels. This includes text, place names, addresses,
              selected map locations, coordinates, categories, descriptions, and
              business or attraction information, whether or not each item appears
              inside the finished video. RClipper may display this information in a
              post, place page, listing, caption, search result, map marker, or related
              location feature. RClipper may prepare titles, captions, hashtags,
              subtitles, translations, thumbnails, crops, and technical formats
              reasonably required for each RClipper Channel. RClipper may monetise
              videos published through the RClipper Channels through platform-displayed
              advertising, revenue-sharing programmes, creator programmes, subscriptions,
              gifts, and similar monetisation features. All resulting revenue, including
              revenue from channels branded as TravyBuzz, belongs exclusively to
              RClipper, and no revenue share or payment is owed to the requester.
              Platform monetisation is not considered paid advertising or
              unrelated promotional use. This permission does not authorise use of the
              content itself as paid advertising, as an endorsement of an unrelated
              product or service, publication through accounts that RClipper does not
              own or control, or publication through other channels unless separately
              disclosed and authorised.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              9. Review, moderation, and removal
            </h2>
            <p>
              RClipper may review, decline, unpublish, or remove content at any time
              for quality, safety, legal, operational, or policy reasons. Requests to
              report rights violations, privacy concerns, or objectionable content
              may be sent to{" "}
              <a href="mailto:pillarth@gmail.com" className="text-blue-700 underline">
                pillarth@gmail.com
              </a>
              . A removal request will be assessed under applicable law and the
              rights of affected people; ownership of RClipper&apos;s production
              elements does not override applicable privacy or third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              10. Service availability and liability
            </h2>
            <p>
              Production estimates are targets rather than guarantees. Video
              rendering depends on the capability of your phone and on the app
              being kept open while it works. To the extent
              permitted by law, RClipper is not responsible for delays or failures
              caused by incomplete materials, third-party providers, platform
              outages, force majeure, or the requester&apos;s lack of necessary
              rights. Nothing in these Terms excludes rights or remedies that cannot
              lawfully be excluded.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              11. Privacy, changes, and contact
            </h2>
            <p>
              The{" "}
              <Link href={ROUTES.PRIVACY} className="text-blue-700 underline">
                Privacy Policy
              </Link>{" "}
              explains how RClipper handles personal data, media, retention, AI
              providers, and TravyBuzz publication. Material changes to ownership or
              publication rights will be presented for renewed acceptance where
              required. Questions may be sent to{" "}
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
