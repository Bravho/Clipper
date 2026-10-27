import { POST } from "@/app/api/device-render/text-graphics/route";
import { textGraphicsService, TextGraphicsAiError } from "@/services/TextGraphicsService";

jest.mock("@/app/api/device-render/_guard", () => ({
  authorizeDeviceRenderRequest: async () => ({ ok: true, caller: { userId: "u" } }),
  readJsonBody: async (request: Request) => ({ ok: true, body: await request.json() }),
}));
jest.mock("@/repositories/index", () => ({
  clipRequestRepository: { findById: async () => ({ id: "r", userId: "u" }) },
  videoGenerationJobRepository: { findByRequestId: async () => ({ id: "j" }) },
}));
jest.mock("@/services/TextGraphicsService", () => ({
  ...jest.requireActual("@/services/TextGraphicsService"),
  textGraphicsService: { ensurePlan: jest.fn() },
}));

it("returns 502 and the retryable AI code without a guessed plan", async () => {
  (textGraphicsService.ensurePlan as jest.Mock).mockRejectedValue(new TextGraphicsAiError("ai", "Overloaded"));
  const response = await POST(new Request("http://localhost/api/device-render/text-graphics", {
    method: "POST", body: JSON.stringify({ requestId: "r", choice: "premium" }),
  }));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "Overloaded", code: "text_graphics_ai_failed", reason: "ai" });
});

it("does not call AI for the explicit none choice", async () => {
  jest.clearAllMocks();
  const response = await POST(new Request("http://localhost/api/device-render/text-graphics", {
    method: "POST", body: JSON.stringify({ requestId: "r", choice: "none" }),
  }));
  expect(await response.json()).toEqual({ plan: null, textGraphics: null });
  expect(textGraphicsService.ensurePlan).not.toHaveBeenCalled();
});
