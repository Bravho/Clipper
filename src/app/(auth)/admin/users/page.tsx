import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { adminUserService } from "@/services/admin/AdminUserService";
import { Badge } from "@/components/ui/Badge";
import { AddEditorForm } from "@/features/admin/components/AddEditorForm";

export const metadata: Metadata = { title: "User Management — Admin" };

const ROLE_BADGE: Record<Role, "green" | "blue" | "red"> = {
  [Role.Requester]: "blue",
  [Role.Editor]: "green",
  [Role.Admin]: "red",
};

export default async function AdminUsersPage() {
  await requireRole(Role.Admin);

  const [users, requestersWithCredits] = await Promise.all([
    adminUserService.listAllUsers(),
    adminUserService.listRequestersWithCredits(),
  ]);

  const creditsByUserId = Object.fromEntries(
    requestersWithCredits.map((r) => [r.user.id, r.creditBalance])
  );

  const requesters = users.filter((u) => u.role === Role.Requester);
  const editors = users.filter((u) => u.role === Role.Editor);
  const admins = users.filter((u) => u.role === Role.Admin);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
        <p className="mt-1 text-sm text-slate-500">
          {users.length} total users — {requesters.length} requesters, {editors.length} editors, {admins.length} admins.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-3xl font-bold text-slate-900">{requesters.length}</p>
          <p className="mt-1 text-sm text-slate-500">Requesters</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-3xl font-bold text-slate-900">{editors.length}</p>
          <p className="mt-1 text-sm text-slate-500">Editors</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-3xl font-bold text-slate-900">{admins.length}</p>
          <p className="mt-1 text-sm text-slate-500">Admins</p>
        </div>
      </div>

      {/* User table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Credits</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {user.name}
                </td>
                <td className="px-4 py-3 text-slate-600">{user.email}</td>
                <td className="px-4 py-3">
                  <Badge variant={ROLE_BADGE[user.role]}>
                    {user.role}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {user.role === Role.Requester
                    ? creditsByUserId[user.id] !== undefined
                      ? `${creditsByUserId[user.id]} credits`
                      : "—"
                    : "—"}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {user.createdAt.toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add editor account */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Add Editor
        </h2>
        <AddEditorForm />
      </div>
    </div>
  );
}
