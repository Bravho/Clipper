import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { ROUTES } from "@/config/routes";
import { Card } from "@/components/ui/Card";
import { getServerI18n } from "@/i18n/server";
import { FREE_FACTS, perVideoLimits, tierFacts } from "@/config/planLimits";
import { MANAGEMENT_UPLOAD_KEEP_LIMIT } from "@/services/management/ManagementUploadService";

export const metadata: Metadata = { title: "Legal & Policy — RClipper" };

export default async function LegalPage() {
  await requireRole(Role.Requester);
  const { t } = getServerI18n();
  // Numbers come from the configuration that enforces them (see /terms).
  const starter = tierFacts("starter");
  const pro = tierFacts("pro");
  const limits = perVideoLimits();

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl px-4 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-slate-500">
        <Link href={ROUTES.DASHBOARD} className="hover:text-slate-700">
          {t("nav.dashboard")}
        </Link>
        <span>/</span>
        <span className="font-medium text-slate-700">{t("legalPage.title")}</span>
      </nav>

      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t("legalPage.title")}</h1>
      <p className="mb-8 text-sm text-slate-500">
        {t("legalPage.subtitle")}
      </p>

      {/* Terms of Service */}
      <PolicySection
        title={t("account.policyTerms")}
        items={[
          "RClipper is a short-video production service: you write a brief and pick photos and clips in the RClipper app, RClipper writes the storyboard, script and voice-over, and the video is made on your phone.",
          `Each person may make ${FREE_FACTS.videos} free videos in total. The allowance does not renew and carries over if an account is deleted and created again.`,
          "A free video can be watched in the app only. Downloading it or sending it to Channel Management needs a package.",
          `A free video is kept ${FREE_FACTS.freeDays} days. Buying a package within that time unlocks it and keeps it ${FREE_FACTS.days} days from the purchase.`,
          `Packages last 1, 3, 6 or 12 months and include video making and Channel Management: Starter ${starter.videosPerMonth} videos a month, Pro ${pro.videosPerMonth} videos a month. Unused videos do not carry over to the next month.`,
          "Packages are one-time prepaid purchases with credits. They never renew automatically, and credits spent on a package cannot be refunded.",
          `Each video may be up to ${limits.maxSeconds} seconds, with up to ${limits.voiceMakes} voice-over generations and ${limits.shapes} channel shapes. An approved step cannot be reopened.`,
          "Your account, credits, and requests are personal and non-transferable.",
          "We reserve the right to reject any request that violates these terms.",
          "Service timelines are targets, not guarantees. Rendering depends on your phone and on keeping the app open while it works.",
          "Not every generated video is published. RClipper may select certain reviewed videos for public publication through the Travy app, Travy.buzz, and RClipper-owned or controlled Facebook, Instagram, TikTok, YouTube, and Xiaohongshu (小红书) accounts.",
        ]}
      />

      {/* Ownership & Usage Rights */}
      <PolicySection
        title={t("legalPage.ownership")}
        items={[
          "RClipper owns the original editing, arrangement, graphics, captions, translations, and other production elements it creates, subject to underlying source-material rights.",
          "Once a video is unlocked (made under a package, or a free video unlocked by buying one), you are granted a non-exclusive licence to download, repost and share it on your own channels (e.g. your social media accounts, website). The licence continues for copies you downloaded after RClipper deletes its own copy.",
          "A free video that has not been unlocked may be watched in the app only.",
          "You may NOT resell, redistribute, or relicence the final clip to third parties.",
          "Uploaded source materials remain your property. You grant RClipper the licences needed to produce the request and, if selected, publish the materials and related request text, place names, and selected locations through the defined RClipper Channels.",
          "By uploading materials, you confirm that you own or have all necessary licences, releases, consents, and permissions.",
        ]}
      />

      {/* Privacy Policy */}
      <PolicySection
        title={t("legal.privacy")}
        items={[
          "We collect account information, request briefs, previews of the photos and clips you pick, production choices, approval history, and credit, package and payment records needed to provide the service.",
          "Request data is processed by Google Gemini (storyboard and script), ElevenLabs (voice-over) and Anthropic Claude (on-screen text), and by contracted hosting, storage, authentication, payment and social-publishing providers.",
          "We do not sell your personal data to third parties.",
          "A selected video, together with its title, caption, hashtags, thumbnail, subtitles, user-entered text, place names, selected map locations, and visible or audible information, may become publicly accessible through the defined RClipper Channels.",
          "You may exercise applicable data rights or submit a privacy, content-reporting, or removal request by contacting support.",
        ]}
      />

      {/* Storage & Retention */}
      <PolicySection
        title={t("legalPage.storage")}
        items={[
          `The photos and clips you pick stay on your phone; the app keeps a copy for ${limits.originalsDays} days to make the video. Only small previews are sent to RClipper.`,
          `Finished videos are kept ${FREE_FACTS.freeDays} days (free) or ${FREE_FACTS.days} days (package, or a free video unlocked by a purchase). The date is shown on every video.`,
          "On that date RClipper deletes its copy, and the copy inside the app on your phone is deleted the same day. Videos you downloaded to your gallery are not affected.",
          `Videos in Channel Management keep the same date. Videos you upload yourself need an active package, are kept ${FREE_FACTS.days} days, and up to ${MANAGEMENT_UPLOAD_KEEP_LIMIT} can be kept at once.`,
          "Videos selected for the RClipper Channels may be kept for that publication plus reasonable backup, audit, and legal retention.",
          "If you wish to have your source files removed sooner, please contact our support team.",
        ]}
      />

      <Card className="mb-5">
        <h2 className="mb-3 text-base font-semibold text-slate-900">{t("legalPage.complete")}</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={ROUTES.TERMS} className="text-blue-700 underline">
            {t("legalPage.termsFull")}
          </Link>
          <Link href={ROUTES.OWNERSHIP} className="text-blue-700 underline">
            {t("legal.ownership")}
          </Link>
          <Link href={ROUTES.PRIVACY} className="text-blue-700 underline">
            {t("legal.privacy")}
          </Link>
        </div>
      </Card>

      {/* Contact */}
      <Card className="mt-4">
        <p className="text-sm text-slate-600">
          {t("legalPage.questions")}{" "}
          <a
            href="mailto:pillarth@gmail.com"
            className="text-blue-600 hover:underline"
          >
            {t("legalPage.contact")}
          </a>
          .
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Last updated: 13 October 2026. Material changes will be presented for renewed
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
