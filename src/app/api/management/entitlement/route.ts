import { NextResponse } from "next/server";
import { z } from "zod";
import { managementEntitlementService } from "@/services/management/ManagementEntitlementService";
import { requireManagementUser, managementErrorResponse } from "../_guard";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  /** Ask about publishing one specific item. */
  contentId: z.string().uuid().optional(),
  /** Ask whether a completed generation project may be transferred (always free). */
  sourceRequestId: z.string().min(1).max(200).optional(),
});

/**
 * GET /api/management/entitlement[?contentId=…][&sourceRequestId=…]
 *
 * Read-only view of what the user may do right now, for RENDERING only. Every
 * mutating route recomputes entitlement server-side, so a tampered response
 * here cannot buy anyone access.
 *
 * Note the asymmetry, which is the point of the whole design: `transfer` is
 * about readiness and ownership and never costs anything, while `publish` is
 * the paid gate.
 */
export async function GET(request: Request) {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    contentId: url.searchParams.get("contentId") ?? undefined,
    sourceRequestId: url.searchParams.get("sourceRequestId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const access = await managementEntitlementService.effectiveAccess(guard.user.id);

    const publish = parsed.data.contentId
      ? await managementEntitlementService.evaluateForPublish(
          guard.user,
          parsed.data.contentId
        )
      : await managementEntitlementService.evaluateForAnyPublish(guard.user);

    const transfer = parsed.data.sourceRequestId
      ? await managementEntitlementService.checkTransferEligibility(
          guard.user,
          parsed.data.sourceRequestId
        )
      : null;

    return NextResponse.json({
      publish: {
        allowed: publish.allowed,
        entitlementType: publish.entitlementType,
        reason: publish.reason ?? null,
        expiresAt: publish.expiresAt?.toISOString() ?? null,
      },
      transfer: transfer
        ? {
            allowed: transfer.allowed,
            alreadyTransferred: transfer.alreadyTransferred,
            managementContentId: transfer.managementContentId ?? null,
            videoCount: transfer.videoCount,
            reason: transfer.reason ?? null,
            /** Stated explicitly so no client can render a price here. */
            free: true,
          }
        : null,
      access: access
        ? {
            startsAt: access.startsAt.toISOString(),
            expiresAt: access.expiresAt.toISOString(),
            autoRenew: false,
          }
        : null,
    });
  } catch (err) {
    return managementErrorResponse("GET /api/management/entitlement", err);
  }
}
