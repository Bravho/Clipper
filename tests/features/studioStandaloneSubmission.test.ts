/**
 * The studio pipeline no longer accepts a `downloadUnlocked` option on
 * submit: pay-at-submit was removed. The submit body must contain only
 * the three legal confirmations.
 */
import { submitStudioRequest } from "@/features/device-render/studioPipeline";

jest.mock("@/lib/mobile/deviceRenderBridge", () => ({
  describeDeviceRenderCapability: async () => ({ canRenderManifest: true, nativePluginVersion: 6 }),
  supportsManifestRender: async () => true,
}));
afterEach(() => jest.restoreAllMocks());

it("sends only the three legal confirmations in the submit body — no downloadUnlocked field", async () => {
  const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response("{}"));
  await submitStudioRequest({ requestId: "r", sources: [] });
  const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
  expect(body).toMatchObject({ creditConfirmed: true, rightsConfirmed: true, aiProcessingConfirmed: true });
  expect(body).not.toHaveProperty("downloadUnlocked");
});
