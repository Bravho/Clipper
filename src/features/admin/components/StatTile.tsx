import Link from "next/link";
import { clsx } from "clsx";

/**
 * The admin stat card, extracted.
 *
 * Every admin page had its own copy of `rounded-lg border border-slate-200
 * bg-white p-5` with a `text-3xl` value, and `admin/page.tsx` additionally kept
 * a private `StatCard` component. One implementation means the analytics pages
 * cannot drift from the operations pages.
 *
 * A hero number is a legitimate alternative to a chart: when the answer is one
 * value, showing it as one value beats plotting it.
 */
export function StatTile({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  /** Pre-formatted — the caller owns currency, percentages and units. */
  value: string | number;
  /** Secondary line: comparison, denominator, or caveat. */
  hint?: string;
  href?: string;
  /** `urgent` only turns red when the value is actually non-zero. */
  tone?: "default" | "urgent" | "good";
}) {
  const numeric = typeof value === "number" ? value : Number.NaN;
  const isUrgent = tone === "urgent" && (Number.isNaN(numeric) || numeric > 0);

  const body = (
    <>
      <p
        className={clsx(
          "text-3xl font-bold",
          isUrgent ? "text-red-700" : tone === "good" ? "text-green-700" : "text-slate-900"
        )}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      <p className={clsx("mt-1 text-sm", isUrgent ? "text-red-600" : "text-slate-500")}>
        {label}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </>
  );

  const className = clsx(
    "block rounded-lg border p-5",
    isUrgent ? "border-red-200 bg-red-50" : "border-slate-200 bg-white",
    href && "transition hover:shadow-sm"
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}

/** Standard responsive grid for a row of tiles. */
export function StatTileGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}
