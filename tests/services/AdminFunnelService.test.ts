import {
  AdminFunnelService,
  FUNNEL_STAGES,
  buildFunnelReport,
  findBiggestDrop,
  problemFor,
  toFunnelUserRow,
  type FunnelUserRow,
} from "@/services/admin/AdminFunnelService";
import { resetTableExistsCache } from "@/lib/db/tableExists";

/**
 * The studio-journey funnel (Oct 2026).
 *
 * What matters: the furthest-stage rule (later evidence implies earlier
 * stages, so the funnel is monotonic and retroactive), the "recorded" count
 * stays the raw evidence, stop points add up to the cohort, and the SQL keeps
 * the rules that bit before — both-sides ::text joins, the backfill exclusion,
 * admins out of the cohort, and a stand-in when a tracking table is missing.
 */

const NOW = new Date("2026-10-17T05:00:00Z");
const KEYS = FUNNEL_STAGES.map((stage) => stage.key);

/** A per-user row as pg returns it, with evidence for the named stages. */
function pgRow(
  evidence: string[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    email: "u@example.com",
    created_at: "2026-10-10T03:00:00Z",
    cohort_week: "2026-10-05",
    last_active_at: "2026-10-16T05:00:00Z",
    quota_blocked: false,
    bought_package: false,
    uploaded_own: false,
    failed_step: null,
    phone_error: null,
  };
  for (const key of KEYS.slice(1)) row[key] = evidence.includes(key);
  return { ...row, ...extra };
}

function user(evidence: string[], extra: Record<string, unknown> = {}): FunnelUserRow {
  return toFunnelUserRow(pgRow(evidence, extra));
}

type Responder = (sql: string) => Record<string, unknown>[];

function stubDb(responder: Responder = () => [], tables: Record<string, boolean> = {}) {
  const calls: string[] = [];
  return {
    calls,
    query: jest.fn(async (text: string, values?: unknown[]) => {
      if (text.includes("to_regclass")) {
        const name = String(values?.[0] ?? "").replace("public.", "");
        return { rows: [{ present: tables[name] ?? true }] };
      }
      calls.push(text);
      return { rows: responder(text) };
    }),
  };
}

const flat = (sql: string) => sql.replace(/\s+/g, " ");

beforeEach(() => resetTableExistsCache());

describe("furthest-stage rule", () => {
  it("places a user at the furthest stage with evidence, implying the earlier ones", () => {
    // Finished video but no recorded sign-in or studio open (pre-tracking user).
    const row = user(["wrote_brief", "submitted_media", "main_video_made"]);
    expect(row.furthest).toBe(KEYS.indexOf("main_video_made"));
    const report = buildFunnelReport([row], { now: NOW, studioTracking: true });
    const signedIn = report.stages.find((s) => s.key === "signed_in")!;
    expect(signedIn.users).toBe(1);
    expect(signedIn.recorded).toBe(0);
  });

  it("never widens: every stage is at most the one before", () => {
    const users = [
      user([]),
      user(["signed_in"]),
      user(["signed_in", "opened_studio", "wrote_brief"]),
      user(["published"]),
      user(["opened_studio", "voice_ready"]),
    ];
    const { stages } = buildFunnelReport(users, { now: NOW, studioTracking: true });
    for (let i = 1; i < stages.length; i += 1) {
      expect(stages[i].users).toBeLessThanOrEqual(stages[i - 1].users);
    }
    expect(stages[0].users).toBe(5);
    expect(stages[stages.length - 1].users).toBe(1);
  });

  it("stop points account for every cohort user exactly once", () => {
    const users = [user([]), user(["wrote_brief"]), user(["wrote_brief"]), user(["published"])];
    const report = buildFunnelReport(users, { now: NOW, studioTracking: true });
    const total = report.stopPoints.reduce((sum, point) => sum + point.users, 0);
    expect(total).toBe(4);
    const brief = report.stopPoints[KEYS.indexOf("wrote_brief")];
    expect(brief.users).toBe(2);
    expect(brief.nextLabel).toBe("Submitted photos/clips");
    expect(report.stopPoints[KEYS.length - 1].nextLabel).toBeNull();
  });
});

