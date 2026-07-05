"use client";

/**
 * Phase 8 — the per-channel "publish" call-to-action on the distribution-review
 * step. One of these renders inside every channel card; clicking it runs the
 * Gemini content-safety gate and (on approval) publishes that single channel.
 *
 * Styling goal: a modern, professional branded button that carries the RClipper
 * logo and a channel-specific label, e.g.
 *   "ยืนยันและเผยแพร่ผ่านช่องทาง TikTok ของ RClipper".
 */

interface PublishChannelButtonProps {
  /** Human-readable channel name, e.g. "TikTok". */
  channelLabel: string;
  onClick: () => void;
  loading?: boolean;
  /** Already published — render a calm success state, non-interactive. */
  posted?: boolean;
  disabled?: boolean;
}

export function PublishChannelButton({
  channelLabel,
  onClick,
  loading = false,
  posted = false,
  disabled = false,
}: PublishChannelButtonProps) {
  if (posted) {
    return (
      <div className="inline-flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-5 py-3 text-sm font-semibold text-green-700">
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.3 3.3 6.8-6.8a1 1 0 011.4 0z"
            clipRule="evenodd"
          />
        </svg>
        เผยแพร่ผ่าน {channelLabel} เรียบร้อยแล้ว
      </div>
    );
  }

  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={[
        "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl",
        "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600",
        "px-5 py-3 text-sm font-semibold text-white",
        "shadow-lg shadow-indigo-500/25 ring-1 ring-white/10",
        "transition-all duration-200",
        "hover:shadow-xl hover:shadow-indigo-500/40 hover:brightness-110",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2",
        "active:scale-[0.98]",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100 disabled:hover:shadow-lg",
      ].join(" ")}
    >
      {/* Sheen sweep on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
      />

      {/* RClipper logo badge */}
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/95 shadow-sm ring-1 ring-black/5">
        {loading ? (
          <svg className="h-4 w-4 animate-spin text-indigo-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/logo.png" alt="RClipper" className="h-5 w-5 object-contain" />
        )}
      </span>

      <span className="relative">
        {loading ? "กำลังตรวจสอบและเผยแพร่…" : (
          <>
            ยืนยันและเผยแพร่ผ่านช่องทาง{" "}
            <span className="font-bold">{channelLabel}</span> ของ RClipper
          </>
        )}
      </span>
    </button>
  );
}
