/**
 * The run panel, rendered to static markup, and its click path (startLabPanelRun)
 * with every network call mocked. The server side of the ledger is the real
 * handler (handleLedgerApi) over an in-memory ledger, so its guards apply.
 * Nothing is sent to a real server, a provider, or a device.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LabRunPanel, startLabPanelRun, type LabPanelProps } from "@/app/lab/autorun/LabRunPanel";
import { handleLedgerApi } from "@/lib/lab/labLedgerApi";
import { LabSpendLedger, type LabLedgerState } from "@/lib/lab/labSpendLedger";

jest.mock("@/features/device-render/editorState", () => ({
  probeVideo: async () => ({ durationSeconds: 15, posterUrl: "data:image/jpeg;base64,xx" }),
}));

const LAB = "lab.tester@example.com";
const identity = { userId: "lab-1", email: LAB, role: "requester" };
const place = { placeName: "Fixture place", latitude: 13.75, longitude: 100.5 };
const props = (over: Partial<LabPanelProps> = {}): LabPanelProps => ({
  identity,
  flagOn: true,
  providerOn: false,
  testPlace: place,
  fileNames: ["a.mp4"],
  ...over,
});

describe("render", () => {
  it("with provider work off (production): the button is disabled and says nothing will be sent", () => {
    const html = renderToStaticMarkup(createElement(LabRunPanel, props({ providerOn: false })));
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toMatch(/switched off in this build/);
  });
  it("with no test place configured: says so", () => {
    expect(renderToStaticMarkup(createElement(LabRunPanel, props({ testPlace: null })))).toMatch(/No lab test place is configured/);
  });
  it("with provider work on and a place: the button is enabled", () => {
    expect(renderToStaticMarkup(createElement(LabRunPanel, props({ providerOn: true })))).not.toMatch(/<button[^>]*disabled/);
  });
});

/** Routes the phone's fetch calls to the real server handlers (ledger) or to fixed answers (draft). Records every call. */
function serverMock(opts: { ledgerProviderOn: boolean; draftStatus?: number }) {
  const ledgerState = { state: null as LabLedgerState | null };
  const ledger = new LabSpendLedger(
    {
      read: async () => (ledgerState.state === null ? null : JSON.parse(JSON.stringify(ledgerState.state))),
      write: async (s: LabLedgerState) => {
        ledgerState.state = JSON.parse(JSON.stringify(s));
      },
    },
    () => new Date("2026-11-07T03:00:00Z")
  );
  const calls: { url: string; body: unknown }[] = [];
  const fetchMock = jest.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const json = (status: number, payload: unknown) => ({ ok: status < 400, status, json: async () => payload }) as Response;
    if (url === "/api/lab/autorun/ledger") {
      const r = await handleLedgerApi(body, {
        flagValue: "true",
        providerExecutionEnabled: opts.ledgerProviderOn,
        identity: { flagValue: "true", labEmail: LAB, requesterRole: "requester", session: { user: { id: "lab-1", role: "requester", email: LAB } } },
        ledger,
      });
      return json(r.status, r.body);
    }
    if (url === "/api/lab/autorun/draft") return json(opts.draftStatus ?? 201, { requestId: "req-1" });
    if (url.startsWith("/api/lab/test-media/")) return { ok: true, status: 200, blob: async () => new Blob(["x"]) } as unknown as Response;
    return json(404, { error: "not expected in this test: " + url });
  });
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  return { calls, ledger, ledgerState };
}

describe("click path (startLabPanelRun), network mocked", () => {
  it("provider work off: refused before any run; only the switch check is asked of the server", async () => {
    const s = serverMock({ ledgerProviderOn: false });
    const view = await startLabPanelRun(props({ providerOn: false }));
    expect(view.detail).toMatch(/switched off in this build/);
    expect(s.calls.map((c) => c.url)).toEqual(["/api/lab/autorun/ledger"]);
    expect(s.ledgerState.state).toBeNull();
  });

  it("server switch off (ledger answers 404): the phone stops before any reservation", async () => {
    const s = serverMock({ ledgerProviderOn: false });
    const view = await startLabPanelRun(props({ providerOn: true }));
    expect(view.detail).toMatch(/kill switch|could not be read|switched off/);
    expect(s.calls.some((c) => c.url === "/api/lab/autorun/draft")).toBe(false);
    expect(s.ledgerState.state).toBeNull();
  });

  it("both switches on: reserve and mark happen first, then the draft carries the run id and a studio-valid form", async () => {
    const s = serverMock({ ledgerProviderOn: true, draftStatus: 409 });
    const view = await startLabPanelRun(props({ providerOn: true }));
    const draft = s.calls.find((c) => c.url === "/api/lab/autorun/draft");
    expect(draft).toBeDefined();
    expect(draft!.body).toMatchObject({ title: "Lab test clip", targetPlatforms: ["tiktok"], durationSeconds: 15 });
    expect((draft!.body as { runId?: string }).runId).toMatch(/[0-9a-f-]{36}/);
    // The marker and the reservation were stored before the draft was asked for.
    const stored = s.ledgerState.state!;
    expect(stored.reservations).toHaveLength(1);
    expect(stored.spendAttempted).toHaveLength(1);
    // The draft was refused, so the run stops with the money kept reserved.
    expect(view.title).toMatch(/Stopped or failed/);
  });

  it("the calls to the server are only the ledger, the test-media file, and the draft (no provider or device call)", async () => {
    const s = serverMock({ ledgerProviderOn: true, draftStatus: 201 });
    await startLabPanelRun(props({ providerOn: true }));
    const urls = s.calls.map((c) => c.url);
    expect(urls.every((u) => u.startsWith("/api/lab/autorun/") || u.startsWith("/api/lab/test-media/"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/device-render") || u.includes("/api/requests/"))).toBe(false);
  });
});
