import {
  buildLabRouteUrl,
  isLabRouteAction,
  isSafeLabId,
  labActionForDeviceCall,
  labStopClass,
  LAB_ROUTE_TEMPLATES,
} from "@/lib/lab/labRouteTable";

describe("route allow-list", () => {
  it("only the listed actions are actions", () => {
    expect(isLabRouteAction("submit")).toBe(true);
    expect(isLabRouteAction("device-release")).toBe(true);
    expect(isLabRouteAction("delete-request")).toBe(false);
    expect(isLabRouteAction("__proto__")).toBe(false);
    expect(isLabRouteAction("constructor")).toBe(false);
  });

  it("each action maps to one fixed path template", () => {
    expect(buildLabRouteUrl("approve-voice", { requestId: "r1" })).toBe("/api/requests/r1/approve-voice");
    expect(buildLabRouteUrl("device-complete", { attemptId: "a1" })).toBe("/api/device-render/a1/complete");
    expect(buildLabRouteUrl("device-claim", {})).toBe("/api/device-render/claim");
  });

  it("an unsafe id is refused, so no URL can be built from it", () => {
    expect(buildLabRouteUrl("submit", { requestId: "../admin" })).toBeNull();
    expect(buildLabRouteUrl("submit", { requestId: "r1/../../x" })).toBeNull();
    expect(buildLabRouteUrl("submit", { requestId: "" })).toBeNull();
    expect(buildLabRouteUrl("device-progress", { attemptId: "a?b=1" })).toBeNull();
    expect(buildLabRouteUrl("submit", {})).toBeNull();
  });

  it("safe ids are letters, digits, dash and underscore, up to 64", () => {
    expect(isSafeLabId("abc_DEF-123")).toBe(true);
    expect(isSafeLabId("a".repeat(64))).toBe(true);
    expect(isSafeLabId("a".repeat(65))).toBe(false);
    expect(isSafeLabId("a b")).toBe(false);
  });

  it("every template is a POST on a known path", () => {
    for (const [name, t] of Object.entries(LAB_ROUTE_TEMPLATES)) {
      expect(t.method).toBe("POST");
      expect(t.path.startsWith("/api/")).toBe(true);
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe("stop classes", () => {
  it("new work is refused when stopped; release is always a terminate", () => {
    expect(labStopClass("submit")).toBe("new-work");
    expect(labStopClass("device-claim")).toBe("new-work");
    expect(labStopClass("device-upload-authorize")).toBe("new-work");
    expect(labStopClass("device-progress")).toBe("progress");
    expect(labStopClass("device-upload-finish")).toBe("finish");
    expect(labStopClass("device-complete")).toBe("finish");
    expect(labStopClass("device-release")).toBe("terminate");
  });
});

describe("mapping of the render lifecycle to lab actions", () => {
  it("maps each call runDeviceRender makes", () => {
    expect(labActionForDeviceCall("/api/device-render/claim", {})).toEqual({ action: "device-claim" });
    expect(labActionForDeviceCall("/api/device-render/a1/progress", {})).toEqual({ action: "device-progress", attemptId: "a1" });
    expect(labActionForDeviceCall("/api/device-render/a1/upload", { action: "authorize" })).toEqual({ action: "device-upload-authorize", attemptId: "a1" });
    expect(labActionForDeviceCall("/api/device-render/a1/upload", { action: "finish" })).toEqual({ action: "device-upload-finish", attemptId: "a1" });
    expect(labActionForDeviceCall("/api/device-render/a1/complete", {})).toEqual({ action: "device-complete", attemptId: "a1" });
    expect(labActionForDeviceCall("/api/device-render/a1/release", {})).toEqual({ action: "device-release", attemptId: "a1" });
  });

  it("an unknown URL, an unknown upload action, or an unsafe attempt id is not mapped", () => {
    expect(labActionForDeviceCall("/api/admin/users", {})).toBeNull();
    expect(labActionForDeviceCall("/api/device-render/a1/upload", { action: "delete" })).toBeNull();
    expect(labActionForDeviceCall("/api/device-render/a1/../../x/complete", {})).toBeNull();
  });
});
