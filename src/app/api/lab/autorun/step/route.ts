import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository } from "@/repositories/index";
import { handleLabStep, type LabStepAction } from "@/lib/lab/labStep";
import { LAB_PROVIDER_EXECUTION_ENABLED } from "@/lib/lab/labGuards";
import { POST as startProduction } from "@/app/api/requests/[id]/start-production/route";
import { POST as approveVoice } from "@/app/api/requests/[id]/approve-voice/route";
import { POST as sceneDesignApprove } from "@/app/api/requests/[id]/scene-design/approve/route";
import { POST as approveOverlay } from "@/app/api/requests/[id]/approve-overlay/route";

/**
 * POST /api/lab/autorun/step  { requestId, action, payload }
 *
 * Lab auto-run only. See src/lib/lab/labStep.ts for the checks. Off (404)
 * unless LAB_AUTORUN_ENABLED is "true". Forwards to the normal studio route
 * with the same session; those routes keep their own checks.
 */
type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const HANDLERS: Record<LabStepAction, Handler> = {
  "start-production": startProduction,
  "approve-voice": approveVoice,
  "scene-design-approve": sceneDesignApprove,
  "approve-overlay": approveOverlay,
};

const STEP_PATH: Record<LabStepAction, string> = {
  "start-production": "start-production",
  "approve-voice": "approve-voice",
  "scene-design-approve": "scene-design/approve",
  "approve-overlay": "approve-overlay",
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { requestId?: unknown; action?: unknown; payload?: unknown }
    | null;

  const result = await handleLabStep(
    {
      requestId: typeof body?.requestId === "string" ? body.requestId : "",
      action: typeof body?.action === "string" ? body.action : "",
      payload: body?.payload ?? null,
    },
    {
      flagValue: process.env.LAB_AUTORUN_ENABLED,
      providerExecutionEnabled: LAB_PROVIDER_EXECUTION_ENABLED,
      labEmail: process.env.DEVICE_RENDER_LAB_TEST_EMAIL,
      requesterRole: Role.Requester,
      getSession: async () => {
        const session = await getServerSession(authOptions);
        return session?.user
          ? {
              user: {
                id: session.user.id ?? null,
                role: session.user.role ?? null,
                email: session.user.email ?? null,
              },
            }
          : null;
      },
      findRequestOwner: async (requestId) => {
        const clipRequest = await clipRequestRepository.findById(requestId).catch(() => null);
        return clipRequest?.userId ?? null;
      },
      forward: async (action, requestId, payload) => {
        const url = new URL(`/api/requests/${requestId}/${STEP_PATH[action]}`, request.url);
        const forwarded = new Request(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: request.headers.get("cookie") ?? "",
          },
          body: JSON.stringify(payload ?? {}),
        });
        const response = await HANDLERS[action](forwarded, { params: Promise.resolve({ id: requestId }) });
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
