import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { isManagementEnabledFor } from "@/config/management";
import { getServerI18n } from "@/i18n/server";
import { ConnectionsManager } from "@/features/management/components/ConnectionsManager";

export const dynamic = "force-dynamic";

/**
 * Social connections page.
 *
 * Connecting accounts is free, so this page has no entitlement gate beyond the
 * feature flag — users can wire up their accounts before deciding to pay.
 *
 * The manager is a client component reading `useSearchParams()` (the OAuth
 * callback reports its outcome there), so it sits behind a Suspense boundary.
 */
export default async function ManagementConnectionsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) notFound();

  const user = {
    id: session.user.id,
    email: session.user.email ?? null,
    role: session.user.role,
  };
  // A disabled feature is a 404, not a 403.
  if (!isManagementEnabledFor(user)) notFound();

  const { t } = getServerI18n();

  return (
    <div className="relative min-h-full overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.10),transparent_40%),linear-gradient(to_bottom,rgba(255,255,255,0.8),transparent)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <header className="mb-7 flex items-start gap-4">
          <span className="hidden h-12 w-12 flex-none items-center justify-center rounded-2xl bg-blue-700 text-white shadow-lg shadow-blue-700/20 sm:flex">
            <ConnectionsIcon className="h-6 w-6" />
          </span>
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-700">
              {t("management.title")}
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
              {t("management.connections")}
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">
              {t("management.connectFree")}
            </p>
          </div>
        </header>

        <Suspense fallback={<ConnectionsPageSkeleton label={t("management.loading")} />}>
          <ConnectionsManager />
        </Suspense>
      </div>
    </div>
  );
}

function ConnectionsPageSkeleton({ label }: { label: string }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
      aria-label={label}
    >
      <div className="animate-pulse p-6">
        <div className="h-4 w-40 rounded bg-slate-100" />
        <div className="mt-2 h-3 w-64 max-w-full rounded bg-slate-100" />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-20 rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    </div>
  );
}

function ConnectionsIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M9.2 14.8 14.8 9.2M7.1 17H6a4 4 0 0 1 0-8h3m6 0h3a4 4 0 0 1 0 8h-3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
