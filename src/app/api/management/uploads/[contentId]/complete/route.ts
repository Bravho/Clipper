import { NextResponse } from "next/server";
import { z } from "zod";
import {
  managementUploadService,
  ManagementUploadError,
} from "@/services/management/ManagementUploadService";
import { requireManagementUser, managementErrorResponse } from "../../../_guard";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  storageKey: z.string().min(1).max(500),
  /** Optional metadata the browser can read from the <video> element. */
  durationSeconds: z.number().positive().max(60 * 60 * 6).optional(),
  width: z.number().int().positive().max(16384).optional(),
  height: z.number().int().positive().max(16384).optional(),
  originalFilename: z.string().max(300).optional(),
});

/**
 * POST /api/management/uploads/[contentId]/complete
 *
 * Step 2 of bringing your own video in: confirm the presigned PUT succeeded.
 *
 * The service verifies the object really exists in storage with a HEAD before
 * recording anything — a client claiming "upload done" is not evidence that it
 * is — and checks the storage key belongs to this upload, so a user cannot point
 * their content item at somebody else's object.
 *
 * Idempotent: confirming an already-completed upload returns the item unchanged.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ contentId: string }> }
) {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  const { contentId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const item = await managementUploadService.complete({
      userId: guard.user.id,
      managementContentId: contentId,
      storageKey: parsed.data.storageKey,
      durationSeconds: parsed.data.durationSeconds ?? null,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
      originalFilename: parsed.data.originalFilename ?? null,
    });

    return NextResponse.json({
      content: {
        id: item.id,
        title: item.title,
        status: item.status,
        mediaExpiresAt: item.mediaExpiresAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    if (err instanceof ManagementUploadError) {
      return NextResponse.json(
        { error: err.message, reason: err.code },
        { status: err.code === "not_owner" ? 403 : 422 }
      );
    }
    return managementErrorResponse(
      "POST /api/management/uploads/[contentId]/complete",
      err
    );
  }
}
