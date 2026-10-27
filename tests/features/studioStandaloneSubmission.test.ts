import { submitStudioRequest } from "@/features/device-render/studioPipeline";

jest.mock("@/lib/mobile/deviceRenderBridge", () => ({
  describeDeviceRenderCapability: async () => ({ canRenderManifest: true, nativePluginVersion: 6 }),
  supportsManifestRender: async () => true,
}));
afterEach(() => jest.restoreAllMocks());

it.each([true, false])("sends only the explicit standalone purchase choice (%s)", async (downloadUnlocked) => {
  const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response("{}"));
  await submitStudioRequest({ requestId: "r", sources: [], downloadUnlocked });
  const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
  expect(body).toMatchObject({ downloadUnlocked, creditConfirmed: true, rightsConfirmed: true, aiProcessingConfirmed: true });
});
