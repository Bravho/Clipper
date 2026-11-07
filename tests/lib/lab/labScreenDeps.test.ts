import { buildLabScreenInput } from "@/lib/lab/labScreenDeps";
import { neverStopped } from "@/lib/lab/labGuards";
import { LabSpendLedger } from "@/lib/lab/labSpendLedger";
import { startLabRunFromScreen } from "@/lib/lab/labRunScreen";

const pieces = (env: Record<string, string | undefined>) => ({
  env,
  identity: { flagValue: "true", labEmail: "lab@x.com", requesterRole: "requester", session: { user: { id: "1", role: "requester", email: "lab@x.com" } } },
  ledger: new LabSpendLedger({ read: async () => null, write: async () => undefined }),
  guard: neverStopped,
  runId: "run-1",
  prepareSource: async () => { throw new Error("not called"); },
  fetchJson: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
  fetchBlob: jest.fn(async () => new Blob()),
  fileNames: ["a.mp4"],
});

describe("screen input from configuration", () => {
  it("reads the test place from configuration when it is set", () => {
    const input = buildLabScreenInput(pieces({ NEXT_PUBLIC_LAB_AUTORUN: "true", LAB_TEST_PLACE_NAME: "Place", LAB_TEST_PLACE_LAT: "13.7", LAB_TEST_PLACE_LNG: "100.5" }));
    expect(input.clientOptions.testPlace).toEqual({ placeName: "Place", latitude: 13.7, longitude: 100.5 });
  });

  it("with no test place configured, the run is refused before any reservation (no request sent)", async () => {
    const p = pieces({ NEXT_PUBLIC_LAB_AUTORUN: "true" });
    const view = await startLabRunFromScreen({ ...buildLabScreenInput(p), providerExecutionEnabled: true });
    expect(view.detail).toMatch(/No lab test place/);
    expect(p.fetchJson).not.toHaveBeenCalled();
  });

  it("with the provider switch off (production), the run is refused and nothing is requested", async () => {
    const p = pieces({ NEXT_PUBLIC_LAB_AUTORUN: "true", LAB_TEST_PLACE_NAME: "Place", LAB_TEST_PLACE_LAT: "13.7", LAB_TEST_PLACE_LNG: "100.5" });
    const view = await startLabRunFromScreen({ ...buildLabScreenInput(p), providerExecutionEnabled: false });
    expect(view.detail).toMatch(/switched off in this build/);
    expect(p.fetchJson).not.toHaveBeenCalled();
  });
});
