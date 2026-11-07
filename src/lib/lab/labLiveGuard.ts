/**
 * Polled live guard for the phone. Starts STOPPED and opens only after a
 * successful check says the lab is allowed; a failed or unanswered check closes
 * it again. The server's own gates stay authoritative for every request.
 */
import type { LabLiveGuard } from "@/lib/lab/labGuards";

export interface PolledGuard extends LabLiveGuard {
  refresh(): Promise<void>;
}

export function createPolledGuard(check: () => Promise<boolean>): PolledGuard {
  let allowed = false; // fail closed until a check says yes
  return {
    isStopped: () => !allowed,
    async refresh() {
      try {
        allowed = (await check()) === true;
      } catch {
        allowed = false;
      }
    },
  };
}
