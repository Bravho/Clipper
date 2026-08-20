import fs from "fs";
import path from "path";
import { formatChartValue, formatDuration } from "@/features/admin/formatDuration";
import { tableExists, resetTableExistsCache } from "@/lib/db/tableExists";

const ROOT = path.join(__dirname, "..", "..");
const ADMIN_PAGES = path.join(ROOT, "src", "app", "(auth)", "admin");

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

/**
 * Regression guard for the bug that took every analytics page down in production.
 *
 * `GroupedBarChart` originally accepted `formatValue?: (n: number) => string`.
 * Every admin page is a SERVER component, and React cannot serialise a function
 * across the server/client boundary, so passing one threw "Functions cannot be
 * passed directly to Client Components" at REQUEST time — the admin saw only
 * "Application error: a server-side exception has occurred" and a digest.
 *
 * Nothing caught it earlier: `tsc` is satisfied, `next build` is satisfied, and
 * the page only dies when somebody opens it. A source-level check is therefore
 * the only cheap guard. If a function prop reappears on one of these client
 * charts, this fails in CI rather than on someone's phone.
 */
describe("server pages never pass functions to client chart components", () => {
  const CLIENT_CHARTS = [
    "GroupedBarChart",
    "TimeSeriesChart",
    "HourHeatmap",
    "DateRangeBar",
  ];

  it("keeps every client chart's props serialisable", () => {
    const offenders: string[] = [];

    for (const file of walk(ADMIN_PAGES)) {
      const src = fs.readFileSync(file, "utf8");
      // A client page may pass functions freely — the boundary is already crossed.
      if (/^["']use client["']/.test(src.trimStart())) continue;

      for (const chart of CLIENT_CHARTS) {
        const elements = src.match(new RegExp(`<${chart}\\b[\\s\\S]*?/>`, "g")) ?? [];
        for (const element of elements) {
          const arrowProp = /\w+=\{\s*(\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/.test(element);
          const functionProp = /\w+=\{\s*function\b/.test(element);
          if (arrowProp || functionProp) {
            offenders.push(`${path.relative(ROOT, file)} → <${chart}>`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("formatChartValue", () => {
  it("formats durations exactly as the tables beside the chart do", () => {
    expect(formatChartValue(1400, "duration")).toBe(formatDuration(1400));
    expect(formatChartValue(930000, "duration")).toBe("15m 30s");
  });

  it("defaults to a thousands-separated number", () => {
    expect(formatChartValue(12345)).toBe((12345).toLocaleString());
  });

  it("renders an em dash rather than NaN for a missing duration", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

/**
 * The second production failure: migration 028's tables were absent from the
 * database the app was pointed at, so `relation "user_login_events" does not
 * exist` took the funnel, approvals and capacity pages down entirely.
 */
describe("tableExists", () => {
  beforeEach(() => resetTableExistsCache());

  it("reports a present table and caches the positive", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ present: true }] });
    const db = { query };

    expect(await tableExists("user_login_events", db)).toBe(true);
    expect(await tableExists("user_login_events", db)).toBe(true);
    // Cached — the second call must not hit the database again.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("re-checks a missing table, so the page self-heals once the migration runs", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ present: false }] })
      .mockResolvedValueOnce({ rows: [{ present: true }] });
    const db = { query };

    expect(await tableExists("pipeline_gate_events", db)).toBe(false);
    expect(await tableExists("pipeline_gate_events", db)).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("treats a failing probe as missing rather than throwing", async () => {
    const db = { query: jest.fn().mockRejectedValue(new Error("permission denied")) };
    await expect(tableExists("render_worker_samples", db)).resolves.toBe(false);
  });
});

/**
 * The third production failure mode: a page threw, and Next replaced the
 * message with a digest, so the only readable symptom was
 * "Digest: 1258508842". `attempt()` keeps the message on the server side where
 * the page can render it.
 */
describe("attempt", () => {
  const { attempt } = jest.requireActual("@/features/admin/attempt");

  beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it("passes through a successful load", async () => {
    await expect(attempt(async () => 42, "Thing")).resolves.toEqual({ ok: true, data: 42 });
  });

  it("captures the message and labels it, instead of throwing", async () => {
    const result = await attempt(async () => {
      throw new Error('relation "user_login_events" does not exist');
    }, "Funnel report");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toBe(
      'Funnel report: relation "user_login_events" does not exist'
    );
    expect(result.error.stack).toContain("Error");
  });

  it("keeps the Postgres error code so the page can name the remedy", async () => {
    const pgError = Object.assign(new Error("column x does not exist"), {
      code: "42703",
      detail: "somewhere",
    });
    const result = await attempt(async () => {
      throw pgError;
    }, "Pipeline step stats");

    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("42703");
    expect(result.error.detail).toContain("somewhere");
  });

  it("still logs, so the server log remains the record", async () => {
    await attempt(async () => {
      throw new Error("boom");
    }, "Thing");
    expect(console.error).toHaveBeenCalled();
  });
});

/**
 * Regression guard for the bug that killed the funnel and pipeline pages twice.
 *
 * `clip_requests.id`, `video_generation_jobs.id` and `.request_id` are uuid in
 * some deployments and text in others (migrations 006 and 019 inspect
 * `information_schema` precisely because of this). A join that casts only ONE
 * side — `cr.id::text = j.request_id` — is `text = uuid` wherever the other side
 * is a uuid, and Postgres raises `operator does not exist` (42883).
 *
 * It cannot be caught by types, by `next build`, or by a test against a database
 * whose columns happen to be text: it is a property of the SQL string. So the
 * SQL strings are what we check.
 */

/**
 * Drop JS block/line comments and SQL `--` comments before scanning SQL text.
 *
 * Without this the guard flags its own documentation: the comment explaining the
 * rule necessarily quotes the broken form as an example.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/--[^\n]*/g, " ");
}

describe("id joins cast both sides, never one", () => {
  const SERVICES = path.join(ROOT, "src", "services", "admin");
  /** `alias.column [::text] = alias.column [::text]` */
  const COMPARISON = /\b(\w+)\.(\w+)(::text)?\s*=\s*(\w+)\.(\w+)(::text)?/g;
  const ID_COLUMN = /(^id$|_id$)/;

  it("has no one-sided ::text cast on an id comparison", () => {
    const offenders: string[] = [];

    for (const file of fs.readdirSync(SERVICES).filter((f) => f.endsWith(".ts"))) {
      const src = stripComments(fs.readFileSync(path.join(SERVICES, file), "utf8"));
      for (const m of src.matchAll(COMPARISON)) {
        const [full, , leftCol, leftCast, , rightCol, rightCast] = m;
        // Only id-ish columns carry the uuid/text ambiguity.
        if (!ID_COLUMN.test(leftCol) || !ID_COLUMN.test(rightCol)) continue;
        if (Boolean(leftCast) !== Boolean(rightCast)) {
          offenders.push(`${file}: ${full.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("actually detects a one-sided cast", () => {
    // Proof the matcher works — otherwise the test above could pass by accident.
    const sample = "JOIN clip_requests cr ON cr.id::text = j.request_id";
    const found = [...sample.matchAll(COMPARISON)].filter(
      ([, , l, lc, , r, rc]) =>
        ID_COLUMN.test(l) && ID_COLUMN.test(r) && Boolean(lc) !== Boolean(rc)
    );
    expect(found).toHaveLength(1);
  });
});
