import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestService } from "@/services/ClipRequestService";

/**
 * POST /api/requests/[id]/unlock-download
 *
 * Pays the request price to unlock the clean download of the free trial (first)
 * request. Idempotent — unlocking an already-unlocked request charges nothing.
 * Returns 402 with a top-up hint when the wallet is short.
 */
export async function POST(
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
    const updated = await clipRequestService.unlockDownload(id, session.user.id);
    return NextResponse.json({
      downloadUnlocked: updated.downloadUnlocked ?? true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    if (message === "Request not found." || message === "Access denied.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Insufficient credits")) {
      return NextResponse.json({ error: message, needTopup: true }, { status: 402 });
    }
    console.error("[POST /api/requests/[id]/unlock-download]", err);
    return NextResponse.json({ error: "Failed to unlock download." }, { status: 500 });
  }
}
