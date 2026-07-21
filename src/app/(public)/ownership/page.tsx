import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { ROUTES } from "@/config/routes";

export const metadata: Metadata = {
  title: "Content Ownership and Publication Rights — RClipper",
  description: "RClipper content ownership, requester licences, and selected Travy publication rights.",
};

export default function OwnershipPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="mb-8">
        <p className="text-sm font-medium text-blue-700">Legal</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">
          Content Ownership and Publication Rights
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Version 1.3.0 — Effective 22 July 2026
        </p>
      </div>

      <Card>
        <div className="prose prose-slate max-w-none space-y-7 text-sm leading-relaxed text-slate-700">
          <section>
            <h2 className="text-base font-semibold text-slate-900">
              1. Your source materials
            </h2>
            <p>
              You retain ownership of original materials you upload. You confirm that
              you own those materials or have obtained every licence, consent, model
              or property release, music right, trademark permission, and other
              authorisation necessary for RClipper to process the request and exercise
              the rights below. Request content includes text, titles, descriptions,
              place names, addresses, selected map locations, coordinates, categories,
              and other business, attraction, or location information you provide.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              2. Licence to produce your video
            </h2>
            <p>
              You grant RClipper a non-exclusive, worldwide, royalty-free licence to
              host, copy, edit, adapt, crop, translate, caption, combine, process, and
              otherwise use the uploaded materials to produce, review, store, and
              deliver the requested video.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              3. RClipper production elements
            </h2>
            <p>
              As between you and RClipper, RClipper owns the original editing,
              arrangement, graphics, animation, captions, translations, templates,
              and other production elements created by RClipper. This ownership does
              not transfer ownership of your source materials or any third-party
              material incorporated in the finished video.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              4. Your delivered-video licence
            </h2>
            <p>
              After the applicable download charge is paid or waived, RClipper grants
              you a non-exclusive, royalty-free licence to download and post the
              delivered video on channels you own or control. You may not sell,
              sublicense, or supply the video as stock content, a template, or an
              editable production asset without RClipper&apos;s written permission.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              5. Licence for selected RClipper Channel publication
            </h2>
            <p>
              Not every generated video will be published. If RClipper selects a
              reviewed video, you grant RClipper a non-exclusive, worldwide,
              royalty-free licence to reproduce, host, display, communicate to the
              public, and distribute your source materials as incorporated in the
              finished video and the related request content through the RClipper
              Channels: the Travy app, Travy.buzz website, and official accounts owned
              or controlled by RClipper on Facebook, Instagram, TikTok, YouTube, and
              Xiaohongshu (小红书). RClipper may use text, place names, addresses, selected map
              locations, coordinates, categories, descriptions, and business or
              attraction information in a post, place page, listing, caption, search
              result, map marker, or related location feature. The licence also
              includes reasonable titles, hashtags, subtitles, translations,
              thumbnails, crops, and technical adaptations needed for each RClipper Channel.
            </p>
            <p>
              This licence continues while the selected video is published and
              for reasonable backup, legal, audit, and content-integrity retention.
              RClipper may remove a selected video at its discretion. Requests based
              on privacy, safety, or third-party rights may be sent to{" "}
              <a href="mailto:support@rclipper.com" className="text-blue-700 underline">
                support@rclipper.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900">
              6. Limits on the publication licence
            </h2>
            <p>
              The selected-publication licence is limited to the RClipper Channels.
              RClipper must separately disclose and obtain any authorisation required
              to use the content in paid advertising, unrelated promotional campaigns,
              accounts RClipper does not own or control, or other channels not listed above.
            </p>
            <p>
              RClipper does not claim ownership of public facts, geographic
              coordinates, or third-party place names merely because you entered or
              selected them. The licence permits RClipper to use and present that
              information through the RClipper Channels in connection with the selected content.
            </p>
          </section>

          <p className="border-t border-slate-100 pt-5 text-xs text-slate-500">
            This policy forms part of the{" "}
            <Link href={ROUTES.TERMS} className="text-blue-700 underline">
              RClipper Terms and Conditions
            </Link>
            .
          </p>
        </div>
      </Card>
    </div>
  );
}
