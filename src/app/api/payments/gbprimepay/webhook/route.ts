import { NextResponse } from "next/server";
import { paymentService } from "@/services/PaymentService";
import { PaymentStatus } from "@/domain/enums/PaymentStatus";

/**
 * POST /api/payments/gbprimepay/webhook
 *
 * GB Prime Pay calls this `backgroundUrl` after a PromptPay payment. The body is
 * NOT trusted — we only read the referenceNo and re-verify server-to-server inside
 * PaymentService.settleFromWebhook(). Handling is idempotent, so GB Prime Pay may
 * safely retry delivery.
 *
 * Public route (no session): the gateway is the caller. Security comes from the
 * server-to-server status re-verification, not from the request body.
 */
export async function POST(request: Request) {
  let referenceNo: string | undefined;

  // GB Prime Pay may send JSON or form-encoded. Accept both.
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { referenceNo?: string };
      referenceNo = body.referenceNo;
    } else {
      const form = await request.formData();
      referenceNo = (form.get("referenceNo") as string) ?? undefined;
    }
  } catch {
    return NextResponse.json({ error: "Invalid webhook body." }, { status: 400 });
  }

  if (!referenceNo) {
    return NextResponse.json({ error: "Missing referenceNo." }, { status: 400 });
  }

  try {
    const intent = await paymentService.settleFromWebhook(referenceNo);
    // Always 200 on a handled webhook so the gateway stops retrying.
    return NextResponse.json({
      received: true,
      settled: intent.status === PaymentStatus.Paid,
    });
  } catch (err) {
    console.error("[POST /api/payments/gbprimepay/webhook]", err);
    // Unknown reference or transient error — 200 to avoid infinite gateway retries
    // on permanently-bad references; genuine transient failures are logged for replay.
    return NextResponse.json({ received: true, settled: false });
  }
}
