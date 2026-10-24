import {
  AdminRequestJourneyService,
  deriveLatestStep,
  factsFromJob,
  journeySteps,
  JOURNEY_STEP_KEYS,
  type JourneyFacts,
} from "@/services/admin/AdminRequestJourneyService";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import { resetTableExistsCache } from "@/lib/db/tableExists";

beforeEach(() => resetTableExistsCache());

const created = new Date("2026-10-01T03:00:00Z");

function facts(overrides: Partial<JourneyFacts> = {}): JourneyFacts {
  return {
    status: RequestStatus.Draft,
    createdAt: created,
    submittedAt: null,
    hasJob: false,
    jobCreatedAt: null,
    currentStep: null,
    failedAtStep: null,
    stepFirstAt: {},
    hasStoryboard: false,
    contentApproved: false,
    hasVoice: false,
    voiceApproved: false,
    productionStarted: false,
    captionedRatios: [],
    downloadedAt: null,
    transferredAt: null,
    publishedAt: null,
    postedFromStudio: false,
    ...overrides,
  };
}

describe("deriveLatestStep", () => {
  it("a bare draft is at the brief, timed at creation", () => {
    const step = deriveLatestStep(facts());
    expect(step).toMatchObject({ key: "brief", rank: 0, failed: false });
    expect(step.at).toEqual(created);
  });

  it("uses the first time a step appears in the step history", () => {
    const voiceAt = new Date("2026-10-01T03:05:00Z");
    const step = deriveLatestStep(
      facts({
        status: RequestStatus.Submitted,
        hasJob: true,
        stepFirstAt: {
          [VideoGenerationStep.AwaitingContentApproval]: new Date("2026-10-01T03:01:00Z"),
          [VideoGenerationStep.GeneratingVoice]: new Date("2026-10-01T03:02:00Z"),
          [VideoGenerationStep.AwaitingVoiceApproval]: voiceAt,
        },
      })
    );
    expect(step.key).toBe("voiced");
    expect(step.at).toEqual(voiceAt);
  });

  it("falls back to job columns when the history is missing (older jobs)", () => {
    const step = deriveLatestStep(
      facts({ hasJob: true, hasStoryboard: true, contentApproved: true, hasVoice: true, voiceApproved: true, productionStarted: true, captionedRatios: ["9:16"] })
    );
    expect(step.key).toBe("rendered");
    expect(step.at).toBeNull();
  });

  it("several captioned shapes mean framing is done", () => {
    expect(deriveLatestStep(facts({ hasJob: true, captionedRatios: ["9:16", "1:1"] })).key).toBe("framed");
  });

  it("downloads, Channel Management and publishing rank after the render", () => {
    const at = new Date("2026-10-02T00:00:00Z");
    expect(deriveLatestStep(facts({ captionedRatios: ["9:16"], downloadedAt: at })).key).toBe("downloaded");
    expect(deriveLatestStep(facts({ downloadedAt: at, transferredAt: at })).key).toBe("transferred");
    expect(deriveLatestStep(facts({ transferredAt: at, publishedAt: at })).key).toBe("published");
    expect(deriveLatestStep(facts({ postedFromStudio: true })).key).toBe("published");
  });

  it("flags a failed pipeline with the step that failed", () => {
    const step = deriveLatestStep(
      facts({ hasJob: true, hasStoryboard: true, currentStep: VideoGenerationStep.Failed, failedAtStep: VideoGenerationStep.GeneratingVoice })
    );
    expect(step).toMatchObject({ key: "storyboarded", failed: true, failedAtStep: "generating_voice" });
  });

  it("journeySteps lists every step in order", () => {
    const steps = journeySteps(facts({ status: RequestStatus.Submitted }));
    expect(steps.map((s) => s.key)).toEqual(JOURNEY_STEP_KEYS);
    expect(steps.filter((s) => s.reached).map((s) => s.key)).toEqual(["brief", "submitted"]);
  });
});

