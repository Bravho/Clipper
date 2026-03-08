import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { creditService } from "@/services/CreditService";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireRole(Role.Requester);
  const balance = await creditService.getBalance(user.id);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome, {user.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-slate-500">
          Manage your clip requests and track their progress.
        </p>
      </div>

      {/* Credits summary */}
      <div className="mb-8 flex items-center gap-4 rounded-xl border border-blue-200 bg-blue-50 p-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-700 text-white font-bold text-lg">
          {balance}
        </div>
        <div>
          <p className="font-semibold text-blue-900">
            {balance} credit{balance !== 1 ? "s" : ""} remaining
          </p>
          <p className="text-sm text-blue-700">Each clip request costs 10 credits.</p>
        </div>
      </div>

      {/* Placeholder modules */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <PlaceholderCard
          title="My Requests"
          description="View and track all your clip requests."
          badge="Coming soon"
          note="Request submission module — Phase 2B"
        />
        <PlaceholderCard
          title="Queue Position"
          description="See where your active request sits in the production queue."
          badge="Coming soon"
          note="Queue module — future phase"
        />
        <PlaceholderCard
          title="Delivery Links"
          description="Access published clips and platform links."
          badge="Coming soon"
          note="Delivery module — future phase"
        />
      </div>

      <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
        <p className="text-sm font-medium text-slate-500">
          Placeholder — Requester Dashboard
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Request submission, queue tracking, and delivery links will appear here in the next phase.
        </p>
      </div>
    </div>
  );
}

function PlaceholderCard({
  title,
  description,
  badge,
  note,
}: {
  title: string;
  description: string;
  badge: string;
  note: string;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <CardHeader padding="none" className="mb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge variant="yellow">{badge}</Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <p className="text-xs text-slate-400 border-t border-slate-100 pt-3 mt-auto">
        {note}
      </p>
    </Card>
  );
}
