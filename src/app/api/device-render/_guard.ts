import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { canAccessDeviceRenderLab } from "@/lib/mobile/deviceRenderLabAccess";
import { DeviceRenderError } from "@/services/DeviceRenderService";

/**
 * Shared entry check for every device-render endpoint.
 *
 * Two gates, both load-bearing while the feature is unfinished:
 *
 *   1. The caller must be the signed-in REQUESTER whose work this is. Ownership
 *      of the specific attempt is re-checked inside the service — this only
 *      establishes who is asking.
 *   2. The tester gate. `canAccessDeviceRenderLab` is what keeps phone
 *      rendering off production for everyone but the one account named by
 *      `DEVICE_RENDER_LAB_TEST_EMAIL`, and it stays in front of these routes as
 *      long as the renderer is incomplete — exactly as it already guards the
 *      page. Without it, a production build would expose a claim endpoint that
 *      can take real jobs off the worker queue.
 */
export interface DeviceRenderCaller {
  userId: string;
  email: string | null;
}

export async function authorizeDeviceRenderRequest(): Promise<
  { ok: true; caller: DeviceRenderCaller } | { ok: false; response: NextResponse }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorised." }, { status: 401 }),
    };
  }
  if (session.user.role !== Role.Requester) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }
  if (!canAccessDeviceRenderLab(session.user.email)) {
    // 404, not 403: an account that is not in the test cohort should not be
    // able to tell that these endpoints exist.
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found." }, { status: 404 }),
    };
  }

  return {
    ok: true,
    caller: { userId: session.user.id, email: session.user.email ?? null },
  };
}

/** Turn a service error into its intended status instead of a blanket 500. */
export function deviceRenderErrorResponse(err: unknown): NextResponse {
  if (err instanceof DeviceRenderError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("[device-render] unexpected error:", err);
  return NextResponse.json(
    { error: "Something went wrong with this render.", code: "internal_error" },
    { status: 500 }
  );
}

/** Parse a JSON body, returning a 400 rather than throwing on malformed input. */
export async function readJsonBody(
  request: Request
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
    };
  }
}
