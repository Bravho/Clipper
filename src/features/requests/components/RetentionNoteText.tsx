import type { RetentionNote } from "@/lib/retentionNotes";

/**
 * Renders an inline retention text note (availability window, inactivity
 * countdown, auto-cancel notice). Presentational only — no email, no popup.
 * Returns null when there is no note to show.
 */
export function RetentionNoteText({
  note,
  className = "",
}: {
  note: RetentionNote | null;
  className?: string;
}) {
  if (!note) return null;

  const toneClass =
    note.tone === "expired"
      ? "text-red-600"
      : note.tone === "warning"
        ? "text-amber-600"
        : "text-slate-500";

  return <p className={`text-xs ${toneClass} ${className}`.trim()}>{note.text}</p>;
}
