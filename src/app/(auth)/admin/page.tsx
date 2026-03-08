import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Admin Dashboard" };

export default async function AdminPage() {
  const user = await requireRole(Role.Admin);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
          <Badge variant="red">Admin</Badge>
        </div>
        <p className="mt-1 text-slate-500">
          Signed in as <span className="font-medium">{user.name}</span> &middot; {user.email}
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-dashed border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm font-medium text-slate-600">
          Placeholder — Admin Control Panel
        </p>
        <p className="mt-1 text-xs text-slate-400">
          User management, queue oversight, credit management, analytics, and platform
          configuration will appear here in a future phase.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[
          {
            title: "User Management",
            desc: "View, suspend, or manage all requester and staff accounts.",
            note: "Admin user module — future phase",
          },
          {
            title: "Queue Oversight",
            desc: "Full view of all active, pending, and completed requests.",
            note: "Admin queue module — future phase",
          },
          {
            title: "Credit Management",
            desc: "Grant or adjust credits for individual accounts.",
            note: "Admin credit module — future phase",
          },
          {
            title: "Staff Accounts",
            desc: "Create and manage internal staff accounts.",
            note: "Staff provisioning — future phase",
          },
          {
            title: "Platform Analytics",
            desc: "Request volume, SLA compliance, and delivery metrics.",
            note: "Analytics module — future phase",
          },
          {
            title: "Policy Versions",
            desc: "Manage and publish legal policy versions.",
            note: "Policy management — future phase",
          },
        ].map((item) => (
          <Card key={item.title} className="flex flex-col gap-2">
            <CardHeader padding="none" className="mb-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{item.title}</CardTitle>
                <Badge variant="yellow">Soon</Badge>
              </div>
              <CardDescription>{item.desc}</CardDescription>
            </CardHeader>
            <p className="mt-auto border-t border-slate-100 pt-3 text-xs text-slate-400">
              {item.note}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