describe("reasons and follow-up list", () => {
  it("names a failed job by the studio's words for the step", () => {
    const row = user(["submitted_media", "render_started"], {
      failed_step: "generating_base_video",
    });
    expect(problemFor(row)).toBe("Video failed during: Rendering the picture (phone)");
  });

  it("blames the free limit only for users who never got to submit", () => {
    expect(problemFor(user(["opened_studio"], { quota_blocked: true }))).toBe(
      "Hit the free-video limit"
    );
    expect(problemFor(user(["voice_ready"], { quota_blocked: true }))).toBeNull();
  });

  it("counts recently active users and median idle days per stop point", () => {
    const users = [
      user(["wrote_brief"], { last_active_at: "2026-10-16T05:00:00Z" }),
      user(["wrote_brief"], { last_active_at: "2026-10-07T05:00:00Z" }),
    ];
    const point = buildFunnelReport(users, { now: NOW, studioTracking: true }).stopPoints[
      KEYS.indexOf("wrote_brief")
    ];
    expect(point.activeRecently).toBe(1);
    expect(point.medianIdleDays).toBeCloseTo(5.5, 5);
  });

  it("lists unfinished users, most recently active first, and leaves out finishers", () => {
    const users = [
      user(["wrote_brief"], { email: "old@x", last_active_at: "2026-10-01T00:00:00Z" }),
      user(["published"], { email: "done@x" }),
      user(["voice_ready"], { email: "new@x", last_active_at: "2026-10-16T00:00:00Z" }),
    ];
    const { stuckUsers } = buildFunnelReport(users, { now: NOW, studioTracking: true });
    expect(stuckUsers.map((u) => u.email)).toEqual(["new@x", "old@x"]);
  });

  it("keeps package purchases beside the funnel, not in it", () => {
    const users = [user([], { bought_package: true }), user(["main_video_made"], { bought_package: true })];
    const report = buildFunnelReport(users, { now: NOW, studioTracking: true });
    expect(report.side.boughtPackage).toBe(2);
    expect(report.side.boughtAndMadeVideo).toBe(1);
    expect(report.madeVideoPct).toBe(50);
  });

  it("returns zeros, not NaN, for an empty cohort", () => {
    const report = buildFunnelReport([], { now: NOW, studioTracking: true });
    expect(report.totalUsers).toBe(0);
    expect(report.madeVideoPct).toBe(0);
    expect(report.biggestDrop).toBeNull();
  });
});

describe("findBiggestDrop", () => {
  it("picks the largest absolute loss and resolves ties to the earliest pair", () => {
    const drop = findBiggestDrop([
      { label: "a", users: 100 },
      { label: "b", users: 60 },
      { label: "c", users: 20 },
      { label: "d", users: 19 },
    ]);
    expect(drop).toMatchObject({ fromLabel: "a", toLabel: "b", dropped: 40, pct: 40 });
  });
});

describe("the SQL", () => {
  it("casts both sides of id joins, excludes backfill logins and admins", async () => {
    const db = stubDb();
    await new AdminFunnelService(db).getFunnelReport(new Date(0), new Date(1), NOW);
    const sql = flat(db.calls[0]);
    expect(sql).toContain("cr.id::text = j.request_id::text");
    expect(sql).toContain("jb.job_id::text = h.job_id::text");
    expect(sql).toContain("le.provider <> 'backfill'");
    expect(sql).toContain("COALESCE(u.role, 'requester') <> 'admin'");
    expect(sql).toContain("u.deleted_at IS NULL");
  });

  it("swaps in empty stand-ins when tracking tables are missing, instead of failing", async () => {
    const db = stubDb(() => [], { studio_events: false, user_login_events: false });
    const report = await new AdminFunnelService(db).getFunnelReport(new Date(0), new Date(1), NOW);
    const sql = db.calls[0];
    expect(sql).not.toMatch(/FROM studio_events se/);
    expect(sql).not.toMatch(/FROM user_login_events le/);
    expect(report.studioTracking).toBe(false);
  });

  it("parses pg's string counts in the daily trend", async () => {
    const db = stubDb(() => [{ date: "2026-10-16", signups: "3", logins: "2", studio_users: "5" }]);
    const trend = await new AdminFunnelService(db).getSignupLoginTrend(new Date(0), new Date(1));
    expect(trend).toEqual([{ date: "2026-10-16", signups: 3, logins: 2, studioUsers: 5 }]);
  });
});
