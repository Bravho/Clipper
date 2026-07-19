import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { paymentService } from "@/services/PaymentService";
import { TOPUP_BUNDLES } from "@/config/credits";
import { z } from "zod";

const allowedAmounts = TOPUP_BUNDLES.map((b) => b.baht);

const bodySchema = z.object({
  amountBaht: z
    .number()
    .int()
    .positive()
    .refine((v) => allowedAmounts.includes(v as (typeof allowedAmounts)[number]), {
      message: "Amount must be one of the offered top-up bundles.",
    }),
  paymentMethod: z.enum(["promptpay", "card"]).default("promptpay"),
  returnPath: z.string().startsWith("/").optional(),
});

/**
 * POST /api/credits/topup
 * Creates a Stripe PromptPay QR for a top-up bundle and returns it for display.
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
  if (!parsed.success) {
    return NextResponse.json(
      { error: "จำนวนเงินไม่ถูกต้อง", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const origin = new URL(request.url).origin;
    const safeReturnPath = parsed.data.returnPath ?? "/dashboard/credits";
    const result =
      parsed.data.paymentMethod === "card"
        ? await paymentService.createCardTopupIntent(
            session.user.id,
            parsed.data.amountBaht,
            `${origin}${safeReturnPath}`
          )
        : await paymentService.createTopupIntent(
            session.user.id,
            parsed.data.amountBaht,
            session.user.email
          );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/credits/topup]", err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    if (message.includes("keys are not set")) {
      return NextResponse.json(
        { error: "ระบบชำระเงินยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลระบบ" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "ไม่สามารถสร้าง QR ชำระเงินได้ กรุณาลองใหม่" },
      { status: 500 }
    );
  }
}
