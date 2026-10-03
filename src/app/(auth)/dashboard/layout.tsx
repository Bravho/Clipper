import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { isManagementEnabledFor } from "@/config/management";
import { isAdLabEnabledFor } from "@/config/adLab";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { isAdLabLocalUserId } from "@/lib/auth/adLabLocalCredentials";
import { isAppUserAgent } from "@/lib/mobile/appUserAgent";

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

  // The private Ad Lab is a web-only owner tool: never list it inside the
  // store apps (their WebView loads this same server), even for the owner.
  const inApp = isAppUserAgent(headers().get("user-agent"));
  const showAdLab = session?.user && !inApp
    ? isAdLabEnabledFor({
        id: session.user.id,
        email: session.user.email,
      })
    : false;
  const adLabOnly = session?.user
    ? isAdLabLocalUserId(session.user.id)
    : false;

  return (
    <DashboardShell
      showManagement={showManagement}
      showAdLab={showAdLab}
      adLabOnly={adLabOnly}
    >
      {children}
    </DashboardShell>
  );
}
