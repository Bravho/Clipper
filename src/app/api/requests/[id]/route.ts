import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestService } from "@/services/ClipRequestService";
import { draftClipRequestSchema } from "@/features/requests/validation/clipRequestSchema";

/**
 * PUT /api/requests/[id]
 *
 * Update a draft clip request. Only allowed while status is Draft.
 */
export async function PUT(
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

  const parsed = draftClipRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const updated = await clipRequestService.updateDraft(
      id,
      session.user.id,
      parsed.data
    );
    return NextResponse.json({ request: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    if (message === "Request not found." || message === "Access denied.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Only Draft")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("[PUT /api/requests/[id]]", err);
    return NextResponse.json({ error: "Failed to update request." }, { status: 500 });
  }
}

/**
 * DELETE /api/requests/[id]
 *
 * Delete a draft request. Only allowed while status is Draft.
 */
export async function DELETE(
  _request: Request,
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

  try {
    await clipRequestService.deleteDraft(id, session.user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    if (message === "Request not found." || message === "Access denied.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Only Draft")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("[DELETE /api/requests/[id]]", err);
    return NextResponse.json({ error: "Failed to delete request." }, { status: 500 });
  }
}
