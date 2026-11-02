/**
 * management_jobs test isolation (no is_test column on that table).
 * - LINE_TEST_MODE process: never enqueues, never claims.
 * - Any process: a payload owned by test data is refused before INSERT, and
 *   claimNext skips test-owned rows.
 */
import { PostgresManagementJobRepository } from "@/repositories/postgres/PostgresManagementJobRepository";
import { ManagementJobKind } from "@/domain/enums/ManagementStatus";
import {
  ManagementTestIsolationError,
  managementJobTestOwnerSql,
} from "@/services/management/managementTestIsolation";

afterEach(() => { delete process.env.LINE_TEST_MODE; });

const jobRow = {
  id: "j1", kind: "reconcile_publication", dedupe_key: "reconcile:p1", payload: { publicationId: "p1" },
  state: "queued", attempts: 0, max_attempts: 8, run_after: new Date().toISOString(),
  claimed_by: null, claimed_at: null, last_error: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
};

function fakeDb(isTest: boolean) {
  const query = jest.fn(async (sql: string) => {
    if (/AS is_test/.test(sql)) return { rows: [{ is_test: isTest }] };
    if (/INSERT INTO management_jobs/.test(sql)) return { rows: [jobRow] };
    if (/UPDATE management_jobs/.test(sql)) return { rows: [jobRow] };
    return { rows: [] };
  });
  return { query };
}

const input = { kind: ManagementJobKind.ReconcilePublication, dedupeKey: "reconcile:p1", payload: { publicationId: "p1" } };

describe("PostgresManagementJobRepository test isolation", () => {
  it("refuses to enqueue anything in a LINE_TEST_MODE process, without touching the DB", async () => {
    process.env.LINE_TEST_MODE = "true";
    const db = fakeDb(false);
    const repo = new PostgresManagementJobRepository(db as never);
    await expect(repo.enqueue(input)).rejects.toBeInstanceOf(ManagementTestIsolationError);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("refuses a test-owned payload before INSERT in a normal process", async () => {
    const db = fakeDb(true);
    const repo = new PostgresManagementJobRepository(db as never);
    await expect(repo.enqueue(input)).rejects.toBeInstanceOf(ManagementTestIsolationError);
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO management_jobs/.test(String(sql)))).toBe(false);
    // Owner check receives the payload, resolving publication / content / user.
    const [sql, values] = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/management_publications/);
    expect(sql).toMatch(/line_accounts/);
    expect(sql).toMatch(/clip_requests/);
    expect(JSON.parse(String(values[0]))).toEqual({ publicationId: "p1" });
  });

  it("enqueues a real-owned payload normally", async () => {
    const db = fakeDb(false);
    const repo = new PostgresManagementJobRepository(db as never);
    const { created } = await repo.enqueue(input);
    expect(created).toBe(true);
  });

  it("never claims in a LINE_TEST_MODE process", async () => {
    process.env.LINE_TEST_MODE = "true";
    const db = fakeDb(false);
    const repo = new PostgresManagementJobRepository(db as never);
    expect(await repo.claimNext("w", new Date(), 120000)).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it("claim query excludes test-owned jobs in a normal process", async () => {
    const db = fakeDb(false);
    const repo = new PostgresManagementJobRepository(db as never);
    await repo.claimNext("w", new Date(), 120000);
    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).toContain("AND NOT " + managementJobTestOwnerSql("management_jobs"));
    expect(sql).toMatch(/\(\(state = \$4 AND run_after <= \$3\)\s+OR \(state = \$1 AND claimed_at < \$5\)\)/);
  });
});
