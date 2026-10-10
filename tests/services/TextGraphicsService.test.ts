/**
 * TextGraphicsService: one Claude call per edit, reused by the preview and the
 * render, and never able to break a render — every failure ends in the
 * fallback plan.
 */
const update = jest.fn(async () => ({}));
jest.mock("@/repositories", () => ({
  clipRequestRepository: {
    findById: jest.fn(async () => ({ placeName: "MAGURO KAPPOU", title: "t", description: "Japanese food" })),
  },
  videoGenerationJobRepository: { update },
}));
jest.mock("@/lib/sourceAssets", () => ({
  getOrderedSourceAssets: jest.fn(async () => [
    { index: 0, id: "a0", url: "https://cdn.test/a0.jpg", thumbnailUrl: "", kind: "image" },
    { index: 1, id: "a1", url: "https://cdn.test/a1.jpg", thumbnailUrl: "", kind: "image" },
  ]),
}));
jest.mock("@/lib/ai/geminiSubtitlesService", () => ({
  downloadAsBase64: jest.fn(async () => ({ data: "aGVsbG8=", mimeType: "image/jpeg" })),
}));
jest.mock("@/config/aiTools", () => ({
  AI_CONFIG: { claude: { apiKey: process.env.TEST_CLAUDE_KEY ?? "", model: "claude-test", apiVersion: "2023-06-01" } },
}));

import { TextGraphicsService } from "@/services/TextGraphicsService";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";

function job(overrides: Partial<VideoGenerationJob> = {}): VideoGenerationJob {
  return {
    id: "job-1",
    requestId: "req-1",
    selectedTextStyle: "auto",
    selectedMusicTrack: "none",
    approvedScenePlan: JSON.stringify([
      { sceneNumber: 1, durationSeconds: 6, visualDescriptionThai: "หน้าร้าน", imageIndexes: [0], assets: [{ assetIndex: 0, kind: "image", motion: "static", durationSeconds: 6 }] },
      { sceneNumber: 2, durationSeconds: 8, visualDescriptionThai: "ซาซิมิ", imageIndexes: [1], assets: [{ assetIndex: 1, kind: "image", motion: "static", durationSeconds: 8 }] },
    ]),
    voiceTimestamps: JSON.stringify([{ startSecond: 0, endSecond: 3, textThai: "วันนี้พามากิน", textEnglish: "Today" }]),
    approvedScriptThai: "วันนี้พามากิน",
    textGraphicsPlan: null,
    ...overrides,
  } as unknown as VideoGenerationJob;
}

afterEach(() => {
  jest.restoreAllMocks();
  update.mockClear();
  delete process.env.TEST_CLAUDE_KEY;
});

it("is null when the requester chose none", async () => {
  expect(await new TextGraphicsService().ensurePlan(job({ selectedTextStyle: "none" }))).toBeNull();
});

it("falls back without an API key: business name hook and a closing card", async () => {
  const plan = await new TextGraphicsService().ensurePlan(job());
  expect(plan?.source).toBe("fallback");
  expect(plan?.styleId).toBe("premium");
  expect(plan?.items[0]).toMatchObject({ kind: "hook", title: "MAGURO KAPPOU" });
  expect(plan?.durationSeconds).toBeCloseTo(13.8, 5);
});

it("reuses a stored plan whose fingerprint matches, without asking again", async () => {
  const service = new TextGraphicsService();
  const first = await service.ensurePlan(job({ selectedTextStyle: "cafe" }));
  const fetchSpy = jest.spyOn(global, "fetch");
  const again = await service.ensurePlan(job({ selectedTextStyle: "cafe", textGraphicsPlan: JSON.stringify(first) }));
  expect(again).toEqual(first);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("uses Claude's tool answer, its style pick on auto, and saves it", async () => {
  jest.resetModules();
  process.env.TEST_CLAUDE_KEY = "sk-test";
  const { TextGraphicsService: Fresh } = await import("@/services/TextGraphicsService");
  const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      content: [
        {
          type: "tool_use",
          name: "write_text_graphics",
          input: {
            style: "street",
            items: [
              { kind: "hook", start: 0.3, end: 3.6, title: "MAGURO KAPPOU", sub: "ร้านญี่ปุ่น", kicker: "JAPANESE" },
              { kind: "label", start: 6.2, end: 9.5, title: "ซาซิมิรวม", sub: "Sashimi Set", badge: "แนะนำ!" },
            ],
          },
        },
      ],
    }),
  } as unknown as Response);
  const plan = await new Fresh().ensurePlan(job());
  expect(plan?.source).toBe("claude");
  expect(plan?.styleId).toBe("street");
  expect(plan?.items).toHaveLength(2);
  const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
  expect(body.tool_choice).toEqual({ type: "tool", name: "write_text_graphics" });
  expect(body.messages[0].content.filter((c: { type: string }) => c.type === "image")).toHaveLength(2);
  await new Promise((r) => setImmediate(r));
  const { videoGenerationJobRepository } = await import("@/repositories");
  expect(videoGenerationJobRepository.update).toHaveBeenCalled();
});

it("falls back when Claude errors", async () => {
  jest.resetModules();
  process.env.TEST_CLAUDE_KEY = "sk-test";
  const { TextGraphicsService: Fresh } = await import("@/services/TextGraphicsService");
  jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 529, text: async () => "overloaded" } as unknown as Response);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  const plan = await new Fresh().ensurePlan(job({ selectedTextStyle: "premium" }));
  expect(plan?.source).toBe("fallback");
  expect(plan?.styleId).toBe("premium");
});
