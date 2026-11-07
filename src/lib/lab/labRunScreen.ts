/**
 * The run screen's logic, kept out of the page: builds the entry's inputs from
 * the injected pieces and turns the entry's result into a plain message. With
 * the provider switch off (the production value), the entry refuses before any
 * request is made.
 */
import { runLabEntry, type LabEntryInput, type LabEntryResult } from "@/lib/lab/labEntry";
import { LAB_PROVIDER_EXECUTION_ENABLED } from "@/lib/lab/labGuards";

export interface LabScreenView {
  title: string;
  detail: string;
}

const REFUSAL_TEXT: Record<string, string> = {
  flag_off: "The lab auto-run is switched off.",
  provider_execution_disabled: "Paid provider work is switched off in this build. Nothing was sent.",
  not_lab_account: "This account is not the lab test account.",
  stopped: "The lab run was stopped by the kill switch. Nothing was sent.",
  no_test_place: "No lab test place is configured.",
  test_place_name_invalid: "The lab test place name is invalid.",
  test_place_latitude_invalid: "The lab test place latitude is invalid.",
  test_place_longitude_invalid: "The lab test place longitude is invalid.",
  run_over_cap: "This run would be over the per-run limit.",
  day_over_cap: "Today's lab budget is used up.",
  duplicate_run: "This run was already started.",
  ledger_unreadable: "The lab spend record could not be read, so nothing was started.",
  bad_amount: "The lab run amount is invalid.",
};

export function labRunView(result: LabEntryResult): LabScreenView {
  if (result.status === "refused") {
    return { title: "Not started", detail: REFUSAL_TEXT[result.reason] ?? "The lab run was refused." };
  }
  if (result.status === "disabled") {
    return { title: "Not started", detail: REFUSAL_TEXT.flag_off };
  }
  if (result.status === "ended") {
    if (result.ledger === "settled") return { title: "Finished", detail: "The lab run finished and its spend is recorded." };
    if (result.ledger === "released") return { title: "Stopped before any request", detail: "Nothing was sent; the reservation was released." };
    return { title: "Stopped or failed", detail: "Spend may have happened. The reservation is kept for a person to check." };
  }
  return { title: "Not started", detail: "The lab run did not start." };
}

/** Starts the run with the screen's pieces. Refuses before any request if the provider switch is off. */
export async function startLabRunFromScreen(
  input: Omit<LabEntryInput, "providerExecutionEnabled"> & { providerExecutionEnabled?: boolean }
): Promise<LabScreenView> {
  const providerExecutionEnabled = input.providerExecutionEnabled ?? LAB_PROVIDER_EXECUTION_ENABLED;
  const result = await runLabEntry({ ...input, providerExecutionEnabled });
  return labRunView(result);
}
