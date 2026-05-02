import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { internalNoteService } from "@/services/staff/InternalNoteService";
import { addInternalNoteSchema } from "@/features/staff/validation/staffActionSchemas";

/**
 * GET /api/staff/notes/[requestId]
 * Retrieve all internal notes for a request (staff/admin only).
 *
 * IMPORTANT: This endpoint must NEVER be accessible to requesters.
 * The requireRole guard ensures this.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { requestId: string } }
) {
  try {
    await requireRole(Role.Editor, Role.Admin);
    const notes = await internalNoteService.getNotesForRequest(params.requestId);
    return NextResponse.json({ notes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * POST /api/staff/notes/[requestId]
 * Add an internal note to a request.
 *
 * Body: { content: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { requestId: string } }
) {
  try {
    const user = await requireRole(Role.Editor, Role.Admin);
    const body = await req.json();
    const parsed = addInternalNoteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
    }
    const note = await internalNoteService.addNote(
      params.requestId,
      user.id,
      user.name ?? "Staff",
      parsed.data.content
    );
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
