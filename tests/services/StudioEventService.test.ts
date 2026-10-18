import { StudioEventService, cleanStudioEvent } from "@/services/analytics/StudioEventService";

const NOW = new Date("2026-10-17T05:00:00Z");

describe("cleanStudioEvent", () => {
  it("accepts a known action and files it under the action's own step", () => {
    const event = cleanStudioEvent(
      { kind: "action", action: "voice_regenerated", step: "brief", sessionId: "s1" },
      NOW
    );
    expect(event).toMatchObject({ kind: "action", action: "voice_regenerated", step: "audio" });
  });

  it("refuses unknown names, kinds, steps and malformed session ids", () => {
    expect(cleanStudioEvent({ kind: "action", action: "made_up", sessionId: "s1" }, NOW)).toBeNull();
    expect(cleanStudioEvent({ kind: "click", sessionId: "s1" }, NOW)).toBeNull();
    expect(cleanStudioEvent({ kind: "step_view", step: "kitchen", sessionId: "s1" }, NOW)).toBeNull();
    expect(cleanStudioEvent({ kind: "step_view", step: "brief", sessionId: "has space" }, NOW)).toBeNull();
    expect(cleanStudioEvent({ kind: "step_view", sessionId: "s1" }, NOW)).toBeNull();
  });

  it("keeps a plausible phone clock and replaces an implausible one", () => {
    const ok = cleanStudioEvent(
      { kind: "studio_open", sessionId: "s1", at: "2026-10-17T04:59:00Z" },
      NOW
    );
    expect(ok?.occurredAt.toISOString()).toBe("2026-10-17T04:59:00.000Z");
    const skewed = cleanStudioEvent(
      { kind: "studio_open", sessionId: "s1", at: "2020-01-01T00:00:00Z" },
      NOW
    );
    expect(skewed?.occurredAt).toEqual(NOW);
  });

  it("keeps detail small and flat", () => {
    const event = cleanStudioEvent(
      {
        kind: "action",
        action: "media_picked",
        sessionId: "s1",
        detail: { photos: 3, nested: { a: 1 }, "bad key": 1, note: "x".repeat(500) },
      },
      NOW
    );
    expect(event?.detail).toEqual({ photos: 3, note: "x".repeat(160) });
  });
});

describe("StudioEventService.record", () => {
  it("inserts the valid events of a batch in one statement with the surface from the UA", async () => {
    const query = jest.fn(async (..._args: unknown[]) => ({ rows: [] }));
    const count = await new StudioEventService({ query }).record({
      userId: "user-1",
      userAgent: "Mozilla/5.0 RClipperNative/android",
      events: [
        { kind: "studio_open", sessionId: "s1" },
        { kind: "action", action: "nope", sessionId: "s1" },
        { kind: "step_view", step: "source", sessionId: "s1", requestId: "req-1" },
      ],
    });
    expect(count).toBe(2);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO studio_events");
    expect(values).toHaveLength(18);
    expect(values[7]).toBe("android");
    expect(values[11]).toBe("req-1");
  });

  it("never throws when the insert fails, and skips an all-invalid batch", async () => {
    const failing = { query: jest.fn(async () => Promise.reject(new Error("no table"))) };
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      new StudioEventService(failing).record({
        userId: "u",
        events: [{ kind: "studio_open", sessionId: "s1" }],
      })
    ).resolves.toBe(0);
    spy.mockRestore();

    const unused = { query: jest.fn() };
    await new StudioEventService(unused).record({ userId: "u", events: [{ kind: "x" }] });
    expect(unused.query).not.toHaveBeenCalled();
  });
});
