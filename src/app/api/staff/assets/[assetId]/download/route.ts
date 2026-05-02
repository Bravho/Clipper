import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { uploadedAssetRepository } from "@/repositories";
import { spacesClient, SPACES_BUCKET } from "@/lib/spaces";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Presigned URL valid for 5 minutes — enough for a download to start. */
const TTL_SECONDS = 5 * 60;

/**
 * GET /api/staff/assets/[assetId]/download
 *
 * Generates a short-lived presigned GET URL for a stored asset and redirects
 * the browser to it. The file bytes flow directly from DO Spaces to the browser
 * — nothing is buffered on the server.
 *
 * Access: Staff and Admin only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { assetId: string } }
) {
  try {
    await requireRole(Role.Editor, Role.Admin);

    const asset = await uploadedAssetRepository.findById(params.assetId);
    if (!asset || !asset.storageKey) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    const command = new GetObjectCommand({
      Bucket: SPACES_BUCKET,
      Key: asset.storageKey,
      ResponseContentDisposition: `attachment; filename="${asset.fileName}"`,
    });

    const url = await getSignedUrl(spacesClient, command, {
      expiresIn: TTL_SECONDS,
    });

    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
