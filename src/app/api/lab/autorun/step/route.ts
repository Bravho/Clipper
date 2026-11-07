import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository } from "@/repositories/index";
import { handleLabStep, type LabRunBinding } from "@/lib/lab/labStep";
import { LAB_ROUTE_TEMPLATES, type LabRouteAction } from "@/lib/lab/labRouteTable";
import { LAB_PROVIDER_EXECUTION_ENABLED } from "@/lib/lab/labGuards";
import { openServerLedger } from "@/lib/lab/labServerLedger";
import { ownedKey } from "@/lib/lab/labLedgerApi";
import { POST as submitRequest } from "@/app/api/requests/[id]/submit/route";
import { POST as startProduction } from "@/app/api/requests/[id]/start-production/route";
import { POST as approveVoice } from "@/app/api/requests/[id]/approve-voice/route";
import { POST as sceneDesignApprove } from "@/app/api/requests/[id]/scene-design/approve/route";
import { POST as approveOverlay } from "@/app/api/requests/[id]/approve-overlay/route";
import { POST as deviceClaim } from "@/app/api/device-render/claim/route";
import { POST as deviceProgress } from "@/app/api/device-render/[attemptId]/progress/route";
import { POST as deviceUpload } from "@/app/api/device-render/[attemptId]/upload/route";
import { POST as deviceComplete } from "@/app/api/device-render/[attemptId]/complete/route";
import { POST as deviceRelease } from "@/app/api/device-render/[attemptId]/release/route";

/**
 * POST /api/lab/autorun/step  { requestId, action, runId, attemptId?, payload }
 *
 * Lab auto-run only. The checks are in src/lib/lab/labStep.ts. Each allow-listed
 * action calls exactly one existing route, with the caller's own session; those
 * routes keep their own checks. Nothing else is reachable from here.
 */


type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** Each route is an existing POST handler; its own parameter types are narrower, so it is cast here. */
const asHandler = (h: unknown): Handler => h as Handler;

/** One handler per action. Each is an existing route's POST, unchanged. */
const HANDLERS: Record<LabRouteAction, Handler> = {
  submit: asHandler(submitRequest),
  "start-production": asHandler(startProduction),
  "approve-voice": asHandler(approveVoice),
  "scene-design-approve": asHandler(sceneDesignApprove),
  "approve-overlay": asHandler(approveOverlay),
  "device-claim": asHandler(deviceClaim),
  "device-progress": asHandler(deviceProgress),
  "device-upload-authorize": asHandler(deviceUpload),
  "device-upload-finish": asHandler(deviceUpload),
  "device-complete": asHandler(deviceComplete),
  "device-release": asHandler(deviceRelease),
};

const openLedger = openServerLedger;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { requestId?: unknown; action?: unknown; payload?: unknown; runId?: unknown; attemptId?: unknown }
    | null;

  const result = await handleLabStep(
    {
      requestId: typeof body?.requestId === "string" ? body.requestId : "",
      action: typeof body?.action === "string" ? body.action : "",
      payload: body?.payload ?? null,
      runId: typeof body?.runId === "string" ? body.runId : undefined,
      attemptId: typeof body?.attemptId === "string" ? body.attemptId : undefined,
    },
    {
      flagValue: process.env.LAB_AUTORUN_ENABLED,
      providerExecutionEnabled: LAB_PROVIDER_EXECUTION_ENABLED,
      labEmail: process.env.DEVICE_RENDER_LAB_TEST_EMAIL,
      requesterRole: Role.Requester,
      getSession: async () => {
        const session = await getServerSession(authOptions);
        return session?.user
          ? { user: { id: session.user.id ?? null, role: session.user.role ?? null, email: session.user.email ?? null } }
          : null;
      },
      markerExists: async (ownerId, runId) => (await openLedger().hasSpendAttempt(ownedKey(ownerId, runId))) === true,
      getBinding: async (ownerId, runId) => (await openLedger().getBinding(ownedKey(ownerId, runId))) as LabRunBinding | null,
      bindAttempt: (ownerId, runId, requestId, attemptId) =>
        openLedger().bindAttempt(ownedKey(ownerId, runId), requestId, attemptId),
      authoriseUpload: (ownerId, runId, attemptId) => openLedger().authoriseUpload(ownedKey(ownerId, runId), attemptId),
      recordUnresolvedClaim: (ownerId, runId, attemptId) =>
        openLedger().recordUnresolvedClaim(ownedKey(ownerId, runId), attemptId),
      findRequestOwner: async (requestId) => {
        const clipRequest = await clipRequestRepository.findById(requestId).catch(() => null);
        return clipRequest?.userId ?? null;
      },
      forward: async (action, ids, payload) => {
        const template = LAB_ROUTE_TEMPLATES[action];
        const url = new URL(
          template.path.replace("{requestId}", ids.requestId).replace("{attemptId}", ids.attemptId ?? ""),
          request.url
        );
        const forwarded = new Request(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie: request.headers.get("cookie") ?? "" },
          body: JSON.stringify(payload ?? {}),
        });
        const params: Record<string, string> = {};
        if (ids.requestId) params.id = ids.requestId;
        if (ids.attemptId) params.attemptId = ids.attemptId;
        const response = await HANDLERS[action](forwarded, { params: Promise.resolve(params) });
        const text = await response.text();
        let parsed: unknown = text;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }
        return { status: response.status, body: parsed };
      },
    }
  );

  return NextResponse.json(result.body, { status: result.status });
}
