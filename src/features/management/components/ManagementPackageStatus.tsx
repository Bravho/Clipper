import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { ROUTES, managementPaymentsPath } from "@/config/routes";

export type PackageDisplayStatus =
  | "active"
  | "scheduled"
  | "exhausted"
  | "expired"
  | "refunded"
  | "revoked";

export interface ManagementPackageSummary {
  id: string;
  name: string;
  kind: "upload_bundle" | "access_pass";
  status: PackageDisplayStatus;
  creditsUsed: number | null;
  remainingUploads: number | null;
  totalUploads: number | null;
  boughtAt: Date;
  startsAt: Date;
  expiresAt: Date;
}

const STATUS_STYLES: Record<PackageDisplayStatus, string> = {
  active: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
  scheduled: "bg-blue-100 text-blue-800 ring-blue-600/20",
  exhausted: "bg-amber-100 text-amber-900 ring-amber-600/20",
  expired: "bg-slate-100 text-slate-600 ring-slate-500/20",
  refunded: "bg-violet-100 text-violet-800 ring-violet-600/20",
  revoked: "bg-rose-100 text-rose-800 ring-rose-600/20",
};

function formatDate(value: Date): string {
  return value.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ManagementPackageStatus({
  packages,
}: {
  packages: ManagementPackageSummary[];
}) {
  return (
    <Card
      padding="none"
      className="mb-6 overflow-hidden border-blue-200 bg-gradient-to-br from-blue-50 via-white to-emerald-50 shadow-[0_12px_35px_rgba(37,99,235,0.08)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-blue-100 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-700 text-white shadow-sm">
            <PackageIcon />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">
              Channel Management package
            </p>
            <p className="mt-0.5 text-sm text-slate-600">
              Your publishing access and usage at a glance
            </p>
          </div>
        </div>
        <Link
          href={managementPaymentsPath(ROUTES.MANAGEMENT)}
          className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 shadow-sm transition-colors hover:bg-blue-50"
        >
          View publishing packages
        </Link>
      </div>

      {packages.length === 0 ? (
        <div className="px-5 py-5 sm:px-6">
          <p className="text-sm font-semibold text-slate-900">No publishing package yet</p>
          <p className="mt-1 text-sm text-slate-600">
            Use credits to activate publishing uploads or unlimited access.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-blue-100/80">
          {packages.map((item) => (
            <li key={item.id} className="px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-950">{item.name}</h2>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset ${STATUS_STYLES[item.status]}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {item.kind === "upload_bundle"
                      ? "One video published to one channel uses one upload."
                      : "Unlimited publishing while this access period is active."}
                  </p>
                </div>

                <div className="rounded-xl bg-white/85 px-4 py-2.5 text-right shadow-sm ring-1 ring-slate-200/70">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {item.kind === "upload_bundle" ? "Uploads remaining" : "Publishing allowance"}
                  </p>
                  <p className="mt-0.5 text-xl font-bold text-slate-950">
                    {item.kind === "upload_bundle"
                      ? `${item.remainingUploads ?? 0} of ${item.totalUploads ?? 0}`
                      : "Unlimited"}
                  </p>
                </div>
              </div>

              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <PackageDetail label="Credits used" value={item.creditsUsed === null ? "—" : item.creditsUsed.toLocaleString("en-US")} />
                <PackageDetail label="Purchased" value={formatDate(item.boughtAt)} />
                <PackageDetail
                  label={item.status === "scheduled" ? "Starts / expires" : "Expiry date"}
                  value={
                    item.status === "scheduled"
                      ? `${formatDate(item.startsAt)} / ${formatDate(item.expiresAt)}`
                      : formatDate(item.expiresAt)
                  }
                />
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PackageDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function PackageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="m4.5 7.7 7.5 4.2 7.5-4.2M12 12v8.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
