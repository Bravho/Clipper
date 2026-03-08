import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestService } from "@/services/ClipRequestService";
import { z } from "zod";

const submitBodySchema = z.object({
  creditConfirmed: z.literal(true),
  rightsConfirmed: z.literal(true),
});

/**
 * POST /api/requests/[id]/submit
 *
 * Submits a draft request. Validates legal confirmations, checks credits,
 * deducts credits, and transitions status to Submitted.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  if (session.user.role !== Role.Requester) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = submitBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Both credit and rights confirmations are required.",
        details: parsed.error.flatten(),
      },
      { status: 422 }
    );
  }

  try {
    const submitted = await clipRequestService.submitRequest(
      id,
      session.user.id,
      parsed.data.creditConfirmed,
      parsed.data.rightsConfirmed
    );
    return NextResponse.json({ request: submitted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    if (message === "Request not found." || message === "Access denied.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Insufficient credits")) {
      return NextResponse.json({ error: message }, { status: 402 });
    }
    if (message.includes("Only Draft") || message.includes("confirmation")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("[POST /api/requests/[id]/submit]", err);
    return NextResponse.json({ error: "Failed to submit request." }, { status: 500 });
  }
}
