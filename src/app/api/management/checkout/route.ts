import { NextResponse } from "next/server";
import { z } from "zod";
import {
  managementPurchaseService,
  InsufficientCreditsError,
} from "@/services/management/ManagementPurchaseService";
import { managementEntitlementService } from "@/services/management/ManagementEntitlementService";
import { requireManagementUser, managementErrorResponse } from "../_guard";

export const dynamic = "force-dynamic";

/**
 * Request schema.
 *
 * DELIBERATELY MINIMAL. There is no `amount`, `currency`, `durationMonths`,
 * `priceId` or `entitlementType` field — not "ignored if present", but absent
 * from the schema entirely, so a client value cannot be plumbed through by a
 * future refactor. Zod strips unknown keys, so extra fields never reach the
 * service.
 */
const bodySchema = z.object({
  productCode: z.string().min(1).max(100),
  /** Required for a single-video unlock; omitted for an access pass. */
  contentId: z.string().uuid().optional(),
  /** Client-held token that collapses a refreshed access-pass checkout. */
  idempotencyToken: z.string().min(8).max(200).optional(),
});

/**
 * POST /api/management/checkout
 *
 * Buys publishing rights with credits. This is the ONLY place money is taken in
 * RClipper Management, and it sits immediately before a video is submitted to
 * social channels — collecting content is free.
 *
 * SAFETY PROPERTIES
 *   * Idempotent — a double click or a refresh returns the existing purchase
 *     instead of debiting twice.
 *   * If the user is ALREADY entitled to publish this item (an active pass, or
 *     an unlock they bought earlier), no charge is taken at all.
 *   * The debit and the entitlement are committed in one transaction, so there
 *     is no "paid but not granted" state to recover from.
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
  const { productCode, contentId, idempotencyToken } = parsed.data;

  try {
    // Never charge for something the user can already do.
    if (contentId) {
      const existing = await managementEntitlementService.evaluateForPublish(
        guard.user,
        contentId
      );
      if (existing.allowed) {
        return NextResponse.json({
          charged: false,
          alreadyEntitled: true,
          entitlementType: existing.entitlementType,
          expiresAt: existing.expiresAt?.toISOString() ?? null,
        });
      }
      // Denied for a reason payment cannot fix — stop before debiting.
      if (
        existing.reason &&
        existing.reason !== "payment_required" &&
        existing.reason !== "access_expired"
      ) {
        return NextResponse.json(
          { error: "Publishing not available.", reason: existing.reason },
          { status: 409 }
        );
      }
    }

    const result = await managementPurchaseService.purchase({
      userId: guard.user.id,
      productCode,
      managementContentId: contentId ?? null,
      requestToken: idempotencyToken ?? null,
    });

    return NextResponse.json({
      charged: result.charged,
      alreadyEntitled: false,
      balanceCredits: result.balanceCredits,
      purchaseId: result.purchase.id,
      // The entry product grants a consumable, expiring bundle of upload tokens;
      // an access pass grants unlimited publishing for a window. Both are one-time
      // purchases that never renew.
      uploadBundle: result.uploadBundle
        ? {
            id: result.uploadBundle.id,
            totalAllowance: result.uploadBundle.totalAllowance,
            remaining: result.uploadBundle.remaining,
            expiresAt: result.uploadBundle.expiresAt.toISOString(),
          }
        : null,
      access: result.accessPass
        ? {
            startsAt: result.accessPass.startsAt.toISOString(),
            expiresAt: result.accessPass.expiresAt.toISOString(),
            autoRenew: false,
          }
        : null,
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      // 402 + needTopup mirrors the existing unlock-download contract, so the
      // client can reuse the same top-up prompt.
      return NextResponse.json(
        {
          error: "Insufficient credits.",
          needTopup: true,
          requiredCredits: err.requiredCredits,
          balanceCredits: err.balanceCredits,
        },
        { status: 402 }
      );
    }
    return managementErrorResponse("POST /api/management/checkout", err);
  }
}
