import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";

export const metadata: Metadata = { title: "External Workforce — Admin" };

export default async function ExternalWorkforcePlaceholderPage() {
  await requireRole(Role.Admin);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">External Workforce</h1>
        <p className="mt-1 text-sm text-slate-500">
          RClipper Agent Service — placeholder for future external editor / subcontractor integration.
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center space-y-4">
        <p className="text-lg font-semibold text-slate-700">
          Not Built Yet
        </p>
        <p className="text-sm text-slate-500 max-w-lg mx-auto">
          This section will house the RClipper Agent Service — a future module for managing
          external editors, subcontractors, or automated AI-assisted production workflows.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4 text-sm">
        <h2 className="font-semibold text-slate-800">What Will Be Built Here</h2>
        <div className="space-y-2">
          {[
            {
              title: "External Editor Accounts",
              desc: "Manage freelance or subcontractor editor accounts with restricted portal access.",
            },
            {
              title: "Task Assignment",
              desc: "Assign specific editing tasks to external editors with scoped access to only their assigned request.",
            },
            {
              title: "Submission Workflow",
              desc: "External editors submit clips for internal staff/admin review via the same production review pipeline.",
            },
            {
              title: "RClipper Agent Service",
              desc: "Optional AI-assisted clip generation or editing suggestions via an external service API.",
            },
            {
              title: "Capacity Planning",
              desc: "Track external workforce capacity alongside internal staff for queue management.",
            },
          ].map((item) => (
            <div key={item.title} className="flex gap-3">
              <span className="text-slate-300 shrink-0 mt-0.5">▸</span>
              <div>
                <p className="font-medium text-slate-700">{item.title}</p>
                <p className="text-slate-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-100 pt-4 space-y-1 text-xs text-slate-400">
          <p>
            <strong className="text-slate-500">TODO: PostgreSQL</strong> — external_workforce_accounts, task_assignments tables.
          </p>
          <p>
            <strong className="text-slate-500">TODO: Auth</strong> — scoped external editor sessions with limited route access.
          </p>
          <p>
            <strong className="text-slate-500">TODO: RClipper Agent Service</strong> — define API contract for external service communication.
          </p>
        </div>
      </div>
    </div>
  );
}
