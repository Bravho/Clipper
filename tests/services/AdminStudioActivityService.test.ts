import {
  AdminStudioActivityService,
  PIPELINE_POINTS,
  buildStepRows,
  pipelineStepLabel,
} from "@/services/admin/AdminStudioActivityService";
import { STUDIO_STEPS } from "@/config/studioEvents";
import { resetTableExistsCache } from "@/lib/db/tableExists";

beforeEach(() => resetTableExistsCache());

describe("buildStepRows", () => {
  it("returns every studio step in order, filling missing ones with zeros", () => {
    const rows = buildStepRows(
      [{ step: "audio", users: "4", views: "9", visits: "5", ended_here: "2", median_seconds: "75.5" }],
      []
    );
    expect(rows.map((row) => row.step)).toEqual([...STUDIO_STEPS]);
    const audio = rows.find((row) => row.step === "audio")!;
    expect(audio).toMatchObject({ users: 4, views: 9, visits: 5, visitsEndedHere: 2, medianSeconds: 75.5 });
    expect(rows[0]).toMatchObject({ users: 0, medianSeconds: null });
  });

  it("puts each action under its own step, most frequent first, and drops unknown ones", () => {
    const rows = buildStepRows(
      [],
      [
        { action: "voice_approved", count: "3", users: "3", requests: "3" },
        { action: "voice_regenerated", count: "8", users: "2", requests: "3" },
        { action: "retired_action", count: "99", users: "1", requests: "1" },
      ]
    );
    const audio = rows.find((row) => row.step === "audio")!;
    expect(audio.actions.map((a) => a.action)).toEqual(["voice_regenerated", "voice_approved"]);
    expect(rows.flatMap((row) => row.actions).some((a) => a.action === ("retired_action" as never))).toBe(false);
  });
});

describe("getReport", () => {
  it("runs without studio_events, reading the pipeline tables only", async () => {
    const calls: string[] = [];
    const db = {
      query: jest.fn(async (text: string) => {
        if (text.includes("to_regclass")) return { rows: [{ present: false }] };
        calls.push(text);
        if (text.includes("AS new_users,") && text.includes("AS briefs")) {
          return { rows: [{ new_users: "7", briefs: "5", submissions: "4", main_videos: "2", finished: "1" }] };
        }
        if (text.includes("FROM device_render_attempts a") && text.includes("GROUP BY 1, 2")) {
          return {
            rows: [
              { platform: "ios", stage: "montage", attempts: "3", completed: "2", failed: "1", abandoned: "0", median_seconds: "40" },
            ],
          };
        }
        if (text.includes("current_step NOT IN")) {
          return { rows: [{ step: "awaiting_voice_approval", waiting: "6" }] };
        }
        return { rows: [] };
      }),
    };
    const report = await new AdminStudioActivityService(db).getReport({
      from: new Date(0),
      to: new Date(1),
    });
    expect(report.studioTracking).toBe(false);
    expect(calls.some((sql) => /FROM studio_events se/.test(sql))).toBe(false);
    expect(report.totals).toMatchObject({
      newUsers: 7,
      submissions: 4,
      mainVideos: 2,
      phoneRendersOk: 2,
      phoneRendersFailed: 1,
    });
    const voiceGate = report.pipeline.find((row) => row.key === "awaiting_voice_approval")!;
    expect(voiceGate.waitingNow).toBe(6);
    expect(voiceGate.kind).toBe("decision");
  });
});

describe("pipeline labels", () => {
  it("covers the studio's pipeline points and falls back to readable words", () => {
    expect(PIPELINE_POINTS.length).toBeGreaterThan(8);
    expect(pipelineStepLabel("generating_voice")).toBe("Making the voice (AI)");
    expect(pipelineStepLabel("some_legacy_step")).toBe("some legacy step");
  });
});
