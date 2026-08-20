import {
  GateEventService,
  gateSceneIndex,
  isAwaitingGate,
} from "@/services/analytics/GateEventService";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";

/**
 * Pipeline gate events (migration 028, `pipeline_gate_events`).
 *
 * This table is the ONLY place a human approval and an express-lane
 * auto-approval can be told apart: `_autoAdvanceIfEnabled` reuses a real
 * requester's id, so the step history and the `*_approved_by` columns look
 * identical either way. The contract worth locking down:
 *
 *   - opening is conflict-tolerant, because `uq_gate_events_open` allows exactly
 *     one open row per (job, step, scene) and re-entry is normal;
 *   - closing matches the open row on the COALESCE(scene_index, -1) key the
 *     index uses, and computes the wait IN SQL (the open and the close happen in
 *     different processes, so only the DB has both clocks);
 *   - every method swallows its errors, like `_recordStepHistory`.
 *
 * The service takes its pool by constructor injection (the ManagementAuditService
 * pattern), so a stub is enough — no live Postgres.
 */

function stubDb() {
  const calls: { text: string; values: unknown[] }[] = [];
  return {
    calls,
    query: jest.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });
      return { rows: [] };
    }),
  };
}

/** Collapse whitespace so assertions do not depend on SQL formatting. */
const flat = (sql: string) => sql.replace(/\s+/g, " ");

describe("isAwaitingGate", () => {
  it("recognises every awaiting_* step from the enum's own value convention", () => {
    const gates = Object.values(VideoGenerationStep).filter(isAwaitingGate);
    // Derived, not hand-listed: a gate added to the enum is picked up for free.
    expect(gates).toEqual(
      Object.values(VideoGenerationStep).filter((s) => s.startsWith("awaiting_"))
    );
    expect(gates).toContain(VideoGenerationStep.AwaitingSceneScriptApproval);
    expect(gates).toContain(VideoGenerationStep.AwaitingDistributionReview);
  });

  it("rejects processing steps and terminal states", () => {
    expect(isAwaitingGate(VideoGenerationStep.GeneratingBaseVideo)).toBe(false);
    expect(isAwaitingGate(VideoGenerationStep.MergingScenes)).toBe(false);
    expect(isAwaitingGate(VideoGenerationStep.Complete)).toBe(false);
    expect(isAwaitingGate(VideoGenerationStep.Failed)).toBe(false);
    expect(isAwaitingGate(null)).toBe(false);
    expect(isAwaitingGate(undefined)).toBe(false);
  });
});

describe("gateSceneIndex", () => {
  it("keys the per-scene gates by scene", () => {
    expect(
      gateSceneIndex(VideoGenerationStep.AwaitingSceneScriptApproval, 2)
    ).toBe(2);
    expect(gateSceneIndex(VideoGenerationStep.AwaitingVideoApproval, 0)).toBe(0);
  });

  it("nulls the scene index on whole-job gates", () => {
    // The job still carries a currentSceneIndex from the loop it just left;
    // keying a whole-job gate by it would let the same gate open twice.
    expect(gateSceneIndex(VideoGenerationStep.AwaitingFinalApproval, 3)).toBeNull();
    expect(
      gateSceneIndex(VideoGenerationStep.AwaitingOverlayApproval, 0)
    ).toBeNull();
  });
});

describe("GateEventService.openGate", () => {
  it("inserts an open row and tolerates the one-open-gate conflict", async () => {
    const db = stubDb();
    await new GateEventService(db).openGate({
      jobId: "job-1",
      requestId: "req-1",
      userId: "user-1",
      step: VideoGenerationStep.AwaitingVideoApproval,
      sceneIndex: 1,
    });

    const { text, values } = db.calls[0];
    expect(flat(text)).toContain("INSERT INTO pipeline_gate_events");
    expect(flat(text)).toContain("ON CONFLICT DO NOTHING");
    expect(values).toEqual([
      "job-1",
      "req-1",
      "user-1",
      VideoGenerationStep.AwaitingVideoApproval,
      1,
    ]);
  });

  it("records a null actor when the caller did not thread one", async () => {
    // Most of the ~100 update() call sites pass no actor; those must still open
    // a measurable gate rather than being dropped.
    const db = stubDb();
    await new GateEventService(db).openGate({
      jobId: "job-2",
      requestId: "req-2",
      step: VideoGenerationStep.AwaitingFinalApproval,
    });

    expect(db.calls[0].values[2]).toBeNull();
    expect(db.calls[0].values[4]).toBeNull();
  });

  it("swallows a database failure", async () => {
    const db = {
      query: jest.fn(async () => {
        throw new Error("deadlock detected");
      }),
    };
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      new GateEventService(db).openGate({
        jobId: "job-3",
        requestId: "req-3",
        step: VideoGenerationStep.AwaitingVoiceApproval,
      })
    ).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });
});

