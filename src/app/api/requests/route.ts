import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestService } from "@/services/ClipRequestService";
import { clipRequestFormSchema } from "@/features/requests/validation/clipRequestSchema";

/**
 * POST /api/requests
 *
 * Creates a new draft clip request.
 * Supports both:
 *   - Draft save: body contains isDraft=true (partial validation)
 *   - Pre-submission create: body contains full form data
 *
 * Credits are NOT deducted here — deduction happens at /api/requests/[id]/submit.
 */
export async function POST(request: Request) {
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

  // Validate form data
  const parsed = clipRequestFormSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const draft = await clipRequestService.createDraft(
      session.user.id,
      parsed.data
    );
    return NextResponse.json({ requestId: draft.id }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/requests]", err);
    return NextResponse.json(
      { error: "Failed to create request." },
      { status: 500 }
    );
  }
}
