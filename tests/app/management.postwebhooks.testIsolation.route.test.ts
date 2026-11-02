/**
 * The provider webhook must not undo its dedupe row (and must not ask the
 * provider to retry) when the reconcile job is refused for test data.
 */
const query = jest.fn(async (sql: string, _values?: unknown[]) =>
  /INSERT INTO management_webhook_events/.test(sql) ? { rows: [{ id: "evt-row" }] } : { rows: [] });
jest.mock("@/lib/db", () => ({ pool: { query: (sql: string, v?: unknown[]) => query(sql, v) } }));
const enqueue = jest.fn();
jest.mock("@/repositories", () => ({ managementJobRepository: { enqueue: (...a: unknown[]) => enqueue(...a) } }));
jest.mock("@/services/social-publishing", () => ({
  POST_FOR_ME_PROVIDER_KEY: "post_for_me",
  socialPublishingProvider: {
    verifyAndParseWebhook: () => ({ id: "e1", type: "social.post.updated", payload: { external_id: "11111111-1111-4111-8111-111111111111" } }),
  },
}));

import { POST } from "@/app/api/management/postwebhooks/route";
import { ManagementTestIsolationError } from "@/services/management/managementTestIsolation";

beforeEach(() => { query.mockClear(); enqueue.mockReset(); });

function call() {
  return POST(new Request("http://x/api/management/postwebhooks", { method: "POST", body: "{}" }));
}

it("acknowledges and keeps the dedupe row when the job is refused for test data", async () => {
  enqueue.mockRejectedValue(new ManagementTestIsolationError());
  const res = await call();
  expect(res.status).toBe(200);
  expect(query.mock.calls.some(([sql]) => /DELETE FROM management_webhook_events/.test(String(sql)))).toBe(false);
});

it("still returns 500 and undoes the dedupe row on a real enqueue failure", async () => {
  enqueue.mockRejectedValue(new Error("db down"));
  const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const res = await call();
  spy.mockRestore();
  expect(res.status).toBe(500);
  expect(query.mock.calls.some(([sql]) => /DELETE FROM management_webhook_events/.test(String(sql)))).toBe(true);
});
