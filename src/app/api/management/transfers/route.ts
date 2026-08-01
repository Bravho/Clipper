import { NextResponse } from "next/server";
import { z } from "zod";
import {
  managementTransferService,
  ManagementTransferNotAllowedError,
} from "@/services/management/ManagementTransferService";
import { requireManagementUser, managementErrorResponse } from "../_guard";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sourceRequestId: z.string().min(1).max(200),
  /** Transfer ONE generated video (its export asset id). Omit to transfer all. */
  videoAssetId: z.string().min(1).max(200).optional(),
  /** Explicitly transfer every video. Implied when videoAssetId is absent. */
  all: z.boolean().optional(),
});

/**
 * POST /api/management/transfers
 *
 * Copies a completed generation project's channel videos into RClipper
 * Management.
 *
 * FREE AND OPTIONAL. No payment is taken, quoted or required here — the user is
 * simply choosing to keep these videos in Management. Payment happens later, at
 * publish time. A user who never calls this keeps the existing download
 * experience unchanged.
 *
 * Idempotent: transferring an already-transferred project returns the existing
 * content item with `created: false` rather than erroring or duplicating.
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

  const { sourceRequestId, videoAssetId } = parsed.data;

  try {
    // One specific video → one item. No videoAssetId → transfer every video,
    // each as its own item (the "transfer all" button).
    if (videoAssetId) {
      const result = await managementTransferService.transferVideo({
        user: guard.user,
        sourceGenerationId: sourceRequestId,
        assetId: videoAssetId,
      });
      return NextResponse.json({
        content: {
          id: result.content.id,
          status: result.content.status,
          sourceAssetId: result.content.sourceAssetId,
          created: result.created,
          mediaExpiresAt: result.content.mediaExpiresAt?.toISOString() ?? null,
        },
      });
    }

    const { items, createdCount } = await managementTransferService.transferAll({
      user: guard.user,
      sourceGenerationId: sourceRequestId,
    });
    return NextResponse.json({
      createdCount,
      items: items.map((r) => ({
        id: r.content.id,
        sourceAssetId: r.content.sourceAssetId,
        created: r.created,
        mediaExpiresAt: r.content.mediaExpiresAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    if (err instanceof ManagementTransferNotAllowedError) {
      return NextResponse.json(
        { error: "Transfer not available.", reason: err.eligibility.reason },
        { status: 409 }
      );
    }
    return managementErrorResponse("POST /api/management/transfers", err);
  }
}
