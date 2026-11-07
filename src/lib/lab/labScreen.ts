/**
 * Lab screen entry decision. The lab page is shown only when the flag is on,
 * provider execution is enabled in code, and the signed-in account is the exact
 * lab account. Otherwise the page answers "not found", the same as a missing page.
 */
import { decideLabIdentity } from "@/lib/lab/labSteps";

export type LabScreenDecision = { show: true } | { show: false };

export function decideLabScreen(input: {
  flagValue: string | undefined;
  providerExecutionEnabled: boolean;
  labEmail: string | undefined;
  requesterRole: string;
  session: Parameters<typeof decideLabIdentity>[0]["session"];
}): LabScreenDecision {
  if (!input.providerExecutionEnabled) return { show: false };
  const identity = decideLabIdentity({
    flagValue: input.flagValue,
    labEmail: input.labEmail,
    requesterRole: input.requesterRole,
    session: input.session,
  });
  return identity.ok ? { show: true } : { show: false };
}
