import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { LAB_PROVIDER_EXECUTION_ENABLED } from "@/lib/lab/labGuards";
import { decideLabScreen } from "@/lib/lab/labScreen";

/**
 * Lab auto-run entry. Hidden (not found) unless every gate passes. Even when
 * shown, it starts nothing: the runner is not connected to the phone yet.
 */
export default async function LabAutoRunPage() {
  const session = await getServerSession(authOptions);
  const decision = decideLabScreen({
    flagValue: process.env.LAB_AUTORUN_ENABLED,
    providerExecutionEnabled: LAB_PROVIDER_EXECUTION_ENABLED,
    labEmail: process.env.DEVICE_RENDER_LAB_TEST_EMAIL,
    requesterRole: Role.Requester,
    session: session?.user
      ? {
          user: {
            id: session.user.id ?? null,
            role: session.user.role ?? null,
            email: session.user.email ?? null,
          },
        }
      : null,
  });
  if (!decision.show) notFound();
  return (
    <main style={{ padding: 24 }}>
      <h1>Lab auto-run</h1>
      <p>The lab runner is not connected yet. Nothing runs from this page.</p>
    </main>
  );
}
