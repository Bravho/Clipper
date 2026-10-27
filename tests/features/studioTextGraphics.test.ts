import { fetchTextGraphicsPreview } from "@/features/device-render/studioPipeline";
import { StudioTextGraphicsError, STUDIO_GRAPHICS_TIMEOUT_MS } from "@/features/device-render/studioTextGraphics";

const input = { requestId: "r", choice: "premium" as const, scenePlan: [], musicTrackId: null, fresh: false };
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it("allows the explicit none choice without requesting AI", async () => {
  const fetchMock = jest.spyOn(global, "fetch");
  await expect(fetchTextGraphicsPreview({ ...input, choice: "none" })).resolves.toEqual({ plan: null, textGraphics: null });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("surfaces a 502 AI failure, then retries the same call successfully", async () => {
  const result = { plan: { source: "claude", items: [{ title: "Cafe" }] }, textGraphics: { items: [{ title: "Cafe" }] } };
  const fetchMock = jest.spyOn(global, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: "text_graphics_ai_failed", error: "overloaded" }), { status: 502 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(result)));
  await expect(fetchTextGraphicsPreview(input)).rejects.toMatchObject({ kind: "ai" });
  await expect(fetchTextGraphicsPreview(input)).resolves.toEqual(result);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("surfaces network failures", async () => {
  jest.spyOn(global, "fetch").mockRejectedValue(new TypeError("offline"));
  await expect(fetchTextGraphicsPreview(input)).rejects.toMatchObject({ kind: "network" });
});

it("aborts a timed out request and offers a retryable error", async () => {
  jest.useFakeTimers();
  jest.spyOn(global, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  }));
  const pending = expect(fetchTextGraphicsPreview(input)).rejects.toMatchObject({ kind: "timeout" });
  await jest.advanceTimersByTimeAsync(STUDIO_GRAPHICS_TIMEOUT_MS);
  await pending;
});

it.each([null, { plan: null, textGraphics: null }, { plan: { source: "fallback" }, textGraphics: {} }])("rejects missing or guessed success data", async (body) => {
  jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(body)));
  await expect(fetchTextGraphicsPreview(input)).rejects.toBeInstanceOf(StudioTextGraphicsError);
});
