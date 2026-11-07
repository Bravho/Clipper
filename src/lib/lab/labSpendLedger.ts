/**
 * Credit ledger for lab runs: 350 credits per run and 1000 per day, counted
 * per Bangkok calendar day. Money is reserved BEFORE a run starts and then
 * either settled (charged) or released (never charged). Storage is injected:
 * tests use fake storage, and the runner uses createFileLedgerStorage so the
 * spend survives a restart.
 *
 * Guarantees (single runner process):
 *  - Atomic: every operation runs one at a time through one queue, so two
 *    concurrent reserve() calls cannot both pass the same check.
 *  - Single-use run ids: a run id can be reserved once, ever. A duplicate
 *    trigger for the same run is refused, even after it was settled or released.
 *  - Durable: the file storage writes a temp file and renames it over the old
 *    one, so a crash mid-write leaves the previous complete state in place.
 *  - Fails closed: if the stored state cannot be read or is malformed, no run starts.
 *
 * Not covered: two separate processes sharing one file. The runner is one process.
 */

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

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
  /** Runs still reserved (not yet settled or released). */
  reservations: LabReservation[];
  /** Every run id ever reserved, so an id is single-use. Optional for older files. */
  seenRunIds?: string[];
  /**
   * Runs whose spend-attempt marker was persisted BEFORE the first chargeable
   * request was dispatched. A run with no marker provably dispatched nothing.
   */
  spendAttempted?: string[];
  /**
   * What each run is linked to, server-side: the one request it created, and the
   * attempts claimed for it (and which of those were authorised to upload).
   * Keyed like the marker (owner::runId). Optional for older files.
   */
  runBindings?: Record<string, { requestId: string | null; attemptIds: string[]; uploadAuthorised: string[] }>;
  /** Claims the server holds that could not be released or linked. Read-only report; nothing expires them automatically. */
  unresolvedClaims?: { key: string; attemptId: string; at: string }[];
}

