import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { isManagementEnabledFor } from "@/config/management";
import { DashboardShell } from "@/components/layout/DashboardShell";

/**
 * Requester dashboard layout.
 *
 * Now a SERVER component so the RClipper Management feature flag is evaluated
 * on the server. The flag depends on env config plus the user's identity, and
 * neither belongs in the browser bundle — the client shell only receives the
 * already-decided boolean, and the routes behind the nav item re-check it
 * independently.
 *
 * The visual shell itself lives in `components/layout/DashboardShell.tsx`
 * because it needs `useI18n()`.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  const showManagement = session?.user
    ? isManagementEnabledFor({
        id: session.user.id,
        email: session.user.email,
        role: session.user.role,
      })
    : false;

  return <DashboardShell showManagement={showManagement}>{children}</DashboardShell>;
}
