import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { LAB_PROVIDER_EXECUTION_ENABLED } from "@/lib/lab/labGuards";
import { decideLabScreen } from "@/lib/lab/labScreen";
import { labTestPlaceFromEnv } from "@/lib/lab/labStudioIo";
import { LabRunPanel } from "./LabRunPanel";

/**
 * Lab auto-run entry. Hidden (not found) unless every gate passes. The panel's
 * button stays disabled while the provider switch is off (the production value).
 */
export default async function LabAutoRunPage() {
  const session = await getServerSession(authOptions);
  const decision = decideLabScreen({
    flagValue: process.env.LAB_AUTORUN_ENABLED,
    providerExecutionEnabled: LAB_PROVIDER_EXECUTION_ENABLED,
    labEmail: process.env.DEVICE_RENDER_LAB_TEST_EMAIL,
    requesterRole: Role.Requester,
    session: session?.user
      ? { user: { id: session.user.id ?? null, role: session.user.role ?? null, email: session.user.email ?? null } }
      : null,
  });
  if (!decision.show || !session?.user) notFound();

  return (
    <main style={{ padding: 24 }}>
      <h1>Lab auto-run</h1>
      <LabRunPanel
        identity={{ userId: session.user.id ?? "", email: session.user.email ?? "", role: String(session.user.role ?? "") }}
        flagOn={process.env.LAB_AUTORUN_ENABLED === "true"}
        providerOn={LAB_PROVIDER_EXECUTION_ENABLED}
        testPlace={labTestPlaceFromEnv(process.env as Record<string, string | undefined>)}
        fileNames={(process.env.LAB_TEST_FILES ?? "").split(",").map((n) => n.trim()).filter((n) => n.length > 0)}
      />
    </main>
  );
}