export interface LabLedgerStorage {
  /** Returns null when nothing has been stored yet. */
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
  if (v.seenRunIds !== undefined && (!Array.isArray(v.seenRunIds) || !v.seenRunIds.every((id) => typeof id === "string"))) {
    return false;
  }
  if (v.spendAttempted !== undefined && (!Array.isArray(v.spendAttempted) || !v.spendAttempted.every((id) => typeof id === "string"))) {
    return false;
  }
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
  | {
      ok: false;
      reason: "run_over_cap" | "day_over_cap" | "ledger_unreadable" | "bad_amount" | "duplicate_run";
    };

/**
 * Cross-process mutual exclusion for read-check-reserve-write. Held around
 * every ledger operation, so two runners (or two ledger objects) on the same
 * file cannot both pass the cap check. Acquire failure throws; callers fail closed.
 */
export interface LabLock {
  acquire(): Promise<() => Promise<void>>;
}

export const noLabLock: LabLock = { acquire: async () => async () => undefined };

export interface FileLockOptions {
  /** Give up waiting after this long (fail closed). */
  timeoutMs?: number;
  retryMs?: number;
}

/**
 * Lock file created with O_EXCL ('wx'), holding a random owner token.
 *
 * Safety rules:
 *  - Nothing is evicted because time passed. A slow live owner is never
 *    removed. If a lock is left by a crash, acquire fails closed and the lock
 *    is reported by inspectFileLock for a person to clear.
 *  - Release removes the file only when its token is still ours, so an old
 *    owner can never remove a replacement lock.
 *  - If the lock file cannot be written after it was created, it is removed
 *    (we created it, so we own it) and the acquire fails.
 */
export function createFileLock(lockPath: string, options: FileLockOptions = {}): LabLock {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retryMs = options.retryMs ?? 25;
  return {
    async acquire() {
      const deadline = Date.now() + timeoutMs;
      const token = randomUUID();
      for (;;) {
        let created = false;
        try {
          const handle = await fs.open(lockPath, "wx");
          created = true;
          try {
            await handle.writeFile(JSON.stringify({ token, pid: process.pid, at: new Date().toISOString() }));
          } finally {
            await handle.close();
          }
          return async () => {
            const current = await fs.readFile(lockPath, "utf8").catch(() => null);
            if (current === null) return;
            try {
              if (JSON.parse(current).token !== token) return; // not ours: leave it alone
            } catch {
              return; // unreadable: not provably ours, leave it
            }
            await fs.unlink(lockPath).catch(() => undefined);
          };
        } catch (error) {
          if (created) {
            // The file is ours but could not be written: remove our own partial lock.
            await fs.unlink(lockPath).catch(() => undefined);
            throw error;
          }
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (Date.now() >= deadline) throw new Error("lab_ledger_lock_timeout");
          await new Promise((r) => setTimeout(r, retryMs));
        }
      }
    },
  };
}

/** Read-only: is a lock file present, and who wrote it? For a person to check before clearing it. */
export async function inspectFileLock(lockPath: string): Promise<
  { held: false } | { held: true; pid: number | null; at: string | null; readable: boolean }
> {
  const raw = await fs.readFile(lockPath, "utf8").catch(() => null);
  if (raw === null) return { held: false };
  try {
    const parsed = JSON.parse(raw) as { pid?: number; at?: string };
    return { held: true, pid: parsed.pid ?? null, at: parsed.at ?? null, readable: true };
  } catch {
    return { held: true, pid: null, at: null, readable: false };
  }
}

export class LabSpendLedger {
  /** Every operation in this object waits for the one before it. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: LabLedgerStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly timeZone: string = LAB_LEDGER_TIME_ZONE,
    /** Shared across processes: pass the same lock file to every runner. */
    private readonly lock: LabLock = noLabLock
  ) {}

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const unlock = await this.lock.acquire();
      try {
        return await task();
      } finally {
        await unlock();
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<LabLedgerState | null> {
    let raw: unknown;
    try {
      raw = await this.storage.read();
    } catch {
      return null;
    }
    if (raw === null || raw === undefined) return { charged: {}, reservations: [], seenRunIds: [] };
    return isState(raw) ? raw : null;
  }

  /**
   * Today's use: credits charged today, plus EVERY outstanding reservation,
   * whatever day it was made on. A run still reserved after midnight (crash,
   * unknown spend) keeps counting, so day rollover cannot free money that may
   * already be spent.
   */
  private usedOn(state: LabLedgerState, dayKey: string): number {
    return (
      (state.charged[dayKey] ?? 0) +
      state.reservations.reduce((sum, r) => sum + r.credits, 0)
    );
  }

  /** Reserve the quoted cost of one run, if it fits both caps today. */
  reserve(runId: string, credits: number): Promise<ReserveResult> {
    return this.exclusive(async (): Promise<ReserveResult> => {
      if (!Number.isFinite(credits) || credits <= 0) return { ok: false, reason: "bad_amount" };
      if (credits > LAB_LEDGER_PER_RUN_CAP) return { ok: false, reason: "run_over_cap" };
      if (!runId) return { ok: false, reason: "duplicate_run" };

      const state = await this.load();
      if (!state) return { ok: false, reason: "ledger_unreadable" };

      const seen = state.seenRunIds ?? [];
      if (seen.includes(runId) || state.reservations.some((r) => r.runId === runId)) {
        return { ok: false, reason: "duplicate_run" };
      }

      const dayKey = dayKeyFor(this.now(), this.timeZone);
      if (this.usedOn(state, dayKey) + credits > LAB_LEDGER_PER_DAY_CAP) {
        return { ok: false, reason: "day_over_cap" };
      }

      state.reservations.push({ runId, dayKey, credits });
      state.seenRunIds = [...seen, runId];
      try {
        await this.storage.write(state);
      } catch {
        return { ok: false, reason: "ledger_unreadable" };
      }
      return { ok: true };
    }).catch((): ReserveResult => ({ ok: false, reason: "ledger_unreadable" }));
  }

  /** The run was charged (submitted to the server). Move its reservation into the day total. */
  settle(runId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (!state) return false;
      const found = state.reservations.find((r) => r.runId === runId);
      if (!found) return false;
      state.reservations = state.reservations.filter((r) => r.runId !== runId);
      state.charged[found.dayKey] = (state.charged[found.dayKey] ?? 0) + found.credits;
      await this.storage.write(state);
      return true;
    }).catch(() => false);
  }

  /**
   * Free a reservation. ONLY for a run known to have spent nothing: it failed
   * or was cancelled before the first charging call. Anything uncertain (a crash,
   * a timeout after submit, an unknown response) must stay reserved.
   */
  /**
   * Persist the spend-attempt marker for a run. MUST succeed before any
   * chargeable request is dispatched. Returns false if the marker could not be
   * persisted, in which case the caller must not dispatch.
   */
  /** Links a run to the one request it created. Refused if it is linked to another request. */
  bindRequest(runId: string, requestId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (!state) return false;
      if (!state.reservations.some((r) => r.runId === runId) && !(state.spendAttempted ?? []).includes(runId)) return false;
      const bindings = state.runBindings ?? {};
      const current = bindings[runId] ?? { requestId: null, attemptIds: [], uploadAuthorised: [] };
      if (current.requestId !== null && current.requestId !== requestId) return false;
      state.runBindings = { ...bindings, [runId]: { ...current, requestId } };
      await this.storage.write(state);
      return true;
    }).catch(() => false);
  }

  /** Links an attempt claimed for this run. Refused unless the run is linked to `requestId`. */
  bindAttempt(runId: string, requestId: string, attemptId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (!state) return false;
      const bindings = state.runBindings ?? {};
      const current = bindings[runId];
      if (!current || current.requestId !== requestId) return false;
      if (current.attemptIds.includes(attemptId)) return true;
      state.runBindings = { ...bindings, [runId]: { ...current, attemptIds: [...current.attemptIds, attemptId] } };
      await this.storage.write(state);
      return true;
    }).catch(() => false);
  }

  /** Records that an attempt's upload was authorised (before any stop). Refused for an unbound attempt. */
  authoriseUpload(runId: string, attemptId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (!state) return false;
      const bindings = state.runBindings ?? {};
      const current = bindings[runId];
      if (!current || !current.attemptIds.includes(attemptId)) return false;
      if (current.uploadAuthorised.includes(attemptId)) return true;
      state.runBindings = { ...bindings, [runId]: { ...current, uploadAuthorised: [...current.uploadAuthorised, attemptId] } };
      await this.storage.write(state);
      return true;
    }).catch(() => false);
  }

  /** Records a claim that could not be linked and could not be released, for a person to resolve. */
  recordUnresolvedClaim(key: string, attemptId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (!state) return false;
      state.unresolvedClaims = [...(state.unresolvedClaims ?? []), { key, attemptId, at: new Date().toISOString() }];
      await this.storage.write(state);
      return true;
    }).catch(() => false);
  }

  /** The run's links, or null when unknown. Read-only. */
  getBinding(runId: string): Promise<{ requestId: string | null; attemptIds: string[]; uploadAuthorised: string[] } | null> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (!state) return null;
      return (state.runBindings ?? {})[runId] ?? { requestId: null, attemptIds: [], uploadAuthorised: [] };
    }).catch(() => null);
  }

  markSpendAttempt(runId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (!state) return false;
      if (!state.reservations.some((r) => r.runId === runId)) return false;
      const marked = state.spendAttempted ?? [];
      if (marked.includes(runId)) return true;
      state.spendAttempted = [...marked, runId];
      await this.storage.write(state);
      return true;
    }).catch(() => false);
  }

  /**
   * true: a marker exists, so spend may have happened.
   * false: no marker, so nothing was dispatched.
   * null: the state could not be read, so the answer is unknown.
   */
  hasSpendAttempt(runId: string): Promise<boolean | null> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (!state) return null;
      return (state.spendAttempted ?? []).includes(runId);
    }).catch(() => null);
  }

  /**
   * Free a reservation. Refused when a spend-attempt marker exists for the run:
   * the marker means a chargeable request may have been sent.
   */
  release(runId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (!state) return false;
      if ((state.spendAttempted ?? []).includes(runId)) return false;
      const before = state.reservations.length;
      state.reservations = state.reservations.filter((r) => r.runId !== runId);
      if (state.reservations.length === before) return false;
      await this.storage.write(state);
      return true;
    }).catch(() => false);
  }

  /** Credits charged plus reserved for today (for a status line). */
  usedToday(): Promise<number | null> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (!state) return null;
      return this.usedOn(state, dayKeyFor(this.now(), this.timeZone));
    }).catch(() => null);
  }
}

