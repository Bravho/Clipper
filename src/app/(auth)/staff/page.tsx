import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Staff Dashboard" };

export default async function StaffPage() {
  const user = await requireRole(Role.Staff, Role.Admin);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Staff Dashboard</h1>
          <Badge variant="green">Staff</Badge>
        </div>
        <p className="mt-1 text-slate-500">
          Signed in as <span className="font-medium">{user.name}</span> &middot; {user.email}
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
        <p className="text-sm font-medium text-slate-500">
          Placeholder — Staff Workflow Dashboard
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Request queue, assignment workflow, upload/delivery tools, and status management
          will appear here in a future phase.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {[
          {
            title: "Production Queue",
            desc: "View accepted requests and assign production.",
            note: "Staff workflow module — future phase",
          },
          {
            title: "Upload Final Clip",
            desc: "Upload completed clips and set publishing channels.",
            note: "Delivery module — future phase",
          },
          {
            title: "Update Request Status",
            desc: "Move requests through the production workflow.",
            note: "Status management — future phase",
          },
          {
            title: "On Hold / Rejections",
            desc: "Manage requests requiring requester action.",
            note: "Hold & rejection flow — future phase",
          },
        ].map((item) => (
          <Card key={item.title} className="flex flex-col gap-2">
            <CardHeader padding="none" className="mb-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{item.title}</CardTitle>
                <Badge variant="yellow">Coming soon</Badge>
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
