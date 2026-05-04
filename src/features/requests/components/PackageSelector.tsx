"use client";

import { useState } from "react";
import { NewRequestForm } from "./NewRequestForm";

interface Props {
  creditBalance: number;
}

const PACKAGES = [
  {
    id: "semi-auto",
    title: "Semi-Auto 15s AI Video",
    badge: "AI-Powered",
    badgeColor: "bg-blue-100 text-blue-700",
    description:
      "Upload your images and describe your vision. Our AI generates a 15-second short video — complete with script, bilingual subtitles, professional voiceover, and publishing to all platforms.",
    credits: 30,
    highlights: [
      "Upload images (up to 5)",
      "AI scene planning & script",
      "Thai voiceover + ElevenLabs voice",
      "Thai + English subtitles",
      "Published to TikTok, Instagram, YouTube & more",
    ],
    available: true,
    comingSoon: false,
  },
  {
    id: "raw-video",
    title: "Raw Video Submission",
    badge: "Coming Soon",
    badgeColor: "bg-slate-100 text-slate-500",
    description:
      "Already have footage? Submit your raw video and let our team handle the editing, captioning, and publishing.",
    credits: null,
    highlights: [
      "Upload your own video",
      "Professional editing by our team",
      "Captions & publishing included",
    ],
    available: false,
    comingSoon: true,
  },
  {
    id: "full-production",
    title: "Full Production",
    badge: "Coming Soon",
    badgeColor: "bg-slate-100 text-slate-500",
    description:
      "Our team visits your location, handles all filming, directing, editing, and publishes everything — a complete production house service.",
    credits: null,
    highlights: [
      "On-site filming by our crew",
      "Full directing & production",
      "Post-production & publishing",
    ],
    available: false,
    comingSoon: true,
  },
] as const;

export function PackageSelector({ creditBalance }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  if (selected === "semi-auto") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="mb-6 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          ← Change package
        </button>

        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 flex items-center gap-3">
          <div className="rounded-full bg-blue-600 p-1.5">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-blue-800">Semi-Auto 15s AI Video — 30 credits</p>
            <p className="text-xs text-blue-600 mt-0.5">Images only · AI generates your video automatically</p>
          </div>
        </div>

        <NewRequestForm
          creditBalance={creditBalance}
          imageOnly
          creditCost={30}
        />
      </div>
    );
  }

  return (
    <div>
      <p className="mb-6 text-sm text-slate-500">
        Choose the type of production that fits your needs.
      </p>

      <div className="flex flex-col gap-4">
        {PACKAGES.map((pkg) => (
          <div
            key={pkg.id}
            className={[
              "rounded-xl border p-5 transition-all",
              pkg.available
                ? "border-slate-200 bg-white hover:border-blue-400 hover:shadow-sm cursor-pointer"
                : "border-slate-100 bg-slate-50 cursor-not-allowed opacity-60",
            ].join(" ")}
            onClick={() => pkg.available && setSelected(pkg.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-base font-semibold text-slate-900">{pkg.title}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${pkg.badgeColor}`}>
                    {pkg.badge}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mb-3">{pkg.description}</p>
                <ul className="flex flex-col gap-1">
                  {pkg.highlights.map((h) => (
                    <li key={h} className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className={pkg.available ? "text-blue-500" : "text-slate-300"}>✓</span>
                      {h}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="shrink-0 text-right">
                {pkg.credits !== null ? (
                  <div>
                    <p className="text-2xl font-bold text-slate-900">{pkg.credits}</p>
                    <p className="text-xs text-slate-400">credits</p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 italic">TBA</p>
                )}
              </div>
            </div>

            {pkg.available && (
              <div className="mt-4 flex justify-end">
                <span className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white">
                  Select →
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
