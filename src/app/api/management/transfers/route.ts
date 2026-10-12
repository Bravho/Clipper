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
 * NEEDS A PACKAGE (2026-10-12). Nothing is charged here, but the account must
 * hold a live package and the request must be unlocked and unexpired
 * (ManagementEntitlementService.checkTransferEligibility). Refusals: 402
 * `package_required`, 410 `videos_expired`, 409 for anything else.
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
      const reason = err.eligibility.reason;
      if (reason === "package_required") {
        return NextResponse.json(
          { error: "Buy a package to send this video to Channel Management.", reason },
          { status: 402 }
        );
      }
      if (reason === "videos_expired") {
        return NextResponse.json(
          { error: "This video has expired and is no longer available.", reason },
          { status: 410 }
        );
      }
      return NextResponse.json(
        { error: "Transfer not available.", reason },
        { status: 409 }
      );
    }
    return managementErrorResponse("POST /api/management/transfers", err);
  }
}
