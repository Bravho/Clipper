/**
 * The studio's script call on storyboard approval: every failure surfaces as
 * "Try again" (Tho, 2026-10-26) — never an empty or fallback script.
 */
import {
  requestStoryboardScript,
  scriptFitFailureText,
  studioScriptStatus,
  StudioScriptFitError,
  type ScriptFitFailure,
} from "@/features/device-render/studioScriptFit";
import { studioEnglish } from "@/features/device-render/studioText";
import { translate } from "@/i18n/messages";

const request = {
  requestId: "req-1",
  jobId: "job-1",
  scenes: [{ summary: "", shots: [{ assetIndex: 0, seconds: 5 }] }],
  musicSelected: true,
};

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const good = {
  scriptThai: "มาที่ร้านนี้กัน",
  sceneLines: ["มาที่ร้านนี้กัน"],
  speakSeconds: 4.4,
  captionThai: "แคปชั่น #ร้าน",
};

describe("requestStoryboardScript", () => {
  it("fails on the AI's error, then the same call succeeds when tried again", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        json(502, { error: "The script writer failed: 503", code: "script_ai_failed", reason: "ai_error" })
      )
      .mockResolvedValueOnce(json(200, good));

    const first = await requestStoryboardScript(request, { fetchImpl }).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(StudioScriptFitError);
    expect((first as StudioScriptFitError).kind).toBe("ai");

    // "Try again" sends exactly the same request.
    await expect(requestStoryboardScript(request, { fetchImpl })).resolves.toEqual(good);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/requests/req-1/script/fit-storyboard");
    expect(fetchImpl.mock.calls[1][1].body).toBe(fetchImpl.mock.calls[0][1].body);
  });

  it("names the server's own timeout", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(json(502, { error: "slow", code: "script_ai_failed", reason: "timeout" }));
    await expect(requestStoryboardScript(request, { fetchImpl })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("gives up after its own time limit", async () => {
    const fetchImpl = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );
    await expect(
      requestStoryboardScript(request, { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 10 })
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("treats a dropped connection as a network failure", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(requestStoryboardScript(request, { fetchImpl })).rejects.toMatchObject({ kind: "network" });
  });

  it.each([
    ["an empty script", { ...good, scriptThai: "  " }],
    ["no caption", { ...good, captionThai: null }],
    ["no scene lines", { ...good, sceneLines: undefined }],
    ["a body that is not JSON", null],
  ])("rejects an answer with %s instead of continuing", async (_label, body) => {
    const fetchImpl = jest.fn().mockResolvedValue(json(200, body));
    await expect(requestStoryboardScript(request, { fetchImpl })).rejects.toMatchObject({ kind: "invalid" });
  });

  it("passes on a refusal that is not the AI's as a server failure", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json(400, { error: "Job not found." }));
    await expect(requestStoryboardScript(request, { fetchImpl })).rejects.toMatchObject({
      kind: "server",
      message: "Job not found.",
    });
  });
});

describe("studioScriptStatus", () => {
  const blocking: ScriptFitFailure = { message: "x", blocking: true };

  it("walks approval → failure → Try again → script", () => {
    // Approved the storyboard: the call is running.
    expect(studioScriptStatus({ pipeline: "review", scriptReady: false, fitting: true, failure: null })).toBe("writing");
    // It failed: the Sound step shows the error and Try again — no script, no voice.
    expect(studioScriptStatus({ pipeline: "review", scriptReady: false, fitting: false, failure: blocking })).toBe("fit_failed");
    // Try again is running.
    expect(studioScriptStatus({ pipeline: "review", scriptReady: false, fitting: true, failure: null })).toBe("writing");
    // It worked.
    expect(studioScriptStatus({ pipeline: "review", scriptReady: true, fitting: false, failure: null })).toBe("review");
  });

  it("does not let an older script through after a failed re-approval", () => {
    expect(studioScriptStatus({ pipeline: "review", scriptReady: true, fitting: false, failure: blocking })).toBe("fit_failed");
  });

  it("keeps a valid script when only the optional rewrite failed", () => {
    expect(
      studioScriptStatus({ pipeline: "review", scriptReady: true, fitting: false, failure: { message: "x", blocking: false } })
    ).toBe("review");
  });

  it("asks for the storyboard before any call, and leaves other pipeline states alone", () => {
    expect(studioScriptStatus({ pipeline: "review", scriptReady: false, fitting: false, failure: null })).toBe("waiting_storyboard");
    expect(studioScriptStatus({ pipeline: "approved", scriptReady: true, fitting: false, failure: blocking })).toBe("approved");
  });
});

describe("scriptFitFailureText", () => {
  it("explains each failure in the person's language", () => {
    const th = (key: Parameters<typeof studioEnglish>[0]) => translate("th", key);
    expect(scriptFitFailureText(new StudioScriptFitError("ai", "x"), studioEnglish, true)).toBe(
      studioEnglish("studio.audio.fitFailedBody")
    );
    expect(scriptFitFailureText(new StudioScriptFitError("timeout", "x"), th, true)).toBe(
      translate("th", "studio.audio.fitFailedTimeout")
    );
    expect(scriptFitFailureText(new StudioScriptFitError("network", "x"), studioEnglish, true)).toContain("internet");
    expect(scriptFitFailureText(new StudioScriptFitError("ai", "x"), studioEnglish, false)).toBe(
      studioEnglish("studio.audio.fitFailedKeep")
    );
    for (const locale of ["th", "en", "vi"] as const) {
      expect(translate(locale, "studio.audio.tryAgain")).not.toBe("studio.audio.tryAgain");
      expect(translate(locale, "studio.blocker.scriptFailed")).not.toBe("studio.blocker.scriptFailed");
    }
  });
});
