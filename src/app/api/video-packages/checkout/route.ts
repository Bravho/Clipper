import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { isVideoProductCode } from "@/domain/enums/VideoProductCode";
import {
  videoPackagePurchaseService,
  InsufficientCreditsForPackageError,
  UnknownVideoPackageError,
} from "@/services/VideoPackagePurchaseService";

export const dynamic = "force-dynamic";

/**
 * Request schema.
 *
 * DELIBERATELY MINIMAL, like the Management checkout: no `amount`, `credits`,
 * `months` or `allowance` field — absent from the schema entirely, so a client
 * value can never be plumbed through to a price by a future refactor. The server
 * resolves everything from the trusted catalogue in src/config/videoPackages.ts.
 */
const bodySchema = z.object({
  productCode: z.string().min(1).max(100),
  /** Client-held token that collapses a refreshed or double-clicked checkout. */
  idempotencyToken: z.string().min(8).max(200).optional(),
});

/**
 * POST /api/video-packages/checkout
 *
 * Buys a monthly video allowance package with credits.
 *
 * SAFETY PROPERTIES
 *   * Idempotent — a double click or a refresh returns the existing months
 *     instead of debiting twice.
 *   * Prepaid and non-renewing: nothing here can charge the user again later.
 *   * Buying while paid time is still running EXTENDS it rather than replacing
 *     it, so early renewal never destroys time already paid for.
 */
export async function POST(request: Request) {
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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success || !isVideoProductCode(parsed.data.productCode)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const result = await videoPackagePurchaseService.purchase(
      session.user.id,
      parsed.data.productCode,
      parsed.data.idempotencyToken
    );
    return NextResponse.json({
      charged: result.charged,
      creditsSpent: result.creditsSpent,
      months: result.windows.length,
      activeUntil: result.activeUntil.toISOString(),
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsForPackageError) {
      return NextResponse.json(
        { error: err.message, needTopup: true, required: err.required },
        { status: 402 }
      );
    }
    if (err instanceof UnknownVideoPackageError) {
      return NextResponse.json({ error: "Unknown package." }, { status: 400 });
    }
    console.error("[POST /api/video-packages/checkout]", err);
    return NextResponse.json({ error: "Purchase failed." }, { status: 500 });
  }
}
