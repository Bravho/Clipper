/**
 * Credit ledger for lab runs: 350 credits per run and 1000 per day, counted
 * per Bangkok calendar day. Money is reserved BEFORE a run starts and then
 * either settled (charged) or released (never charged). Storage is injected, so
 * tests use fake storage and the runner can persist to a local file.
 *
 * Fails closed: if the stored state cannot be read or is malformed, no run
 * starts.
 */

export const LAB_LEDGER_PER_RUN_CAP = 350;
export const LAB_LEDGER_PER_DAY_CAP = 1000;
export const LAB_LEDGER_TIME_ZONE = "Asia/Bangkok";

export interface LabReservation {
  runId: string;
  dayKey: string;
  credits: number;
}

export interface LabLedgerState {
  /** Credits charged per day (after settle). */
  charged: Record<string, number>;
  reservations: LabReservation[];
}

export interface LabLedgerStorage {
  read(): Promise<unknown>;
  write(state: LabLedgerState): Promise<void>;
}

export function dayKeyFor(now: Date, timeZone: string = LAB_LEDGER_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isState(value: unknown): value is LabLedgerState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<LabLedgerState>;
  if (typeof v.charged !== "object" || v.charged === null) return false;
  if (!Object.values(v.charged).every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) return false;
  if (!Array.isArray(v.reservations)) return false;
  return v.reservations.every(
    (r) =>
      typeof r === "object" &&
      r !== null &&
      typeof r.runId === "string" &&
      typeof r.dayKey === "string" &&
      typeof r.credits === "number" &&
      Number.isFinite(r.credits) &&
      r.credits >= 0
  );
}

export type ReserveResult =
  | { ok: true }
  | { ok: false; reason: "run_over_cap" | "day_over_cap" | "ledger_unreadable" | "bad_amount" };

export class LabSpendLedger {
  constructor(
    private readonly storage: LabLedgerStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly timeZone: string = LAB_LEDGER_TIME_ZONE
  ) {}

  private async load(): Promise<LabLedgerState | null> {
    let raw: unknown;
    try {
      raw = await this.storage.read();
    } catch {
      return null;
    }
    if (raw === null || raw === undefined) return { charged: {}, reservations: [] };
    return isState(raw) ? raw : null;
  }

  /** Reserve the quoted cost of one run, if it fits both caps today. */
  async reserve(runId: string, credits: number): Promise<ReserveResult> {
    if (!Number.isFinite(credits) || credits <= 0) return { ok: false, reason: "bad_amount" };
    if (credits > LAB_LEDGER_PER_RUN_CAP) return { ok: false, reason: "run_over_cap" };

    const state = await this.load();
    if (!state) return { ok: false, reason: "ledger_unreadable" };

    const dayKey = dayKeyFor(this.now(), this.timeZone);
    const usedToday =
      (state.charged[dayKey] ?? 0) +
      state.reservations.filter((r) => r.dayKey === dayKey).reduce((sum, r) => sum + r.credits, 0);
    if (usedToday + credits > LAB_LEDGER_PER_DAY_CAP) return { ok: false, reason: "day_over_cap" };

    state.reservations.push({ runId, dayKey, credits });
    try {
      await this.storage.write(state);
    } catch {
      return { ok: false, reason: "ledger_unreadable" };
    }
    return { ok: true };
  }

  /** The run was charged (submitted to the server). Move its reservation into the day total. */
  async settle(runId: string): Promise<boolean> {
    const state = await this.load();
    if (!state) return false;
    const found = state.reservations.find((r) => r.runId === runId);
    if (!found) return false;
    state.reservations = state.reservations.filter((r) => r.runId !== runId);
    state.charged[found.dayKey] = (state.charged[found.dayKey] ?? 0) + found.credits;
    await this.storage.write(state);
    return true;
  }

  /** The run was never charged (failed or cancelled before submit). Free the reservation. */
  async release(runId: string): Promise<boolean> {
    const state = await this.load();
    if (!state) return false;
    const before = state.reservations.length;
    state.reservations = state.reservations.filter((r) => r.runId !== runId);
    if (state.reservations.length === before) return false;
    await this.storage.write(state);
    return true;
  }

  /** Credits charged plus reserved for today (for a status line). */
  async usedToday(): Promise<number | null> {
    const state = await this.load();
    if (!state) return null;
    const dayKey = dayKeyFor(this.now(), this.timeZone);
    return (
      (state.charged[dayKey] ?? 0) +
      state.reservations.filter((r) => r.dayKey === dayKey).reduce((sum, r) => sum + r.credits, 0)
    );
  }
}
