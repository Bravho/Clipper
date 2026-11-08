import { LAB_LEDGER_PER_RUN_CAP as BROWSER_CAP } from "@/lib/lab/labLimits";
import { LAB_LEDGER_PER_RUN_CAP as SERVER_CAP } from "@/lib/lab/labSpendLedger";

describe("lab per-run cap", () => {
  it("the browser-safe copy matches the server ledger", () => {
    expect(BROWSER_CAP).toBe(SERVER_CAP);
  });
});