describe("GateEventService.closeGate", () => {
  it("closes only the open row, computing the wait in SQL", async () => {
    const db = stubDb();
    await new GateEventService(db).closeGate({
      jobId: "job-1",
      step: VideoGenerationStep.AwaitingVideoApproval,
      sceneIndex: 1,
      resolution: "approved",
      resolvedBy: "user-1",
      actorSource: "human",
    });

    const { text, values } = db.calls[0];
    const sql = flat(text);
    expect(sql).toContain("UPDATE pipeline_gate_events");
    expect(sql).toContain("resolved_at = NOW()");
    expect(sql).toContain(
      "wait_seconds = EXTRACT(EPOCH FROM (NOW() - opened_at))::int"
    );
    expect(sql).toContain("updated_at = NOW()");
    // Must match the partial index's key, or a whole-job gate (scene_index NULL)
    // would never be found: NULL = NULL is not true in SQL.
    expect(sql).toContain("COALESCE(scene_index, -1) = COALESCE($3::int, -1)");
    expect(sql).toContain("resolved_at IS NULL");
    expect(values).toEqual([
      "job-1",
      VideoGenerationStep.AwaitingVideoApproval,
      1,
      "approved",
      "user-1",
      "human",
    ]);
  });

  it("distinguishes an express-lane approval from a human one", async () => {
    const db = stubDb();
    await new GateEventService(db).closeGate({
      jobId: "job-4",
      step: VideoGenerationStep.AwaitingOverlayApproval,
      resolution: "approved",
      // The express lane reuses a real requester's id, so the id alone cannot
      // carry this distinction — actor_source is the whole point of the table.
      resolvedBy: "user-9",
      actorSource: "auto",
    });

    expect(db.calls[0].values[2]).toBeNull();
    expect(db.calls[0].values[4]).toBe("user-9");
    expect(db.calls[0].values[5]).toBe("auto");
  });

  it("swallows a database failure", async () => {
    const db = {
      query: jest.fn(async () => {
        throw new Error("connection terminated");
      }),
    };
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      new GateEventService(db).closeGate({
        jobId: "job-5",
        step: VideoGenerationStep.AwaitingFinalApproval,
        resolution: "abandoned",
      })
    ).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });
});

describe("GateEventService.markNotified", () => {
  it("stamps notified_at on the open, not-yet-notified row only", async () => {
    const db = stubDb();
    await new GateEventService(db).markNotified({
      jobId: "job-1",
      step: VideoGenerationStep.AwaitingSceneScriptApproval,
      sceneIndex: 0,
    });

    const sql = flat(db.calls[0].text);
    expect(sql).toContain("notified_at = NOW()");
    expect(sql).toContain("resolved_at IS NULL");
    // Idempotent: the first notice is the one that summoned the requester, so a
    // retry must not move the timestamp forward and shrink the measured wait.
    expect(sql).toContain("notified_at IS NULL");
    expect(db.calls[0].values).toEqual([
      "job-1",
      VideoGenerationStep.AwaitingSceneScriptApproval,
      0,
    ]);
  });

  it("swallows a database failure", async () => {
    const db = {
      query: jest.fn(async () => {
        throw new Error("timeout");
      }),
    };
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      new GateEventService(db).markNotified({
        jobId: "job-6",
        step: VideoGenerationStep.AwaitingVideoApproval,
        sceneIndex: 2,
      })
    ).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });
});
