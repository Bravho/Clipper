import { NextResponse } from "next/server";
import { z } from "zod";
import {
  managementUploadService,
  ManagementUploadError,
  MANAGEMENT_UPLOAD_MAX_BYTES,
  MANAGEMENT_UPLOAD_MIME_TYPES,
} from "@/services/management/ManagementUploadService";
import { requireManagementUser, managementErrorResponse } from "../_guard";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  fileName: z.string().min(1).max(300),
  fileSizeBytes: z.number().int().positive(),
  mimeType: z.string().min(1).max(150),
});

/**
 * GET /api/management/uploads
 *
 * Upload constraints, so the browser can validate and show limits before a user
 * picks a 3 GB file and waits for a rejection.
 */
export async function GET() {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  return NextResponse.json({
    acceptedMimeTypes: MANAGEMENT_UPLOAD_MIME_TYPES,
    maxBytes: MANAGEMENT_UPLOAD_MAX_BYTES,
  });
}

/**
 * POST /api/management/uploads
 *
 * Step 1 of bringing your own video into RClipper Management.
 *
 * UPLOADING IS FREE — this takes no payment and requires no access pass.
 * Management is useful on its own as a way to publish one video to several
 * channels and keep track of the results, so collecting content must not be
 * gated. Payment happens later, at publish time.
 *
 * Returns a presigned PUT URL. The browser uploads DIRECTLY to Spaces, so large
 * video files never pass through the web server. The client must then call
 * POST /api/management/uploads/[contentId]/complete.
 */
export async function POST(request: Request) {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

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
    const result = await managementUploadService.begin({
      userId: guard.user.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      fileName: parsed.data.fileName,
      fileSizeBytes: parsed.data.fileSizeBytes,
      mimeType: parsed.data.mimeType,
    });

    return NextResponse.json({
      contentId: result.content.id,
      uploadUrl: result.uploadUrl,
      storageKey: result.storageKey,
      expiresInSeconds: result.expiresInSeconds,
      mediaExpiresAt: result.content.mediaExpiresAt?.toISOString() ?? null,
    });
  } catch (err) {
    if (err instanceof ManagementUploadError) {
      return NextResponse.json(
        { error: err.message, reason: err.code },
        { status: err.code === "not_owner" ? 403 : 422 }
      );
    }
    return managementErrorResponse("POST /api/management/uploads", err);
  }
}
