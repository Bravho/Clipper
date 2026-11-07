/**
 * The explicit allow-list of server calls a lab run may make through the step
 * route. Each action maps to one path template and one method. Ids are checked
 * to be plain identifiers, so nothing outside these templates can be reached.
 * No arbitrary URL is ever forwarded.
 */

export const LAB_ROUTE_TEMPLATES = {
  submit: { method: "POST", path: "/api/requests/{requestId}/submit", attempt: false, chargeable: true, claims: false },
  "start-production": { method: "POST", path: "/api/requests/{requestId}/start-production", attempt: false, chargeable: true, claims: false },
  "approve-voice": { method: "POST", path: "/api/requests/{requestId}/approve-voice", attempt: false, chargeable: true, claims: false },
  "scene-design-approve": { method: "POST", path: "/api/requests/{requestId}/scene-design/approve", attempt: false, chargeable: true, claims: false },
  "approve-overlay": { method: "POST", path: "/api/requests/{requestId}/approve-overlay", attempt: false, chargeable: true, claims: false },
  "device-claim": { method: "POST", path: "/api/device-render/claim", attempt: false, chargeable: true, claims: true },
  "device-progress": { method: "POST", path: "/api/device-render/{attemptId}/progress", attempt: true, chargeable: false, claims: false },
  "device-upload-authorize": { method: "POST", path: "/api/device-render/{attemptId}/upload", attempt: true, chargeable: true, claims: false },
  "device-upload-finish": { method: "POST", path: "/api/device-render/{attemptId}/upload", attempt: true, chargeable: false, claims: false },
  "device-complete": { method: "POST", path: "/api/device-render/{attemptId}/complete", attempt: true, chargeable: true, claims: false },
  "device-release": { method: "POST", path: "/api/device-render/{attemptId}/release", attempt: true, chargeable: false, claims: false },
} as const;

export type LabRouteAction = keyof typeof LAB_ROUTE_TEMPLATES;

export function isLabRouteAction(value: unknown): value is LabRouteAction {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LAB_ROUTE_TEMPLATES, value);
}

/** A plain identifier: letters, digits, dash, underscore; 1 to 64 characters. */
export function isSafeLabId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/** The stop classes. See the stop table in the consolidated proposal. */
export type LabStopClass = "new-work" | "progress" | "finish" | "terminate";

export function labStopClass(action: LabRouteAction): LabStopClass {
  if (action === "device-release") return "terminate";
  if (action === "device-progress") return "progress";
  if (action === "device-upload-finish" || action === "device-complete") return "finish";
  return "new-work";
}

/** Builds the one URL an action may reach. Returns null for an unknown action or an unsafe id. */
export function buildLabRouteUrl(action: LabRouteAction, ids: { requestId?: string; attemptId?: string }): string | null {
  const t = LAB_ROUTE_TEMPLATES[action];
  let path: string = t.path;
  if (path.includes("{requestId}")) {
    if (!isSafeLabId(ids.requestId)) return null;
    path = path.replace("{requestId}", ids.requestId);
  }
  if (path.includes("{attemptId}")) {
    if (!isSafeLabId(ids.attemptId)) return null;
    path = path.replace("{attemptId}", ids.attemptId);
  }
  return path;
}

/**
 * Maps one device-render lifecycle call (as runDeviceRender makes it) to its
 * lab action and attempt id. Returns null for any URL or body it does not know.
 */
export function labActionForDeviceCall(url: string, body: unknown): { action: LabRouteAction; attemptId?: string } | null {
  if (url === "/api/device-render/claim") return { action: "device-claim" };
  const m = /^\/api\/device-render\/([A-Za-z0-9_-]{1,64})\/(progress|upload|complete|release)$/.exec(url);
  if (!m) return null;
  const attemptId = m[1];
  switch (m[2]) {
    case "progress":
      return { action: "device-progress", attemptId };
    case "complete":
      return { action: "device-complete", attemptId };
    case "release":
      return { action: "device-release", attemptId };
    case "upload": {
      const act = (body as { action?: unknown } | null)?.action;
      if (act === "authorize") return { action: "device-upload-authorize", attemptId };
      if (act === "finish") return { action: "device-upload-finish", attemptId };
      return null;
    }
    default:
      return null;
  }
}
