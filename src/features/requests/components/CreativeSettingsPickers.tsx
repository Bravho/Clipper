"use client";

/**
 * The three creative choices a requester makes for their video: background
 * music, subtitle languages and the motion-graphic template.
 *
 * They are all decided ONCE, on the scene-plan approval screen (pipeline phase 3
 * — "วางแผนฉากและสคริปต์วิดีโอ"), which is also where the express lane
 * ("approve everything from here") is offered. The later review gates show the
 * resulting choice read-only and reopen the matching picker behind an edit
 * toggle, so every control is defined exactly once — here.
 */

import { BACKGROUND_MUSIC_TRACKS } from "@/config/backgroundMusic";
import { MOTION_TEMPLATES } from "@/config/motionTemplates";

/** At most two subtitle languages fit on screen at once. */
export const MAX_SUBTITLE_LANGS = 2;

export type SubtitleLang = "th" | "en" | "zh";

/** Small SVG preview of a template, mirroring the real render. */
export function TemplateThumb({ id }: { id: string }) {
  return (
    <svg viewBox="0 0 64 112" className="mx-auto mb-1.5 block h-28 w-16">
      <defs>
        <linearGradient id="tvScreen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b4655" />
          <stop offset="1" stopColor="#111827" />
        </linearGradient>
      </defs>

      {id === "framed_cream" ? (
        <>
          <rect width="64" height="112" rx="8" fill="#f7ecda" />
          <rect x="7" y="8" width="50" height="78" rx="7" fill="#ffffff" />
          <rect x="10" y="11" width="44" height="72" rx="5" fill="url(#tvScreen)" />
          <path d="M12 100 q4 -3.5 8 0 t8 0 t8 0" fill="none" stroke="#c98a3f" strokeWidth="1.5" strokeLinecap="round" opacity="0.85" />
          <g stroke="#b4762f" strokeWidth="1.3" fill="none" strokeLinecap="round" opacity="0.85">
            <path d="M40 104 q9 -5 16 -10" />
            <path d="M45 101 q1 -4 -3 -6" />
            <path d="M50 98 q1 -4 -3 -6" />
          </g>
          <rect x="15" y="74" width="34" height="5" rx="2.5" fill="#ffffff" opacity="0.92" />
        </>
      ) : id === "editorial" ? (
        <>
          <rect width="64" height="112" rx="8" fill="url(#tvScreen)" />
          <rect width="64" height="24" fill="#000" opacity="0.28" />
          <rect y="82" width="64" height="30" fill="#000" opacity="0.35" />
          <rect x="6" y="7" width="52" height="98" rx="6" fill="none" stroke="#ffffff" strokeWidth="1.3" opacity="0.85" />
          <circle cx="13" cy="15" r="1.8" fill="#f5b301" />
          <rect x="17" y="14" width="14" height="2" rx="1" fill="#f5b301" />
          <rect x="12" y="94" width="40" height="6" rx="3" fill="#ffffff" opacity="0.92" />
        </>
      ) : id === "clean_frame" ? (
        <>
          <rect width="64" height="112" rx="8" fill="url(#tvScreen)" />
          <g stroke="#ffffff" strokeWidth="2" fill="none" strokeLinecap="round">
            <path d="M9 20 V11 H18" />
            <path d="M55 20 V11 H46" />
            <path d="M9 84 V93 H18" />
            <path d="M55 84 V93 H46" />
          </g>
          <rect x="27" y="15" width="10" height="2.5" rx="1.2" fill="#f5b301" />
          <circle cx="14" cy="78" r="5" fill="none" stroke="#f5b301" strokeWidth="1.2" opacity="0.75" />
          <circle cx="14" cy="78" r="9" fill="none" stroke="#f5b301" strokeWidth="1" opacity="0.4" />
          <rect x="12" y="97" width="40" height="6" rx="3" fill="#ffffff" opacity="0.92" />
        </>
      ) : (
        <>
          <rect width="64" height="112" rx="8" fill="url(#tvScreen)" />
          <rect x="12" y="96" width="40" height="6" rx="3" fill="#ffffff" opacity="0.92" />
        </>
      )}
    </svg>
  );
}

export const SUBTITLE_LANG_LABELS: Record<"th" | "en" | "zh", string> = {
  th: "ไทย",
  en: "อังกฤษ",
  zh: "จีน",
};

/** One-line summaries of the settings chosen at the scene-video review, shown
 *  on the later gates in place of the pickers themselves. */
export function musicTrackLabel(id: string | null): string {
  if (id == null) return "ยังไม่ได้เลือก";
  if (id === "none") return "ไม่ใส่เพลง";
  return BACKGROUND_MUSIC_TRACKS.find((t) => t.id === id)?.label ?? id;
}

export function subtitleLangsLabel(langs: ("th" | "en" | "zh")[]): string {
  if (langs.length === 0) return "ยังไม่ได้เลือก";
  return langs.map((l) => SUBTITLE_LANG_LABELS[l]).join(" + ");
}

export function motionTemplateLabel(id: string | null): string {
  return MOTION_TEMPLATES.find((t) => t.id === (id ?? "none"))?.name ?? "ไม่มีเทมเพลต (คลีน)";
}

/**
 * Background-music picker. Lives on the scene-video review screen (where every
 * creative choice is now made) and is re-opened behind an "edit" toggle on the
 * merge gate, so the same control is defined once.
 */
