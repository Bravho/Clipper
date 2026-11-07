import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository } from "@/repositories/index";
import { decideLabRunGate } from "@/lib/lab/labRunGate";

/**
 * POST /api/lab/autorun/gate  { requestId }
 *
 * Lab auto-run only. Answers "may this signed-in lab account run this request
 * automatically?" The phone calls it before any lab step. It runs no step and
 * changes nothing. Off (404) unless LAB_AUTORUN_ENABLED is exactly "true".
 */
export async function POST(request: Request) {
  if (process.env.LAB_AUTORUN_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const session = await getServerSession(authOptions);

  const body = (await request.json().catch(() => null)) as { requestId?: unknown } | null;
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";

  let ownerId: string | null = null;
  if (requestId && session?.user?.id) {
    const clipRequest = await clipRequestRepository.findById(requestId).catch(() => null);
    ownerId = clipRequest?.userId ?? null;
  }

  const decision = decideLabRunGate({
    flagValue: process.env.LAB_AUTORUN_ENABLED,
    labEmail: process.env.DEVICE_RENDER_LAB_TEST_EMAIL,
    requesterRole: Role.Requester,
    session: session?.user
      ? {
          user: {
            id: session.user.id ?? null,
            role: session.user.role ?? null,
            email: session.user.email ?? null,
          },
        }
      : null,
    requestOwnerId: requestId ? ownerId : null,
  });

  if (!decision.ok) {
    const message =
      decision.status === 404 ? "Not found." : "Unauthorised.";
    return NextResponse.json({ error: message }, { status: decision.status });
  }
  return NextResponse.json({ allowed: true });
}