describe("factsFromJob", () => {
  it("reads the job and the earliest history entry per step", () => {
    const job = {
      id: "job-1",
      createdAt: created,
      currentStep: VideoGenerationStep.AwaitingOverlayApproval,
      failedAtStep: null,
      storyboard: "[]",
      contentApprovedBy: "u1",
      processedVoiceAssetId: "a-voice",
      voiceApprovedBy: "u1",
      approvedScenePlan: "[]",
      captionedExport_9_16_assetId: "a-916",
      captionedExport_16_9_assetId: null,
      captionedExport_1_1_assetId: null,
      captionedExport_4_5_assetId: null,
      publishingDrafts: [{ platform: "tiktok", title: "", caption: "", hashtags: [], status: "posted" }],
    } as unknown as VideoGenerationJob;
    const f = factsFromJob({
      request: { status: RequestStatus.Submitted, createdAt: created, submittedAt: created },
      job,
      history: [
        { id: "h2", jobId: "job-1", requestId: "r1", step: VideoGenerationStep.AwaitingOverlayApproval, sceneIndex: null, createdAt: new Date("2026-10-01T05:00:00Z") },
        { id: "h1", jobId: "job-1", requestId: "r1", step: VideoGenerationStep.AwaitingOverlayApproval, sceneIndex: null, createdAt: new Date("2026-10-01T04:00:00Z") },
      ],
    });
    expect(f.captionedRatios).toEqual(["9:16"]);
    expect(f.stepFirstAt.awaiting_overlay_approval).toEqual(new Date("2026-10-01T04:00:00Z"));
    expect(f.postedFromStudio).toBe(true);
    expect(deriveLatestStep(f).key).toBe("published");
  });
});

describe("AdminRequestJourneyService (read-only queries)", () => {
  function fakeDb(handlers: Record<string, Record<string, unknown>[]>, present = true) {
    const sql: string[] = [];
    const db = {
      query: jest.fn(async (text: string) => {
        sql.push(text);
        if (text.includes("to_regclass")) return { rows: [{ present }] };
        for (const [needle, rows] of Object.entries(handlers)) {
          if (text.includes(needle)) return { rows };
        }
        return { rows: [] };
      }),
    };
    return { db, sql };
  }

  const req = { id: "r1", status: RequestStatus.Submitted, createdAt: created, submittedAt: created };

  it("batches the latest step for many requests and only ever SELECTs", async () => {
    const { db, sql } = fakeDb({
      "FROM video_generation_jobs": [
        { request_id: "r1", job_id: "j1", current_step: "awaiting_overlay_approval", created_at: created, has_storyboard: true, captioned_export_9_16_asset_id: "a1" },
      ],
      "FROM video_generation_step_history": [
        { job_id: "j1", step: "awaiting_overlay_approval", first_at: "2026-10-01T04:00:00Z" },
      ],
      "video_downloaded": [{ request_id: "r1", last_at: "2026-10-01T06:00:00Z", n: 2 }],
    });
    const service = new AdminRequestJourneyService(db);
    const result = await service.latestStepsFor([req, { ...req, id: "r2", status: RequestStatus.Draft }]);
    expect(result.get("r1")).toMatchObject({ key: "downloaded" });
    expect(result.get("r2")).toMatchObject({ key: "brief" });
    expect(sql.every((s) => /^\s*SELECT/i.test(s))).toBe(true);
  });

  it("skips studio_events and Channel Management when those tables are missing", async () => {
    const { db, sql } = fakeDb({}, false);
    const service = new AdminRequestJourneyService(db);
    const result = await service.latestStepsFor([req]);
    expect(result.get("r1")).toMatchObject({ key: "submitted" });
    expect(sql.some((s) => s.includes("FROM studio_events"))).toBe(false);
    expect(sql.some((s) => s.includes("management_content_items"))).toBe(false);

    const extras = await service.extrasFor("r1");
    expect(extras).toEqual({ studioEventsAvailable: false, studioActions: [], channelItems: [] });
  });

  it("returns studio clicks and Channel Management items with their targets", async () => {
    const { db } = fakeDb({
      "FROM studio_events": [{ action: "video_downloaded", step: "render", detail: { ratio: "9:16" }, surface: "ios", occurred_at: "2026-10-01T06:00:00Z" }],
      "FROM management_publication_targets": [
        { content_id: "c1", platform: "tiktok", status: "published", published_at: "2026-10-02T00:00:00Z", published_url: "https://example.com/p" },
      ],
      "FROM management_content_items": [{ id: "c1", title: "Clip", status: "ready", transferred_at: "2026-10-01T07:00:00Z" }],
    });
    const extras = await new AdminRequestJourneyService(db).extrasFor("r1");
    expect(extras.studioActions[0]).toMatchObject({ action: "video_downloaded", surface: "ios" });
    expect(extras.channelItems[0]).toMatchObject({ id: "c1", title: "Clip" });
    expect(extras.channelItems[0].targets[0]).toMatchObject({ platform: "tiktok", status: "published" });
  });

  it("no requests means no queries", async () => {
    const { db } = fakeDb({});
    expect((await new AdminRequestJourneyService(db).latestStepsFor([])).size).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });
});