export function MusicPicker({
  selected,
  playing,
  onSelect,
}: {
  selected: string | null;
  playing: string | null;
  onSelect: (trackId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div>
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">เพลงพื้นหลัง</p>
        <p className="text-xs text-slate-400 mt-0.5">คลิกเพื่อฟังตัวอย่าง เสียงพูดจะดังขึ้นอัตโนมัติเมื่อไม่มีการพูด</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onSelect("none")}
          className={[
            "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
            selected === "none"
              ? "border-slate-500 bg-slate-100 text-slate-800 font-medium"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50",
          ].join(" ")}
        >
          <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
            {selected === "none" ? (
              <svg className="w-4 h-4 text-slate-700" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
            ) : (
              <svg className="w-4 h-4 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" /><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 20v4M8 20h8" /></svg>
            )}
          </span>
          <span className="truncate">ไม่ใส่เพลง</span>
        </button>
        {BACKGROUND_MUSIC_TRACKS.map((track) => {
          const isSelected = selected === track.id;
          const isPlaying = playing === track.id;
          return (
            <button
              key={track.id}
              onClick={() => onSelect(track.id)}
              className={[
                "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
                isSelected
                  ? "border-purple-500 bg-purple-50 text-purple-800 font-medium"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
              ].join(" ")}
            >
              <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                {isPlaying ? (
                  <span className="flex gap-0.5 items-end h-4">
                    <span className="w-0.5 bg-purple-500 rounded-full animate-bounce" style={{ height: "60%", animationDelay: "0ms" }} />
                    <span className="w-0.5 bg-purple-500 rounded-full animate-bounce" style={{ height: "100%", animationDelay: "100ms" }} />
                    <span className="w-0.5 bg-purple-500 rounded-full animate-bounce" style={{ height: "40%", animationDelay: "200ms" }} />
                  </span>
                ) : isSelected ? (
                  <svg className="w-4 h-4 text-purple-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                ) : (
                  <svg className="w-4 h-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                )}
              </span>
              <span className="truncate">{track.label}</span>
            </button>
          );
        })}
      </div>
      {selected === null && (
        <p className="text-xs text-amber-600">กรุณาเลือกเพลง หรือเลือก &ldquo;ไม่ใส่เพลง&rdquo; ก่อนอนุมัติ</p>
      )}
    </div>
  );
}

/** Subtitle-language picker (1–2 of th/en/zh). Travy always renders EN+ZH. */
export function SubtitleLanguagePicker({
  value,
  max,
  onToggle,
}: {
  value: ("th" | "en" | "zh")[];
  max: number;
  onToggle: (lang: "th" | "en" | "zh") => void;
}) {
  return (
    <div className="rounded-xl border-2 border-blue-300 bg-blue-50/70 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            ต้องเลือก · ใช้กับวิดีโอทุกช่องทาง
          </p>
          <h4 className="mt-1 text-base font-semibold text-slate-900">
            เลือกภาษาซับไตเติ้ล
          </h4>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
          เลือกแล้ว {value.length}/{max}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        เลือก 1–2 ภาษาสำหรับวิดีโอทุกช่องทางของคุณ
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {([
          { code: "th", label: "ไทย", short: "TH" },
          { code: "en", label: "อังกฤษ", short: "EN" },
          { code: "zh", label: "จีน", short: "ZH" },
        ] as const).map(({ code, label, short }) => {
          const selected = value.includes(code);
          const atMax = !selected && value.length >= max;
          return (
            <button
              key={code}
              type="button"
              onClick={() => onToggle(code)}
              disabled={atMax}
              aria-pressed={selected}
              className={`flex min-h-16 flex-col items-center justify-center rounded-lg border px-2 py-2 text-sm font-semibold transition ${
                selected
                  ? "border-blue-500 bg-blue-600 text-white ring-2 ring-blue-200"
                  : atMax
                    ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-300"
                    : "border-blue-200 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50"
              }`}
            >
              <span className="text-xs opacity-75">{short}</span>
              <span>{selected ? "✓ " : ""}{label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Travy ใช้ซับไตเติ้ลอังกฤษและจีนโดยอัตโนมัติ
      </p>
      {value.length === 0 && (
        <p className="mt-2 text-sm font-medium text-red-600">
          กรุณาเลือกอย่างน้อย 1 ภาษา
        </p>
      )}
    </div>
  );
}

/** Motion-graphic template picker (default "none" = clean full-bleed). */
export function MotionTemplatePicker({
  value,
  onSelect,
}: {
  value: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm font-medium text-slate-800">เลือกเทมเพลตกราฟิก (Motion Template)</p>
      <p className="text-xs text-slate-400 mt-0.5 mb-3">
        เลือกสไตล์กรอบและกราฟิกที่จะซ้อนบนวิดีโอ (ค่าเริ่มต้น: ไม่มีเทมเพลต — วิดีโอเต็มจอ + ซับไตเติ้ล)
      </p>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {MOTION_TEMPLATES.map((tpl) => {
          const active = value === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onSelect(tpl.id)}
              className={`shrink-0 w-24 rounded-lg border p-2 text-left transition ${
                active
                  ? "border-green-400 ring-2 ring-green-200 bg-green-50"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <TemplateThumb id={tpl.id} />
              <p className="text-[11px] font-medium leading-tight text-slate-700">{tpl.name}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