/**
 * File-backed storage for the runner: JSON in one file, written atomically
 * (temp file in the same folder, then rename over the old file).
 */
export function createFileLedgerStorage(filePath: string): LabLedgerStorage {
  return {
    async read() {
      try {
        return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async write(state) {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
      await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
      // On Windows a rename can fail briefly while another process has the file open
      // (for example a virus scanner). Retry a few times; if it still fails, remove our
      // temporary file and fail: the previous complete state stays in place.
      for (let attempt = 1; ; attempt++) {
        try {
          await fs.rename(tmp, filePath);
          return;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          const transient = code === "EPERM" || code === "EBUSY" || code === "EACCES";
          if (!transient || attempt >= 5) {
            await fs.unlink(tmp).catch(() => undefined);
            throw error;
          }
          await new Promise((r) => setTimeout(r, 20 * attempt));
        }
      }
    },
  };
}

/**
 * Read-only report of reservations that were never settled or released. These
 * are money that may or may not have been spent. Nothing is changed here.
 */
export async function unresolvedReservations(storage: LabLedgerStorage): Promise<{
  count: number;
  totalCredits: number;
  runs: LabReservation[];
} | null> {
  let raw: unknown;
  try {
    raw = await storage.read();
  } catch {
    return null;
  }
  if (raw === null || raw === undefined) return { count: 0, totalCredits: 0, runs: [] };
  if (!isState(raw)) return null;
  return {
    count: raw.reservations.length,
    totalCredits: raw.reservations.reduce((sum, r) => sum + r.credits, 0),
    runs: raw.reservations,
  };
}
